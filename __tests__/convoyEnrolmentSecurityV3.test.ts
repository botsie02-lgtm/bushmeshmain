import {Buffer} from 'buffer';
import {DirectSessionManager} from '../src/security/session';
import {GroupKeyManager} from '../src/security/group';
import {utf8} from '../src/security/bytes';
import type {GroupRecord} from '../src/security/types';
import {createSecurityNode, mutuallyTrust, TestClock} from './securityTestHelpers';
import type {EnrolmentProposalV2, RoleCredentialClaimsV2} from '../src/convoy/enrolmentV3/contract';
import {
  ENROLMENT_V2_SCHEMA, SECURE_ENROLMENT_V3_ACTIVATION,
  decodeProposedEnrolmentControl, encodeProposedEnrolmentControl,
  SecurityV2ContractUnavailable,
} from '../src/convoy/enrolmentV3/contract';
import {
  signRoleCredentialClaims, inspectRoleCredentialSignature,
  signProposedApproval, inspectProposedApprovalSignatures,
} from '../src/convoy/enrolmentV3/roleCredential';
import {
  newJoinObservation, observeJoinEvent, parseJoinObservation,
  reconcileJoinObservation, parseJoinObservationJournal,
} from '../src/convoy/enrolmentV3/joinState';
import {MemoryJoinObservationStore, ProtectedJoinObservationStore} from '../src/convoy/enrolmentV3/joinStore';
import {inspectIncrementalRosterTransition, planRemainingEpochRecipients} from '../src/convoy/enrolmentV3/rosterPolicy';
import {SecureJoinCompatibilityV3, secureJoinReadinessV3} from '../src/convoy/enrolmentV3/compatibility';
import {ConvoyMembershipService, encodeJoinRequestPayload} from '../src/convoy/membership/ConvoyMembershipService';
import {SecurityV1ConvoyMembershipAdapter} from '../src/convoy/membership/securityV1';
import {SecureConvoyMembershipStore} from '../src/convoy/membership/store';

const aad = {protocolVersion: 1, authenticatedHeader: utf8('bushmesh-immutable-control-header')};

function makeService(node: ReturnType<typeof createSecurityNode>) {
  const groups = new GroupKeyManager(node.crypto, node.secrets, node.metadata, node.identity, node.trust, node.versions, node.clock);
  const sessions = new DirectSessionManager(node.crypto, node.secrets, node.metadata, node.identity, node.trust, node.versions, node.clock);
  const adapter = new SecurityV1ConvoyMembershipAdapter(node.crypto, node.identity, node.metadata,
    node.secrets, node.trust, groups, sessions);
  const membership = new ConvoyMembershipService(adapter,
    new SecureConvoyMembershipStore(node.secrets), () => node.clock.now());
  const journal = new ProtectedJoinObservationStore(node.secrets);
  return {groups, sessions, adapter, membership, journal,
    join: new SecureJoinCompatibilityV3(membership, adapter, journal, () => node.clock.now())};
}

async function pair() {
  const clock = new TestClock(), a = createSecurityNode(clock), b = createSecurityNode(clock);
  const {aIdentity, bIdentity} = await mutuallyTrust(a, b);
  const owner = makeService(a), peer = makeService(b);
  const offer = await peer.sessions.createOffer(aIdentity.deviceId);
  const accepted = await owner.sessions.acceptOffer(offer);
  const peerSession = await peer.sessions.finalizeOffer(accepted.response);
  return {clock, a, b, aIdentity, bIdentity, owner, peer, peerSessionId: peerSession.sessionId};
}

