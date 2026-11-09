import {Buffer} from 'buffer';
import {DirectSessionManager} from '../src/security/session';
import {GroupKeyManager} from '../src/security/group';
import {utf8} from '../src/security/bytes';
import {createSecurityNode, mutuallyTrust, TestClock} from './securityTestHelpers';
import {
  canAdminister, emptyConvoyMembershipSnapshot,
  parseConvoyMembershipSnapshot, presenceFromLastSeen,
} from '../src/convoy/membership/model';
import {
  ConvoyMembershipService, encodeJoinRequestPayload,
} from '../src/convoy/membership/ConvoyMembershipService';
import {SecurityV1ConvoyMembershipAdapter} from '../src/convoy/membership/securityV1';
import {MemoryConvoyMembershipStore, SecureConvoyMembershipStore} from '../src/convoy/membership/store';

const context = {protocolVersion: 1, authenticatedHeader: utf8('canonical-location-or-control-header')};

function system(node: ReturnType<typeof createSecurityNode>) {
  const groups = new GroupKeyManager(
    node.crypto, node.secrets, node.metadata, node.identity, node.trust, node.versions, node.clock,
  );
  const sessions = new DirectSessionManager(
    node.crypto, node.secrets, node.metadata, node.identity, node.trust, node.versions, node.clock,
  );
  const adapter = new SecurityV1ConvoyMembershipAdapter(
    node.crypto, node.identity, node.metadata, node.secrets, node.trust, groups, sessions,
  );
  const store = new SecureConvoyMembershipStore(node.secrets);
  return {
    groups, sessions, adapter, store,
    service: new ConvoyMembershipService(adapter, store, () => node.clock.now()),
  };
}

async function peers() {
  const clock = new TestClock();
  const a = createSecurityNode(clock);
  const b = createSecurityNode(clock);
  const {aIdentity, bIdentity} = await mutuallyTrust(a, b);
  const owner = system(a);
  const peer = system(b);
  const offer = await owner.sessions.createOffer(bIdentity.deviceId);
  const accepted = await peer.sessions.acceptOffer(offer);
  const session = await owner.sessions.finalizeOffer(accepted.response);
  return {a, b, clock, aIdentity, bIdentity, owner, peer,
    ownerSessionId: session.sessionId, peerSessionId: accepted.session.sessionId};
}

test('snapshot validation rejects carrier credentials, invalid IDs and duplicate data', () => {
  const blank = emptyConvoyMembershipSnapshot();
  expect(parseConvoyMembershipSnapshot(blank)).toEqual(blank);
  expect(() => parseConvoyMembershipSnapshot({...blank, secretHex: 'AABB'})).toThrow();
  expect(() => parseConvoyMembershipSnapshot({...blank, convoys: [{
    convoyId: '../bad', groupId: 'bmg1_abcdefgh',
    displayName: 'Invalid', ownerDeviceId: null, createdAt: 1000,
  }]})).toThrow();
  const one = {convoyId: 'A1', groupId: 'bmg1_abcdefgh',
    displayName: 'One', ownerDeviceId: null, createdAt: 1000};
  expect(() => parseConvoyMembershipSnapshot({...blank, convoys: [one, one]})).toThrow();
  expect(new MemoryConvoyMembershipStore().isDurable()).toBe(false);
});

test('permissions protect owner/admin/member and presence fails closed', () => {
  expect(canAdminister('owner', 'grant-admin')).toBe(true);
  expect(canAdminister('owner', 'remove-member', 'owner')).toBe(false);
  expect(canAdminister('admin', 'invite')).toBe(true);
  expect(canAdminister('admin', 'remove-member', 'member')).toBe(true);
  expect(canAdminister('admin', 'remove-member', 'admin')).toBe(false);
  expect(canAdminister('admin', 'grant-admin')).toBe(false);
  expect(canAdminister('member', 'review-request')).toBe(false);
  expect(presenceFromLastSeen(null, 700000)).toBe('disconnected');
  expect(presenceFromLastSeen(700001, 700000)).toBe('disconnected');
  expect(presenceFromLastSeen(700000, 700000)).toBe('live');
  expect(presenceFromLastSeen(700000, 750000)).toBe('recent');
  expect(presenceFromLastSeen(700000, 1000000)).toBe('stale');
  expect(presenceFromLastSeen(700000, 1400000)).toBe('disconnected');
});

test('actual group creation and protected metadata restore revalidate key epoch', async () => {
  const node = createSecurityNode();
  const local = await node.identity.loadOrCreate();
  const {service, adapter, store} = system(node);
  expect(await service.listAuthorized(local.deviceId)).toEqual([]);
  const entry = await service.createConvoy(' High Country ');
  expect(entry.displayName).toBe('High Country');
  const verified = await service.resolveAuthorized(entry.convoyId, local.deviceId);
  expect(verified).toMatchObject({
    convoyId: entry.convoyId, localIdentityRef: local.deviceId,
    verifiedBy: 'security-v1', authorizationState: 'authorized',
  });
  expect(await service.resolveAuthorized(entry.convoyId, 'bm1_other')).toBeNull();
  const recovered = new ConvoyMembershipService(adapter, store, () => node.clock.now());
  expect(await recovered.resolveAuthorized(entry.convoyId, local.deviceId)).toEqual(verified);
  await node.secrets.deleteSecret('group/' + entry.groupId + '/epoch-1');
  expect(await recovered.resolveAuthorized(entry.convoyId, local.deviceId)).toBeNull();
});

