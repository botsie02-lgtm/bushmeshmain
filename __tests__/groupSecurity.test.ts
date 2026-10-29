import {utf8} from '../src/security/bytes';
import {GroupKeyManager} from '../src/security/group';
import {createSecurityNode, mutuallyTrust} from './securityTestHelpers';

const context = {protocolVersion: 1, authenticatedHeader: utf8('group-header')};

async function setupGroup() {
  const a = createSecurityNode();
  const b = createSecurityNode();
  const {aIdentity, bIdentity} = await mutuallyTrust(a, b);
  const aGroups = new GroupKeyManager(
    a.crypto, a.secrets, a.metadata, a.identity, a.trust, a.versions, a.clock,
  );
  const bGroups = new GroupKeyManager(
    b.crypto, b.secrets, b.metadata, b.identity, b.trust, b.versions, b.clock,
  );
  const group = await aGroups.createGroup('bmg1_convoy-alpha', [
    {deviceId: aIdentity.deviceId, role: 'leader'},
    {deviceId: bIdentity.deviceId, role: 'member'},
  ]);
  const active = group.keyEpochs.find(epoch => epoch.epoch === group.currentEpoch)!;
  const key = await a.secrets.getSecret(active.keyRef);
  expect(key).not.toBeNull();
  await bGroups.installGroupKey(group, key!);
  return {a, b, aIdentity, bIdentity, aGroups, bGroups, group};
}

describe('group/convoy key handling', () => {
  test('encrypts group traffic with per-sender derived keys', async () => {
    const {aGroups, bGroups, group} = await setupGroup();
    const envelope = await aGroups.encrypt(group.groupId, utf8('convoy update'), context);
    const plaintext = await bGroups.decrypt(envelope, context);
    expect(new TextDecoder().decode(plaintext)).toBe('convoy update');
  });

  test('rejects group replay', async () => {
    const {aGroups, bGroups, group} = await setupGroup();
    const envelope = await aGroups.encrypt(group.groupId, utf8('position'), context);
    await bGroups.decrypt(envelope, context);
    await expect(bGroups.decrypt(envelope, context)).rejects.toMatchObject({code: 'REPLAY_DETECTED'});
  });

  test('revoked peer traffic is rejected', async () => {
    const {b, aIdentity, aGroups, bGroups, group} = await setupGroup();
    const envelope = await aGroups.encrypt(group.groupId, utf8('before revoke'), context);
    await b.trust.revoke(aIdentity.deviceId, 'removed');
    await expect(bGroups.decrypt(envelope, context)).rejects.toMatchObject({code: 'PEER_REVOKED'});
  });

  test('rotated group keys reject old epochs', async () => {
    const {aGroups, group} = await setupGroup();
    const oldEnvelope = await aGroups.encrypt(group.groupId, utf8('old epoch'), context);
    await aGroups.rotateGroupKey(group.groupId);
    await expect(aGroups.decrypt(oldEnvelope, context)).rejects.toMatchObject({code: 'ROTATED_KEY'});
  });

  test('revoking a member rotates the group key', async () => {
    const {aGroups, bIdentity, group} = await setupGroup();
    const updated = await aGroups.revokeMember(group.groupId, bIdentity.deviceId);
    expect(updated.currentEpoch).toBe(2);
    expect(updated.members.find(member => member.deviceId === bIdentity.deviceId)?.state).toBe(
      'revoked',
    );
    expect(updated.keyEpochs.find(epoch => epoch.epoch === 1)?.state).toBe('rotated');
  });

  test('modified group ciphertext is rejected', async () => {
    const {aGroups, bGroups, group} = await setupGroup();
    const envelope = await aGroups.encrypt(group.groupId, utf8('auth group'), context);
    const last = envelope.ciphertext.endsWith('A') ? 'B' : 'A';
    await expect(
      bGroups.decrypt({...envelope, ciphertext: envelope.ciphertext.slice(0, -1) + last}, context),
    ).rejects.toMatchObject({code: 'AUTHENTICATION_FAILED'});
  });
});