async function signedSample() {
  const p = await pair();
  const groupId = 'bmg1_proposal-123', convoyId = 'bmc1_proposal-123';
  const claims: RoleCredentialClaimsV2 = {
    schema: 'bushmesh-convoy-role-credential-v2', version: 2,
    credentialId: 'role-001', groupId, convoyId,
    ownerAnchorFingerprint: p.aIdentity.fingerprint,
    subject: {deviceId: p.bIdentity.deviceId, fingerprint: p.bIdentity.fingerprint, keyEpoch: p.bIdentity.keyEpoch},
    role: 'admin',
    issuer: {deviceId: p.aIdentity.deviceId, fingerprint: p.aIdentity.fingerprint, keyEpoch: p.aIdentity.keyEpoch},
    authoritySequence: 1, groupEpoch: 3, issuedAt: p.clock.now(), expiresAt: p.clock.now() + 60000,
  };
  const credential = await signRoleCredentialClaims(p.a.identity, claims);
  const proposal: EnrolmentProposalV2 = {
    schema: ENROLMENT_V2_SCHEMA, version: 2, operation: 'add-member',
    transactionId: 'tx-001', requestId: 'request-001', convoyId, groupId,
    requester: {deviceId: 'bm1_joiner', fingerprint: 'fingerprint-joiner', keyEpoch: 1},
    approver: claims.subject, expectedEpoch: 3, nextEpoch: 4,
    rosterDigestBefore: 'roster-before', rosterDigestAfter: 'roster-after',
    credentialId: claims.credentialId, issuedAt: p.clock.now(), expiresAt: p.clock.now() + 60000,
  };
  const approval = await signProposedApproval(p.b.identity, proposal, credential);
  return {...p, claims, credential, proposal, approval};
}

test('Security v1 Ed25519 signs draft role/approval transcripts, but does not authorise roles', async () => {
  const x = await signedSample();
  expect((await inspectRoleCredentialSignature(x.b.identity, x.credential, x.aIdentity,
    x.clock.now(), x.claims.groupId, 3)).result).toBe('valid-signature-only');
  expect(await inspectProposedApprovalSignatures(x.a.identity, x.approval,
    x.aIdentity, x.bIdentity, x.clock.now(), 3)).toBe('signatures-valid-only');
  expect(SECURE_ENROLMENT_V3_ACTIVATION).toContain('disabled');
  expect(secureJoinReadinessV3.blockers.length).toBeGreaterThan(3);
});

test('forged owner, stale epoch, altered roster and swapped signer are rejected', async () => {
  const x = await signedSample();
  await expect(inspectRoleCredentialSignature(x.b.identity, {...x.credential, role: 'owner'},
    x.aIdentity, x.clock.now(), x.claims.groupId, 3)).rejects.toThrow();
  await expect(inspectRoleCredentialSignature(x.b.identity, x.credential,
    x.bIdentity, x.clock.now(), x.claims.groupId, 3)).rejects.toThrow();
  await expect(inspectRoleCredentialSignature(x.b.identity, x.credential,
    x.aIdentity, x.clock.now(), x.claims.groupId, 4)).rejects.toThrow();
  await expect(inspectRoleCredentialSignature(x.b.identity, x.credential,
    x.aIdentity, x.clock.now() + 61000, x.claims.groupId, 3)).rejects.toThrow();
  await expect(signRoleCredentialClaims(x.b.identity, x.claims)).rejects.toThrow();
  await expect(inspectProposedApprovalSignatures(x.a.identity, {...x.approval,
    proposal: {...x.proposal, rosterDigestAfter: 'forged-digest'}},
  x.aIdentity, x.bIdentity, x.clock.now(), 3)).rejects.toThrow();
  await expect(inspectProposedApprovalSignatures(x.a.identity, x.approval,
    x.aIdentity, x.aIdentity, x.clock.now(), 3)).rejects.toThrow();
  await expect(inspectProposedApprovalSignatures(x.a.identity, x.approval,
    x.aIdentity, x.bIdentity, x.clock.now(), 2)).rejects.toThrow();
  await expect(signProposedApproval(x.a.identity, x.proposal, x.credential)).rejects.toThrow();
});

test('strict draft wire parsing rejects extra carrier credentials and version downgrade', async () => {
  const x = await signedSample();
  expect(decodeProposedEnrolmentControl(encodeProposedEnrolmentControl(x.approval))).toEqual(x.approval);
  expect(() => encodeProposedEnrolmentControl({...x.approval, psk: 'secret'} as typeof x.approval)).toThrow();
  expect(() => encodeProposedEnrolmentControl({...x.approval,
    proposal: {...x.proposal, nextEpoch: 3}})).toThrow();
  expect(() => decodeProposedEnrolmentControl(utf8('{"kind":"approval","version":1,"psk":"secret"}')))
    .toThrow();
  expect(() => decodeProposedEnrolmentControl(new Uint8Array(8193))).toThrow();
  const ack = {kind: 'install-ack' as const, schema: ENROLMENT_V2_SCHEMA,
    version: 2 as const, transactionId: x.proposal.transactionId,
    convoyId: x.proposal.convoyId, groupId: x.proposal.groupId,
    recipient: x.proposal.requester, committedEpoch: 4,
    rosterDigest: x.proposal.rosterDigestAfter, issuedAt: x.clock.now(),
    signature: 'UNVERIFIED'};
  expect(decodeProposedEnrolmentControl(encodeProposedEnrolmentControl(ack))).toEqual(ack);
  expect(new SecurityV2ContractUnavailable().code).toBe('SECURITY_V2_CONTRACT_REQUIRED');
});