test('founding member enrols only after real signed/session-bound group-key distribution', async () => {
  const {aIdentity, bIdentity, owner, peer, ownerSessionId} = await peers();
  const convoy = await owner.service.createConvoy('Outback', [{
    deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint,
  }]);
  expect(await peer.service.listAuthorized(bIdentity.deviceId)).toEqual([]);
  const distribution = await owner.service.wrapEnrolmentForMember({
    convoyId: convoy.convoyId, recipientDeviceId: bIdentity.deviceId,
    sessionId: ownerSessionId, context,
  });
  await expect(peer.service.installEnrolment({
    convoyId: convoy.convoyId, displayName: 'Outback', context,
    distribution: {...distribution, senderFingerprint: 'wrong'},
  })).rejects.toBeDefined();
  expect(await peer.service.listAuthorized(bIdentity.deviceId)).toEqual([]);
  await peer.service.installEnrolment({
    convoyId: convoy.convoyId, displayName: 'Outback', context, distribution,
  });
  expect(await peer.service.resolveAuthorized(convoy.convoyId, bIdentity.deviceId))
    .toMatchObject({authorizationState: 'authorized', verifiedBy: 'security-v1'});
  expect(await owner.service.resolveAuthorized(convoy.convoyId, aIdentity.deviceId)).not.toBeNull();
  expect((await peer.service.listAdministration()).convoys[0].ownerDeviceId).toBeNull();
  expect(JSON.stringify(await peer.service.listAdministration())).not.toContain('keyMaterial');
  await expect(peer.service.installEnrolment({
    convoyId: convoy.convoyId, displayName: 'Outback', context, distribution,
  })).rejects.toMatchObject({code: 'REPLAY_DETECTED'});
});

test('invitation and verified join request do not fabricate an approved Security v1 member', async () => {
  const {aIdentity, bIdentity, owner, peer, peerSessionId, clock} = await peers();
  const convoy = await owner.service.createConvoy('Queue');
  const invitation = await owner.service.invite({
    convoyId: convoy.convoyId, recipientDeviceId: bIdentity.deviceId,
    recipientFingerprint: bIdentity.fingerprint, expiresAt: clock.now() + 60000,
  });
  expect(invitation.state).toBe('pending');
  await owner.service.cancelInvitation(invitation.id);
  expect((await owner.service.listAdministration()).invitations[0].state).toBe('cancelled');

  const request = {id: 'bmr1_join1', convoyId: convoy.convoyId,
    deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint, createdAt: clock.now()};
  const encrypted = await peer.sessions.encrypt(peerSessionId, encodeJoinRequestPayload(request), context);
  await expect(owner.service.receiveJoinRequest({
    envelope: encrypted, context,
    senderDeviceId: bIdentity.deviceId, senderFingerprint: aIdentity.fingerprint,
  })).rejects.toBeDefined();
  const accepted = await owner.service.receiveJoinRequest({
    envelope: encrypted, context, senderDeviceId: bIdentity.deviceId,
    senderFingerprint: bIdentity.fingerprint,
  });
  expect(accepted.state).toBe('pending');
  const approved = await owner.service.approveJoinRequest(request.id);
  expect(approved.state).toBe('approved-awaiting-security');
  expect(await owner.service.approveJoinRequest(request.id)).toEqual(approved);
  expect((await owner.service.listMembers(convoy.convoyId)).map(value => value.deviceId))
    .not.toContain(bIdentity.deviceId);
  await expect(owner.service.wrapEnrolmentForMember({
    convoyId: convoy.convoyId, recipientDeviceId: bIdentity.deviceId,
    sessionId: 'not-a-session', context,
  })).rejects.toMatchObject({code: 'MISSING_SECURITY_CONTRACT'});
  await expect(owner.service.receiveJoinRequest({
    envelope: encrypted, context, senderDeviceId: bIdentity.deviceId,
    senderFingerprint: bIdentity.fingerprint,
  })).rejects.toMatchObject({code: 'REPLAY_DETECTED'});
  await expect(owner.service.rejectJoinRequest(request.id)).rejects.toMatchObject({code: 'CONFLICT'});
});

