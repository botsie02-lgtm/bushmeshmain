import {utf8} from '../src/security/bytes';
import {GroupKeyManager} from '../src/security/group';
import {DirectSessionManager} from '../src/security/session';
import {createSecurityNode, mutuallyTrust} from './securityTestHelpers';

const context = {protocolVersion: 1, authenticatedHeader: utf8('group-key-or-message-header')};

async function setupGroup() {
  const a = createSecurityNode();
  const b = createSecurityNode();
  const {aIdentity, bIdentity} = await mutuallyTrust(a, b);
  const aSessions = new DirectSessionManager(
    a.crypto, a.secrets, a.metadata, a.identity, a.trust, a.versions, a.clock,
  );
  const bSessions = new DirectSessionManager(
    b.crypto, b.secrets, b.metadata, b.identity, b.trust, b.versions, b.clock,
  );
  const offer = await aSessions.createOffer(bIdentity.deviceId);
  const accepted = await bSessions.acceptOffer(offer);
  const aSession = await aSessions.finalizeOffer(accepted.response);

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
  const wrapped = await aGroups.wrapActiveKeyForPeer(
    group.groupId,
    bIdentity.deviceId,
    aSession.sessionId,
    aSessions,
    context,
  );
  const installed = await bGroups.installWrappedGroupKey(wrapped, bSessions, context);
  return {
    a,
    b,
    aIdentity,
    bIdentity,
    aSessions,
    bSessions,
    aSession,
    aGroups,
    bGroups,
    group,
    installed,
    wrapped,
  };
}

describe('group/convoy key handling', () => {
  test('distributes a group epoch only through an authenticated direct session', async () => {
    const {group, installed} = await setupGroup();
    expect(installed.groupId).toBe(group.groupId);
    expect(installed.currentEpoch).toBe(group.currentEpoch);
    expect(installed.members).toEqual(group.members);
  });

  test('encrypts group traffic with per-sender derived keys', async () => {
    const {aGroups, bGroups, group} = await setupGroup();
    const envelope = await aGroups.encrypt(group.groupId, utf8('convoy update'), context);
    const plaintext = await bGroups.decrypt(envelope, context);
    expect(plaintext).toEqual(utf8('convoy update'));
  });

  test('rejects group replay across manager recovery', async () => {
    const {b, aGroups, bGroups, group} = await setupGroup();
    const envelope = await aGroups.encrypt(group.groupId, utf8('position'), context);
    await bGroups.decrypt(envelope, context);
    const recovered = new GroupKeyManager(
      b.crypto, b.secrets, b.metadata, b.identity, b.trust, b.versions, b.clock,
    );
    await expect(recovered.decrypt(envelope, context)).rejects.toMatchObject({
      code: 'REPLAY_DETECTED',
    });
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

  test('revoking a member rotates the group key and blocks future key distribution', async () => {
    const {aGroups, aSessions, aSession, bIdentity, group} = await setupGroup();
    const updated = await aGroups.revokeMember(group.groupId, bIdentity.deviceId);
    expect(updated.currentEpoch).toBe(2);
    expect(updated.members.find(member => member.deviceId === bIdentity.deviceId)?.state).toBe(
      'revoked',
    );
    await expect(
      aGroups.wrapActiveKeyForPeer(
        group.groupId,
        bIdentity.deviceId,
        aSession.sessionId,
        aSessions,
        context,
      ),
    ).rejects.toMatchObject({code: 'PEER_REVOKED'});
  });

  test('modified group ciphertext is rejected', async () => {
    const {aGroups, bGroups, group} = await setupGroup();
    const envelope = await aGroups.encrypt(group.groupId, utf8('auth group'), context);
    const last = envelope.ciphertext.endsWith('A') ? 'B' : 'A';
    await expect(
      bGroups.decrypt({...envelope, ciphertext: envelope.ciphertext.slice(0, -1) + last}, context),
    ).rejects.toMatchObject({code: 'AUTHENTICATION_FAILED'});
  });

  test('replayed wrapped distribution is rejected', async () => {
    const {bGroups, bSessions, wrapped} = await setupGroup();
    await expect(
      bGroups.installWrappedGroupKey({...wrapped, epoch: wrapped.epoch + 1}, bSessions, context),
    ).rejects.toMatchObject({code: 'REPLAY_DETECTED'});
  });

  test('group nonce-counter rollback revokes the affected epoch key', async () => {
    const {a, aIdentity, aGroups, group} = await setupGroup();
    await aGroups.encrypt(group.groupId, utf8('one'), context);
    await aGroups.encrypt(group.groupId, utf8('two'), context);
    const scope = `group/${group.groupId}/epoch-1/sender/${aIdentity.deviceId}`;
    a.metadata.unsafeSetNonceCounter(scope, 1n);
    await expect(aGroups.encrypt(group.groupId, utf8('reuse'), context)).rejects.toMatchObject({
      code: 'COUNTER_ROLLBACK',
    });
    const failed = await a.metadata.getGroup(group.groupId);
    expect(failed?.keyEpochs.find(epoch => epoch.epoch === 1)?.state).toBe('revoked');
    await expect(aGroups.encrypt(group.groupId, utf8('blocked'), context)).rejects.toMatchObject({
      code: 'KEY_NOT_FOUND',
    });
  });
});