function observed() {
  return newJoinObservation({
    requestId: 'req001', convoyId: 'convoy001', groupId: 'bmg1_proposal-123',
    requester: {deviceId: 'bm1_peer', fingerprint: 'peer-fingerprint', keyEpoch: 1},
    expectedEpoch: 4, createdAt: 100000, expiresAt: 200000,
  });
}

test('replays, conflicting approvals, out-of-order events and stale epochs are rejected', () => {
  const start = observed();
  const approval = {id: 'e1', kind: 'approve' as const, atMs: 110000};
  const a = observeJoinEvent(start, approval);
  expect(a.phase).toBe('approved-awaiting-security-v2');
  expect(observeJoinEvent(a, approval)).toEqual(a);
  expect(() => observeJoinEvent(a, {...approval, atMs: 120000})).toThrow('Conflicting event ID');
  expect(() => observeJoinEvent(start, {id: 'skip-prepare', kind: 'commit-observed',
    atMs: 110000, committedEpoch: 5, rosterDigest: 'hash', recipients: ['bm1_peer']})).toThrow();
  expect(() => observeJoinEvent(a, {id: 'stale-prep', kind: 'prepare-observed',
    atMs: 115000, expectedEpoch: 3, nextEpoch: 4})).toThrow();
  expect(() => observeJoinEvent(a, {id: 'late', kind: 'approve', atMs: 200001}))
    .toThrow('Late enrolment message');
});

test('partial distribution and unverified ack cannot produce an authorised member', () => {
  let s = observeJoinEvent(observed(), {id: 'a', kind: 'approve', atMs: 110000});
  s = observeJoinEvent(s, {id: 'p', kind: 'prepare-observed',
    atMs: 115000, expectedEpoch: 4, nextEpoch: 5});
  expect(() => observeJoinEvent(s, {id: 'bad', kind: 'commit-observed',
    atMs: 120000, committedEpoch: 4, rosterDigest: 'roster', recipients: ['bm1_peer']})).toThrow();
  s = observeJoinEvent(s, {id: 'c', kind: 'commit-observed', atMs: 120000,
    committedEpoch: 5, rosterDigest: 'roster', recipients: ['bm1_peer', 'bm1_owner']});
  s = observeJoinEvent(s, {id: 'f', kind: 'delivery-observed',
    atMs: 130000, deviceId: 'bm1_owner', result: 'failed'});
  expect(s.phase).toBe('partial-delivery-unverified');
  expect(() => observeJoinEvent(s, {id: 'no-key', kind: 'ack-observed',
    atMs: 135000, deviceId: 'bm1_peer', committedEpoch: 5, rosterDigest: 'roster'})).toThrow();
  s = observeJoinEvent(s, {id: 'sent', kind: 'delivery-observed',
    atMs: 135000, deviceId: 'bm1_peer', result: 'sent'});
  expect(() => observeJoinEvent(s, {id: 'stale-ack', kind: 'ack-observed',
    atMs: 140000, deviceId: 'bm1_peer', committedEpoch: 4, rosterDigest: 'roster'})).toThrow();
  s = observeJoinEvent(s, {id: 'ack', kind: 'ack-observed',
    atMs: 140000, deviceId: 'bm1_peer', committedEpoch: 5, rosterDigest: 'roster'});
  expect(s.phase).toBe('ack-observed-unverified');
  expect((s as unknown as {authorized?: boolean}).authorized).toBeUndefined();
  expect(s.recipients.find(r => r.deviceId === 'bm1_owner')?.status).toBe('failed');
  expect(observeJoinEvent(s, {id: 'expire', kind: 'timeout', atMs: 200001})
    .phase).toBe('needs-reconciliation');
});