test('authenticated duplicate join IDs are idempotent; altered identity is rejected', async () => {
  const {bIdentity, owner, peer, peerSessionId, clock} = await peers();
  const convoy = await owner.service.createConvoy('Requests');
  const request = {id: 'bmr1_same', convoyId: convoy.convoyId,
    deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint, createdAt: clock.now()};
  const forged = await peer.sessions.encrypt(peerSessionId,
    encodeJoinRequestPayload({...request, deviceId: 'bm1_forged'}), context);
  await expect(owner.service.receiveJoinRequest({
    envelope: forged, context, senderDeviceId: bIdentity.deviceId,
    senderFingerprint: bIdentity.fingerprint,
  })).rejects.toMatchObject({code: 'UNAUTHORISED'});
  const one = await peer.sessions.encrypt(peerSessionId, encodeJoinRequestPayload(request), context);
  const two = await peer.sessions.encrypt(peerSessionId, encodeJoinRequestPayload(request), context);
  const receive = (envelope: typeof one) => owner.service.receiveJoinRequest({
    envelope, context, senderDeviceId: bIdentity.deviceId,
    senderFingerprint: bIdentity.fingerprint,
  });
  expect(await receive(one)).toEqual(await receive(two));
  expect((await owner.service.listAdministration()).requests).toHaveLength(1);
  expect((await owner.service.rejectJoinRequest(request.id)).state).toBe('rejected');
  await expect(owner.service.approveJoinRequest(request.id)).rejects.toMatchObject({code: 'CONFLICT'});
});

test('current-epoch encrypted location requires membership, anti-replay and fresh trust', async () => {
  const {aIdentity, bIdentity, owner, peer, ownerSessionId, clock} = await peers();
  const convoy = await owner.service.createConvoy('Positions', [{
    deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint,
  }]);
  const distribution = await owner.service.wrapEnrolmentForMember({
    convoyId: convoy.convoyId, recipientDeviceId: bIdentity.deviceId,
    sessionId: ownerSessionId, context,
  });
  await peer.service.installEnrolment({
    convoyId: convoy.convoyId, displayName: 'Positions', distribution, context,
  });
  const envelope = await peer.groups.encrypt(convoy.groupId, utf8('authenticated-location'), context);
  expect(await owner.service.decryptAuthorizedPosition({
    convoyId: 'unknown', envelope, context,
  })).toBeNull();
  await expect(owner.service.decryptAuthorizedPosition({
    convoyId: convoy.convoyId, envelope,
    context: {...context, authenticatedHeader: utf8('modified')},
  })).rejects.toMatchObject({code: 'AUTHENTICATION_FAILED'});
  const accepted = await owner.service.decryptAuthorizedPosition({
    convoyId: convoy.convoyId, envelope, context,
  });
  expect(Buffer.from(accepted!.plaintext).toString()).toBe('authenticated-location');
  accepted!.plaintext.fill(0);
  await expect(owner.service.decryptAuthorizedPosition({
    convoyId: convoy.convoyId, envelope, context,
  })).rejects.toMatchObject({code: 'REPLAY_DETECTED'});
  expect((await owner.service.listMembers(convoy.convoyId))
    .find(value => value.deviceId === bIdentity.deviceId)?.presence).toBe('live');
  clock.advance(300000);
  expect((await owner.service.listMembers(convoy.convoyId))
    .find(value => value.deviceId === bIdentity.deviceId)?.presence).toBe('stale');
  const updated = await owner.service.removeMember(convoy.convoyId, bIdentity.deviceId);
  expect(updated.currentEpoch).toBe(2);
  expect(updated.members.find(value => value.deviceId === bIdentity.deviceId)?.state).toBe('revoked');
  expect(await owner.service.decryptAuthorizedPosition({
    convoyId: convoy.convoyId, envelope, context,
  })).toBeNull();
  await expect(owner.service.removeMember(convoy.convoyId, bIdentity.deviceId))
    .rejects.toMatchObject({code: 'UNAUTHORISED'});
  expect(await owner.service.resolveAuthorized(convoy.convoyId, aIdentity.deviceId)).not.toBeNull();
});

test('identity rotation invalidates previously pinned group identity', async () => {
  const {b, bIdentity, owner, peer, ownerSessionId} = await peers();
  const convoy = await owner.service.createConvoy('Rotation', [{
    deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint,
  }]);
  const distribution = await owner.service.wrapEnrolmentForMember({
    convoyId: convoy.convoyId, recipientDeviceId: bIdentity.deviceId,
    sessionId: ownerSessionId, context,
  });
  await peer.service.installEnrolment({
    convoyId: convoy.convoyId, displayName: 'Rotation', distribution, context,
  });
  expect(await peer.service.resolveAuthorized(convoy.convoyId, bIdentity.deviceId)).not.toBeNull();
  await b.identity.rotateKeys();
  peer.service.notifySecurityInvalidation();
  expect(await peer.service.resolveAuthorized(convoy.convoyId, bIdentity.deviceId)).toBeNull();
  expect(await peer.service.listMembers(convoy.convoyId)).toEqual([]);
});

test('admin promotion requires a pre-existing Security v1 leader, not only a local label', async () => {
  const {bIdentity, owner, clock} = await peers();
  const convoy = await owner.service.createConvoy('Authority', [{
    deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint,
  }]);
  await expect(owner.service.grantLocalAdmin(convoy.convoyId, bIdentity.deviceId))
    .rejects.toMatchObject({code: 'MISSING_SECURITY_CONTRACT'});
  await expect(owner.service.invite({
    convoyId: convoy.convoyId, recipientDeviceId: bIdentity.deviceId,
    recipientFingerprint: bIdentity.fingerprint, expiresAt: clock.now() + 60_000,
  })).rejects.toMatchObject({code: 'CONFLICT'});
});