test('timeout, identity rotation and strict snapshot parsing fail closed', () => {
  expect(observeJoinEvent(observed(), {id: 'expired', kind: 'timeout', atMs: 200001}).phase)
    .toBe('expired');
  const blocked = observeJoinEvent(observed(), {
    id: 'rotate', kind: 'invalidate', reason: 'identity-rotation', atMs: 110000});
  expect(blocked.phase).toBe('blocked');
  expect(() => observeJoinEvent(blocked, {id: 'revive', kind: 'approve', atMs: 120000})).toThrow();
  expect(() => observeJoinEvent(observed(), {id: 'too-early', kind: 'timeout', atMs: 120000}))
    .toThrow();
  expect(() => parseJoinObservation({...observed(), secretHex: 'AABB'})).toThrow();
  expect(() => parseJoinObservation({...observed(), committedEpoch: 4, rosterDigest: 'bad'}))
    .toThrow();
  const journal = {schema: 'bushmesh-enrolment-journal-v3', version: 3,
    localIdentityRef: 'bm1_owner', records: [observed()]};
  expect(() => parseJoinObservationJournal({...journal, records: [observed(), observed()]}))
    .toThrow();
});

test('structural roster policy rejects silent deletion, identity swap and old-key reuse', async () => {
  const {a, aIdentity, bIdentity} = await pair();
  const group = await makeService(a).groups.createGroup('bmg1_roster-test',
    [{deviceId: aIdentity.deviceId, role: 'leader'}]);
  const requester = {deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint, keyEpoch: 1};
  const after: GroupRecord = {...group, currentEpoch: 2,
    members: [...group.members, {
      deviceId: requester.deviceId, identityFingerprint: requester.fingerprint,
      role: 'member' as const, state: 'active' as const, joinedAt: a.clock.now(),
    }],
    keyEpochs: [
      {...group.keyEpochs[0], state: 'rotated' as const, rotatedAt: a.clock.now()},
      {epoch: 2, keyRef: 'group/' + group.groupId + '/epoch-2',
        state: 'active' as const, createdAt: a.clock.now()},
    ],
  };
  expect(inspectIncrementalRosterTransition(group, after, requester).ok).toBe(true);
  expect(inspectIncrementalRosterTransition(group, {...after, members: after.members.slice(1)}, requester).ok)
    .toBe(false);
  expect(inspectIncrementalRosterTransition(group, {...after, members: [
    {...after.members[0], identityFingerprint: 'forged'}, after.members[1],
  ]}, requester).ok).toBe(false);
  expect(inspectIncrementalRosterTransition(group, {...after, currentEpoch: 1}, requester).ok)
    .toBe(false);
  expect(inspectIncrementalRosterTransition(group, {...after, keyEpochs: group.keyEpochs}, requester).ok)
    .toBe(false);
  expect(planRemainingEpochRecipients(after, aIdentity.deviceId)).toEqual([bIdentity.deviceId]);
  expect(reconcileJoinObservation(observed(), group, aIdentity.deviceId).phase)
    .toBe('needs-reconciliation');
});

test('real Security v1 authenticated request, owner approval, reboot recovery stay pending', async () => {
  const {clock, a, aIdentity, bIdentity, owner, peer, peerSessionId} = await pair();
  const convoy = await owner.membership.createConvoy('Join queue');
  const request = {id: 'bmr1_join100', convoyId: convoy.convoyId,
    deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint,
    createdAt: clock.now()};
  const message = await peer.sessions.encrypt(peerSessionId, encodeJoinRequestPayload(request), aad);
  const inbound = {envelope: message, context: aad,
    senderDeviceId: bIdentity.deviceId, senderFingerprint: bIdentity.fingerprint};
  const accepted = await owner.join.receiveAuthenticatedRequest(inbound);
  expect(accepted.phase).toBe('authenticated-request-observed');
  expect(accepted.authorized).toBe(false);
  await expect(owner.join.receiveAuthenticatedRequest(inbound))
    .rejects.toMatchObject({code: 'REPLAY_DETECTED'});
  expect((await owner.join.approvePendingRequest(request.id)).phase)
    .toBe('approved-awaiting-security-v2');
  expect(await owner.join.getKnownMemberAuthorization(convoy.convoyId, bIdentity.deviceId)).toBeNull();
  const recovered = new SecureJoinCompatibilityV3(owner.membership, owner.adapter,
    new ProtectedJoinObservationStore(a.secrets), () => clock.now());
  expect((await recovered.restorePendingRequest(request.id)).phase).toBe('approved-awaiting-security-v2');
  await expect(recovered.executeIncrementalEnrolment()).rejects.toMatchObject({
    code: 'SECURITY_V2_CONTRACT_REQUIRED'});
  expect((await recovered.getKnownMemberAuthorization(convoy.convoyId, aIdentity.deviceId))?.verifiedBy)
    .toBe('security-v1');
});

test('foreign direct identity is rejected, protected journal has no membership authority', async () => {
  const {clock, a, aIdentity, bIdentity, owner, peer, peerSessionId} = await pair();
  const convoy = await owner.membership.createConvoy('Wrong sender');
  const request = {id: 'bmr1_bad101', convoyId: convoy.convoyId,
    deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint,
    createdAt: clock.now()};
  const message = await peer.sessions.encrypt(peerSessionId, encodeJoinRequestPayload(request), aad);
  await expect(owner.join.receiveAuthenticatedRequest({
    envelope: message, context: aad, senderDeviceId: bIdentity.deviceId,
    senderFingerprint: 'forged-fingerprint',
  })).rejects.toBeDefined();
  expect((await owner.membership.listAdministration()).requests).toHaveLength(0);
  const inMemory = new MemoryJoinObservationStore();
  const j = await inMemory.load(aIdentity.deviceId);
  await inMemory.save(j);
  await expect(inMemory.load('bm1_mismatch')).rejects.toThrow();
  const store = new ProtectedJoinObservationStore(a.secrets);
  expect(store.isDurable()).toBe(false);
  await store.save({...j, records: [observed()]});
  const again = new ProtectedJoinObservationStore(a.secrets);
  expect((await again.load(aIdentity.deviceId)).records[0]).toEqual(observed());
  await expect(again.load('bm1_different')).rejects.toThrow();
  const bytes = await a.secrets.getSecret('bushmesh/convoy/enrolment-v3/observations');
  expect(Buffer.from(bytes!).toString('utf8')).not.toContain('keyMaterial');
  bytes?.fill(0);
});

test('trusted peer key rotation invalidates pinned request and never authorises a join', async () => {
  const {clock, a, b, bIdentity, owner, peer, peerSessionId} = await pair();
  const convoy = await owner.membership.createConvoy('Rotation');
  const request = {id: 'bmr1_rotate101', convoyId: convoy.convoyId,
    deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint,
    createdAt: clock.now()};
  const message = await peer.sessions.encrypt(peerSessionId, encodeJoinRequestPayload(request), aad);
  await owner.join.receiveAuthenticatedRequest({envelope: message, context: aad,
    senderDeviceId: bIdentity.deviceId, senderFingerprint: bIdentity.fingerprint});
  await owner.join.approvePendingRequest(request.id);
  const proof = await b.identity.rotateKeys();
  await a.trust.applyRotation(proof);
  owner.join.notifySecurityInvalidation();
  const restored = await owner.join.restorePendingRequest(request.id);
  expect(['blocked', 'needs-reconciliation', 'unavailable']).toContain(restored.phase);
  expect(restored.authorized).toBe(false);
});

test('v2 epoch-distribution wrapper binds intended peer, group and encrypted envelope structure', async () => {
  const x = await signedSample();
  const wrapped = {
    distributionVersion: 1 as const,
    groupId: x.proposal.groupId, epoch: 4,
    senderDeviceId: x.bIdentity.deviceId, senderFingerprint: x.bIdentity.fingerprint,
    recipientDeviceId: x.proposal.requester.deviceId,
    recipientFingerprint: x.proposal.requester.fingerprint,
    securityVersion: 1, protocolVersion: 1, sessionId: 'session-1',
    encryptedPayload: {securityVersion: 1, protocolVersion: 1, sessionId: 'session-1',
      keyEpoch: 1, counter: '1', ciphertext: 'abcdefghijklmnopqrstuvw'},
  };
  const draft = {kind: 'epoch-distribution' as const,
    schema: ENROLMENT_V2_SCHEMA, version: 2 as const,
    transactionId: x.proposal.transactionId, convoyId: x.proposal.convoyId,
    groupId: x.proposal.groupId, committedEpoch: 4,
    rosterDigest: x.proposal.rosterDigestAfter,
    credentialId: x.proposal.credentialId,
    sender: x.proposal.approver, recipient: x.proposal.requester,
    wrappedKey: wrapped, signature: 'unsigned-proposal'};
  expect(decodeProposedEnrolmentControl(encodeProposedEnrolmentControl(draft))).toEqual(draft);
  expect(() => encodeProposedEnrolmentControl({...draft,
    wrappedKey: {...wrapped, epoch: 3}})).toThrow();
  expect(() => encodeProposedEnrolmentControl({...draft,
    wrappedKey: {...wrapped, recipientFingerprint: 'attacker'}})).toThrow();
  expect(() => encodeProposedEnrolmentControl({...draft,
    wrappedKey: {...wrapped, encryptedPayload: ({...wrapped.encryptedPayload, psk: 'secret'} as typeof wrapped.encryptedPayload)}}))
    .toThrow();
});

test('remaining trusted member can reconnect and install fresh epoch after local revocation', async () => {
  const {clock, a, aIdentity, bIdentity, owner} = await pair();
  const third = createSecurityNode(clock);
  const thirdIdentity = await third.identity.loadOrCreate();
  await a.trust.observe(thirdIdentity);
  await a.trust.trust(thirdIdentity.deviceId, thirdIdentity.fingerprint);
  await third.trust.observe(aIdentity);
  await third.trust.trust(aIdentity.deviceId, aIdentity.fingerprint);
  const remaining = makeService(third);
  const convoy = await owner.membership.createConvoy('Recovery', [
    {deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint},
    {deviceId: thirdIdentity.deviceId, fingerprint: thirdIdentity.fingerprint},
  ]);
  const offer = await owner.sessions.createOffer(thirdIdentity.deviceId);
  const accepted = await remaining.sessions.acceptOffer(offer);
  const session = await owner.sessions.finalizeOffer(accepted.response);
  const wrap = () => owner.membership.wrapEnrolmentForMember({
    convoyId: convoy.convoyId, recipientDeviceId: thirdIdentity.deviceId,
    sessionId: session.sessionId, context: aad,
  });
  const initial = await wrap();
  await remaining.membership.installEnrolment({
    convoyId: convoy.convoyId, displayName: convoy.displayName,
    distribution: initial, context: aad,
  });
  const staleTraffic = await remaining.groups.encrypt(convoy.groupId, utf8('old'), aad);
  expect((await owner.join.revokeAndPlanRekey(convoy.convoyId, bIdentity.deviceId))
    .pendingRecipientDeviceIds).toContain(thirdIdentity.deviceId);
  await expect(owner.membership.wrapEnrolmentForMember({
    convoyId: convoy.convoyId, recipientDeviceId: thirdIdentity.deviceId,
    sessionId: 'missing-session', context: aad,
  })).rejects.toBeDefined();
  await expect(owner.groups.decrypt(staleTraffic, aad))
    .rejects.toMatchObject({code: 'ROTATED_KEY'});
  const refreshed = await wrap();
  expect(refreshed.epoch).toBe(2);
  await remaining.membership.installEnrolment({
    convoyId: convoy.convoyId, displayName: convoy.displayName,
    distribution: refreshed, context: aad,
  });
  const current = await remaining.groups.encrypt(convoy.groupId, utf8('reconnected'), aad);
  expect(await owner.groups.decrypt(current, aad)).toEqual(utf8('reconnected'));
  expect((await remaining.membership.resolveAuthorized(convoy.convoyId,
    thirdIdentity.deviceId))?.verifiedBy).toBe('security-v1');
});

test('real removal rotates local key; remaining members require rekey, global revocation unproved', async () => {
  const {clock, a, aIdentity, bIdentity, owner} = await pair();
  const third = createSecurityNode(clock);
  const thirdIdentity = await third.identity.loadOrCreate();
  await a.trust.observe(thirdIdentity);
  await a.trust.trust(thirdIdentity.deviceId, thirdIdentity.fingerprint);
  const convoy = await owner.membership.createConvoy('Rekey', [
    {deviceId: bIdentity.deviceId, fingerprint: bIdentity.fingerprint},
    {deviceId: thirdIdentity.deviceId, fingerprint: thirdIdentity.fingerprint},
  ]);
  const result = await owner.join.revokeAndPlanRekey(convoy.convoyId, bIdentity.deviceId);
  expect(result.localRekeyEpoch).toBe(2);
  expect(result.pendingRecipientDeviceIds).toEqual([thirdIdentity.deviceId]);
  expect(result.globallyRevoked).toBe(false);
  expect(await owner.join.getKnownMemberAuthorization(convoy.convoyId, aIdentity.deviceId))
    .not.toBeNull();
});
