import {encodeBushMeshAuthenticatedHeader} from '../src/bushmesh/protocol/securityBoundary';
import {DirectSessionManager} from '../src/security/session';
import {
  SecurityV2GroupTransactions,
} from '../src/security/v2/GroupTransactionsV2';
import {
  SECURITY_V2_PRODUCTION_ACTIVATION,
} from '../src/security/v2/contracts';
import type {
  GroupSnapshotV2, PrincipalV2,
} from '../src/security/v2/contracts';
import {
  roleCredentialTranscriptV2, roleRevocationTranscript, rosterDigestV2,
} from '../src/security/v2/canonical';
import {
  InMemorySecurityV2TransactionStore,
} from '../src/security/v2/testing/InMemorySecurityV2TransactionStore';
import {
  signProposedApproval, signRoleCredentialClaims,
} from '../src/convoy/enrolmentV3/roleCredential';
import type {
  EnrolmentProposalV2, SignedEnrolmentApprovalV2, SignedRoleCredentialV2,
} from '../src/convoy/enrolmentV3/contract';
import {toBase64Url} from '../src/security/bytes';
import {createSecurityNode, mutuallyTrust} from './securityTestHelpers';

const C = (sourceNodeId: number, destinationNodeId: number) => ({
  protocolVersion: 1,
  authenticatedHeader: Uint8Array.from(encodeBushMeshAuthenticatedHeader({
    protocolVersion: 1, packetType: 4, priority: 2, compression: 0,
    messageId: 42, ackRequested: true, storeAndForward: true,
  }, {sourceNodeId, destinationNodeId})),
});
const joinContext = C(2,1);
const distributionContext = C(1,2);
type Node = ReturnType<typeof createSecurityNode>;
function who(identity: {deviceId:string; fingerprint:string; keyEpoch:number}): PrincipalV2 {
  return {deviceId:identity.deviceId,fingerprint:identity.fingerprint,keyEpoch:identity.keyEpoch};
}
function makeManager(node: Node, sessions: DirectSessionManager,
  store: InMemorySecurityV2TransactionStore) {
  return new SecurityV2GroupTransactions(
    node.crypto, node.identity, node.trust, sessions, store, node.clock,
  );
}
async function sessionsFor(a: Node,b: Node) {
  const aSessions = new DirectSessionManager(
    a.crypto,a.secrets,a.metadata,a.identity,a.trust,a.versions,a.clock,
  );
  const bSessions = new DirectSessionManager(
    b.crypto,b.secrets,b.metadata,b.identity,b.trust,b.versions,b.clock,
  );
  const offer = await bSessions.createOffer((await a.identity.current()).deviceId);
  const accepted = await aSessions.acceptOffer(offer);
  const bSession = await bSessions.finalizeOffer(accepted.response);
  return {aSessions,bSessions,authoritySession:accepted.session,
    requesterSession:bSession};
}
async function setup() {
  const owner = createSecurityNode();
  const joiner = createSecurityNode();
  const {aIdentity,bIdentity} = await mutuallyTrust(owner,joiner);
  const ss = await sessionsFor(owner,joiner);
  const ownerStore = new InMemorySecurityV2TransactionStore();
  const joinerStore = new InMemorySecurityV2TransactionStore();
  const ownerManager = makeManager(owner,ss.aSessions,ownerStore);
  const joinerManager = makeManager(joiner,ss.bSessions,joinerStore);
  const genesis = await ownerManager.createOwnedGenesis(
    'bmc1_secure-convoy','bmg1_secure-convoy',1,
  );
  // External trusted ceremony is deliberately a separate step in this test.
  joinerStore.pinTrustedGenesis({
    groupId:genesis.groupId, genesisDigest:genesis.genesisDigest,
    ownerFingerprint:aIdentity.fingerprint,
  });
  return {owner,joiner,aIdentity,bIdentity,...ss,ownerStore,joinerStore,
    ownerManager,joinerManager,genesis};
}
type Setup = Awaited<ReturnType<typeof setup>>;
async function ownerCredential(s: Setup, group: GroupSnapshotV2):
  Promise<SignedRoleCredentialV2> {
  const now = s.owner.clock.now();
  return signRoleCredentialClaims(s.owner.identity,{
    schema:'bushmesh-convoy-role-credential-v2',version:2,
    credentialId:'cred.'+group.epoch, convoyId:group.convoyId,
    groupId:group.groupId,ownerAnchorFingerprint:group.genesis.owner.fingerprint,
    issuer:who(s.aIdentity),subject:who(s.aIdentity),
    role:'owner', authoritySequence:group.authoritySequence,
    groupEpoch:group.epoch, issuedAt:now, expiresAt:now+590_000,
  });
}
async function prepare(s: Setup, id='tx.first') {
  const group = (await s.ownerStore.loadGroup(s.genesis.groupId))!;
  const join = await s.joinerManager.signJoinRequest({
    convoyId:group.convoyId,groupId:group.groupId,requestId:'request.'+id,
    expectedEpoch:group.epoch,context:joinContext,
    expiresAt:s.joiner.clock.now()+590_000,
  });
  const nextRoster = [...group.roster,{
    ...who(s.bIdentity),state:'pending-install' as const,joinedAt:join.issuedAt,
  }];
  const digest = await rosterDigestV2(s.owner.crypto,group.groupId,group.epoch+1,nextRoster);
  const cred=await ownerCredential(s,group);
  const proposal:EnrolmentProposalV2={
    schema:'bushmesh-convoy-enrolment-v2',version:2,operation:'add-member',
    transactionId:id,requestId:join.requestId,
    convoyId:group.convoyId,groupId:group.groupId,
    requester:who(s.bIdentity),approver:who(s.aIdentity),
    expectedEpoch:group.epoch,nextEpoch:group.epoch+1,
    rosterDigestBefore:group.rosterDigest,rosterDigestAfter:digest,
    credentialId:cred.credentialId, issuedAt:s.owner.clock.now(),
    expiresAt:s.owner.clock.now()+590_000,
  };
  const approval=await signProposedApproval(s.owner.identity,proposal,cred);
  const input={join,approval,sessionId:s.authoritySession.sessionId,context:joinContext};
  return {...input,nextRoster,digest};
}
async function committed(s: Setup) {
  const prep=await prepare(s);
  await s.ownerManager.prepareAddMember(prep);
  const commit=await s.ownerManager.commitPreparedAddition(prep.approval.proposal.transactionId);
  return {prep,commit};
}

describe('Security v2 isolated group roster and key transactions',()=>{
  test('the entire core remains disabled for production activation',()=>{
    expect(SECURITY_V2_PRODUCTION_ACTIVATION).toBe('disabled-pending-formal-review');
  });

  test('approval and preparation never publish a new authorised member',async()=>{
    const s=await setup();
    const prep=await prepare(s);
    await s.ownerManager.prepareAddMember(prep);
    const current=await s.ownerStore.loadGroup(s.genesis.groupId);
    expect(current?.epoch).toBe(1);
    expect(current?.roster).toHaveLength(1);
    await expect(s.ownerManager.resolveCurrentMembership(
      s.genesis.groupId,who(s.bIdentity))).resolves.toMatchObject({authorized:false});
  });

  test('atomic commit creates new secret and keeps member pending until verified signed install ack',async()=>{
    const s=await setup();
    const {commit}=await committed(s);
    expect(commit.committedEpoch).toBe(2);
    expect(await s.ownerStore.getEpochKey(s.genesis.groupId,1)).toBeNull();
    expect(await s.ownerStore.getEpochKey(s.genesis.groupId,2)).toHaveLength(32);
    expect((await s.ownerManager.resolveCurrentMembership(
      s.genesis.groupId,who(s.bIdentity))).authorized).toBe(false);
    const wrapped=await s.ownerManager.wrapCommittedEpoch({
      transactionRef:commit.transactionRef, recipient:who(s.bIdentity),
      sessionId:s.authoritySession.sessionId,context:distributionContext,
    });
    const ack=await s.joinerManager.installCommittedEpoch({
      distribution:wrapped,context:distributionContext,
    });
    expect(ack.recipient).toEqual(who(s.bIdentity));
    expect((await s.ownerManager.resolveCurrentMembership(
      s.genesis.groupId,who(s.bIdentity))).authorized).toBe(false);
    await expect(s.ownerManager.verifyInstalledAck(ack,commit.transactionRef))
      .resolves.toBe(true);
    expect(await s.ownerManager.resolveCurrentMembership(
      s.genesis.groupId,who(s.bIdentity)))
      .toMatchObject({authorized:true,epoch:2});
  });

  test('replayed protected distribution cannot reinstall or rewind',async()=>{
    const s=await setup();const {commit}=await committed(s);
    const envelope=await s.ownerManager.wrapCommittedEpoch({
      transactionRef:commit.transactionRef,recipient:who(s.bIdentity),
      sessionId:s.authoritySession.sessionId,context:distributionContext,
    });
    await s.joinerManager.installCommittedEpoch({
      distribution:envelope,context:distributionContext,
    });
    await expect(s.joinerManager.installCommittedEpoch({
      distribution:envelope,context:distributionContext,
    })).rejects.toMatchObject({code:'REPLAY'});
  });

  test('rejects absent independent owner genesis pin even for valid signature',async()=>{
    const s=await setup();const {commit}=await committed(s);
    const envelope=await s.ownerManager.wrapCommittedEpoch({
      transactionRef:commit.transactionRef,recipient:who(s.bIdentity),
      sessionId:s.authoritySession.sessionId,context:distributionContext,
    });
    const unpinned=new InMemorySecurityV2TransactionStore();
    const receiver=makeManager(s.joiner,s.bSessions,unpinned);
    await expect(receiver.installCommittedEpoch({
      distribution:envelope,context:distributionContext,
    })).rejects.toMatchObject({code:'UNTRUSTED'});
  });

  test('forged owner credential signed with a different key is rejected',async()=>{
    const s=await setup();const p=await prepare(s);
    const fakeCredential={...p.approval.credential,
      signature:toBase64Url(await s.joiner.identity.sign(
        roleCredentialTranscriptV2(
          p.approval.credential),
      ))};
    const forgery:SignedEnrolmentApprovalV2={...p.approval,credential:fakeCredential};
    await expect(s.ownerManager.prepareAddMember({...p,approval:forgery}))
      .rejects.toMatchObject({code:'FORGED_AUTHORITY'});
  });

  test('tampered approval role and revoked role credentials never grant authority',async()=>{
    const s=await setup();const p=await prepare(s);
    const forged={...p.approval,credential:{...p.approval.credential,role:'admin' as const}};
    await expect(s.ownerManager.prepareAddMember({...p,approval:forged}))
      .rejects.toMatchObject({code:'FORGED_AUTHORITY'});
    const group=(await s.ownerStore.loadGroup(s.genesis.groupId))!;
    const revocation={
      kind:'bushmesh-v2-revoke-role' as const,version:2 as const,
      groupId:group.groupId,credentialId:p.approval.credential.credentialId,
      issuer:who(s.aIdentity),expectedAuthoritySequence:1,nextAuthoritySequence:2,
      issuedAt:s.owner.clock.now(),signature:'',
    };
    const sig=await s.owner.identity.sign(roleRevocationTranscript(revocation));
    await s.ownerManager.applyRoleRevocation({...revocation,signature:toBase64Url(sig)});
    await expect(s.ownerManager.prepareAddMember(p))
      .rejects.toMatchObject({code:'FORGED_AUTHORITY'});
  });

  test('duplicate identical prepare is idempotent but conflicting transaction ID fails',async()=>{
    const s=await setup();const p=await prepare(s);
    const one=await s.ownerManager.prepareAddMember(p);
    const two=await s.ownerManager.prepareAddMember(p);
    expect(one).toEqual(two);
    const modified={...p, approval:{...p.approval,
      signature:p.approval.credential.signature}};
    await expect(s.ownerManager.prepareAddMember(modified))
      .rejects.toMatchObject({code:'FORGED_AUTHORITY'});
  });

  test('new transaction reusing signed request ID is replay rejected by journal',async()=>{
    const s=await setup();const p=await prepare(s);
    await s.ownerManager.prepareAddMember(p);
    const p2=await prepare(s,'tx.other');
    const rewritten={...p2,join:p.join};
    await expect(s.ownerManager.prepareAddMember(rewritten))
      .rejects.toMatchObject({code:'CONFLICT'});
  });

  test('CAS rejects second approval after another epoch has already committed',async()=>{
    const s=await setup();const p=await prepare(s);
    await s.ownerManager.prepareAddMember(p);
    const next=await s.ownerManager.commitPreparedAddition(p.approval.proposal.transactionId);
    await expect(s.ownerManager.prepareAddMember(p))
      .rejects.toMatchObject({code:'CONFLICT'});
    expect(next.committedEpoch).toBe(2);
  });

  test('before-commit power loss leaves old roster; after-commit failure retries idempotently',async()=>{
    const a=await setup();const p=await prepare(a);
    await a.ownerManager.prepareAddMember(p);
    a.ownerStore.failOnce('before-commit');
    await expect(a.ownerManager.commitPreparedAddition(p.approval.proposal.transactionId))
      .rejects.toMatchObject({code:'STORE_UNAVAILABLE'});
    expect((await a.ownerStore.loadGroup(a.genesis.groupId))?.epoch).toBe(1);
    expect((await a.ownerStore.getTransaction(p.approval.proposal.transactionId))?.status)
      .toBe('prepared');
    a.ownerStore.failOnce('after-commit');
    await expect(a.ownerManager.commitPreparedAddition(p.approval.proposal.transactionId))
      .rejects.toMatchObject({code:'STORE_UNAVAILABLE'});
    const retry=await a.ownerManager.commitPreparedAddition(p.approval.proposal.transactionId);
    expect(retry.committedEpoch).toBe(2);
  });

  test('before-install failure preserves old state and requires a new protected envelope retry',async()=>{
    const s=await setup();const {commit}=await committed(s);
    const envelope=await s.ownerManager.wrapCommittedEpoch({
      transactionRef:commit.transactionRef,recipient:who(s.bIdentity),
      sessionId:s.authoritySession.sessionId,context:distributionContext,
    });
    s.joinerStore.failOnce('before-install');
    await expect(s.joinerManager.installCommittedEpoch({
      distribution:envelope,context:distributionContext,
    })).rejects.toMatchObject({code:'STORE_UNAVAILABLE'});
    expect((await s.joinerStore.loadGroup(s.genesis.groupId))).toBeNull();
    const retry=await s.ownerManager.wrapCommittedEpoch({
      transactionRef:commit.transactionRef,recipient:who(s.bIdentity),
      sessionId:s.authoritySession.sessionId,context:distributionContext,
    });
    await expect(s.joinerManager.installCommittedEpoch({
      distribution:retry,context:distributionContext,
    })).resolves.toMatchObject({committedEpoch:2});
  });

  test('power loss after atomic recipient install recovers signed ack without replaying ciphertext',async()=>{
    const s=await setup();const {commit}=await committed(s);
    const envelope=await s.ownerManager.wrapCommittedEpoch({
      transactionRef:commit.transactionRef,recipient:who(s.bIdentity),
      sessionId:s.authoritySession.sessionId,context:distributionContext,
    });
    s.joinerStore.failOnce('after-install');
    await expect(s.joinerManager.installCommittedEpoch({
      distribution:envelope,context:distributionContext,
    })).rejects.toMatchObject({code:'STORE_UNAVAILABLE'});
    expect((await s.joinerStore.loadGroup(s.genesis.groupId))?.epoch).toBe(2);
    const recovered=makeManager(s.joiner,s.bSessions,s.joinerStore);
    const signedAck=await recovered.recoverInstalledAck({
      distribution:envelope,context:distributionContext,
    });
    await expect(s.ownerManager.verifyInstalledAck(signedAck,commit.transactionRef))
      .resolves.toBe(true);
    expect((await s.ownerManager.resolveCurrentMembership(
      s.genesis.groupId,who(s.bIdentity))).authorized).toBe(true);
  });

  test('protected epoch high-water catches ordinary snapshot rollback and corrupt recovery',async()=>{
    const s=await setup();await committed(s);
    s.ownerStore.unsafeRollbackGroup(s.genesis.groupId,s.genesis);
    expect(await s.ownerStore.getEpochHighWater(s.genesis.groupId)).toBe(2);
    await expect(s.ownerManager.resolveCurrentMembership(s.genesis.groupId,who(s.aIdentity)))
      .resolves.toMatchObject({authorized:false,reason:'corrupt-or-rolled-back'});
    await expect(s.ownerManager.createOwnedGenesis('another','bmg1_secure-convoy',1))
      .rejects.toMatchObject({code:'CONFLICT'});
  });

  test('missing protected current key blocks membership and distribution',async()=>{
    const s=await setup();const {commit}=await committed(s);
    s.ownerStore.unsafeDeleteEpochKey(s.genesis.groupId,2);
    await expect(s.ownerManager.resolveCurrentMembership(s.genesis.groupId,who(s.aIdentity)))
      .resolves.toMatchObject({authorized:false,reason:'not-installed'});
    await expect(s.ownerManager.wrapCommittedEpoch({
      transactionRef:commit.transactionRef,recipient:who(s.bIdentity),
      sessionId:s.authoritySession.sessionId,context:distributionContext,
    })).rejects.toMatchObject({code:'KEY_MISSING'});
  });

  test('peer identity rotation invalidates the old session and pinned requester',async()=>{
    const s=await setup();const p=await prepare(s);
    const proof=await s.joiner.identity.rotateKeys();
    await s.owner.trust.applyRotation(proof);
    await expect(s.ownerManager.prepareAddMember(p)).rejects.toMatchObject({
      code:'ROTATED_KEY',
    });
  });

  test('revoked peer cannot reuse an otherwise authenticated pending direct session',async()=>{
    const s=await setup();
    const p=await prepare(s);
    await s.owner.trust.revoke(s.bIdentity.deviceId,'stolen convoy handset');
    await expect(s.ownerManager.prepareAddMember(p))
      .rejects.toMatchObject({code:'PEER_REVOKED'});
    expect((await s.ownerStore.loadGroup(s.genesis.groupId))?.epoch).toBe(1);
  });

  test('stale credentials and peer revocation after prepare prevent CAS commit',async()=>{
    const expired=await setup();
    const x=await prepare(expired);
    await expired.ownerManager.prepareAddMember(x);
    expired.owner.clock.advance(590_001);
    await expect(expired.ownerManager.commitPreparedAddition(x.approval.proposal.transactionId))
      .rejects.toMatchObject({code:'EXPIRED'});
    expect((await expired.ownerStore.loadGroup(expired.genesis.groupId))?.epoch).toBe(1);

    const revoked=await setup();
    const p=await prepare(revoked);
    await revoked.ownerManager.prepareAddMember(p);
    await revoked.owner.trust.revoke(revoked.bIdentity.deviceId,'revoked while queued');
    await expect(revoked.ownerManager.commitPreparedAddition(p.approval.proposal.transactionId))
      .rejects.toMatchObject({code:'UNTRUSTED'});
    expect((await revoked.ownerStore.loadGroup(revoked.genesis.groupId))?.epoch).toBe(1);
  });

  test('downgrade and immutable Protocol v1 AAD tampering fail closed',async()=>{
    const s=await setup();const p=await prepare(s);
    await expect(s.ownerManager.prepareAddMember({...p,join:{...p.join,version:1 as 2}}))
      .rejects.toMatchObject({code:'DOWNGRADE'});
    await expect(s.ownerManager.prepareAddMember({...p,context:C(7,9)}))
      .rejects.toMatchObject({code:'CONFLICT'});
    await expect(s.ownerManager.prepareAddMember({...p,
      context:{...joinContext,protocolVersion:2}}))
      .rejects.toMatchObject({code:'DOWNGRADE'});
  });

  test('tampered signed distribution and failed ack cannot authorize',async()=>{
    const s=await setup();const {commit}=await committed(s);
    const v=await s.ownerManager.wrapCommittedEpoch({
      transactionRef:commit.transactionRef,recipient:who(s.bIdentity),
      sessionId:s.authoritySession.sessionId,context:distributionContext,
    });
    await expect(s.joinerManager.installCommittedEpoch({
      distribution:{...v,rosterDigest:'forged'},context:distributionContext,
    })).rejects.toMatchObject({code:'CONFLICT'});
    const ack=await s.joinerManager.installCommittedEpoch({
      distribution:v,context:distributionContext,
    });
    await expect(s.ownerManager.verifyInstalledAck({...ack,signature:v.signature},
      commit.transactionRef)).rejects.toMatchObject({code:'FORGED_AUTHORITY'});
    expect((await s.ownerManager.resolveCurrentMembership(
      s.genesis.groupId,who(s.bIdentity))).authorized).toBe(false);
    await expect(s.ownerManager.verifyInstalledAck(ack,commit.transactionRef))
      .resolves.toBe(true);
  });


  test('concurrent competing approvals are CAS-serialized: exactly one fresh epoch commits',async()=>{
    const s=await setup();
    const first=await prepare(s,'tx.concurrent-a');
    const second=await prepare(s,'tx.concurrent-b');
    await Promise.all([
      s.ownerManager.prepareAddMember(first),
      s.ownerManager.prepareAddMember(second),
    ]);
    const results=await Promise.allSettled([
      s.ownerManager.commitPreparedAddition(first.approval.proposal.transactionId),
      s.ownerManager.commitPreparedAddition(second.approval.proposal.transactionId),
    ]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
    expect((await s.ownerStore.loadGroup(s.genesis.groupId))?.epoch).toBe(2);
    expect((await s.ownerStore.loadGroup(s.genesis.groupId))?.roster).toHaveLength(2);
  });

  test('disconnected member can install a newer owner-signed epoch and requires a new ack',async()=>{
    const s=await setup();
    const {commit:firstCommit}=await committed(s);
    const firstEnvelope=await s.ownerManager.wrapCommittedEpoch({
      transactionRef:firstCommit.transactionRef,recipient:who(s.bIdentity),
      sessionId:s.authoritySession.sessionId,context:distributionContext,
    });
    const firstAck=await s.joinerManager.installCommittedEpoch({
      distribution:firstEnvelope,context:distributionContext,
    });
    await s.ownerManager.verifyInstalledAck(firstAck,firstCommit.transactionRef);

    const third=createSecurityNode();
    const {bIdentity: thirdIdentity}=await mutuallyTrust(s.owner,third);
    await mutuallyTrust(s.joiner,third);
    const thirdSessions=await sessionsFor(s.owner,third);
    const ownerForThird=makeManager(s.owner,thirdSessions.aSessions,s.ownerStore);
    const thirdStore=new InMemorySecurityV2TransactionStore();
    thirdStore.pinTrustedGenesis({
      groupId:s.genesis.groupId,genesisDigest:s.genesis.genesisDigest,
      ownerFingerprint:s.aIdentity.fingerprint,
    });
    const thirdMgr=makeManager(third,thirdSessions.bSessions,thirdStore);
    const current=(await s.ownerStore.loadGroup(s.genesis.groupId))!;
    const signedJoin=await thirdMgr.signJoinRequest({
      convoyId:current.convoyId,groupId:current.groupId,requestId:'request.next',
      expectedEpoch:current.epoch,context:joinContext,
      expiresAt:third.clock.now()+590_000,
    });
    const roster=[...current.roster,{...who(thirdIdentity),
      state:'pending-install' as const,joinedAt:signedJoin.issuedAt}];
    const nextDigest=await rosterDigestV2(s.owner.crypto,current.groupId,3,roster);
    const credential=await ownerCredential(s,current);
    const proposal:EnrolmentProposalV2={
      schema:'bushmesh-convoy-enrolment-v2',version:2,operation:'add-member',
      transactionId:'tx.next',requestId:signedJoin.requestId,
      convoyId:current.convoyId,groupId:current.groupId,
      requester:who(thirdIdentity),approver:who(s.aIdentity),
      expectedEpoch:2,nextEpoch:3,rosterDigestBefore:current.rosterDigest,
      rosterDigestAfter:nextDigest,credentialId:credential.credentialId,
      issuedAt:s.owner.clock.now(),expiresAt:s.owner.clock.now()+590_000,
    };
    const approval=await signProposedApproval(s.owner.identity,proposal,credential);
    await ownerForThird.prepareAddMember({
      join:signedJoin,approval,sessionId:thirdSessions.authoritySession.sessionId,
      context:joinContext,
    });
    await ownerForThird.commitPreparedAddition('tx.next');
    expect((await s.ownerManager.resolveCurrentMembership(
      s.genesis.groupId,who(s.bIdentity))).authorized).toBe(false);

    // The previously installed member was disconnected during the rekey.
    // It installs only when it reconnects through its already-trusted session.
    const catchup=await s.ownerManager.wrapCommittedEpoch({
      transactionRef:'tx.next',recipient:who(s.bIdentity),
      sessionId:s.authoritySession.sessionId,context:distributionContext,
    });
    const catchupAck=await s.joinerManager.installCommittedEpoch({
      distribution:catchup,context:distributionContext,
    });
    expect((await s.joinerStore.loadGroup(s.genesis.groupId))?.epoch).toBe(3);
    await s.ownerManager.verifyInstalledAck(catchupAck,'tx.next');
    expect((await s.ownerManager.resolveCurrentMembership(
      s.genesis.groupId,who(s.bIdentity))).authorized).toBe(true);

    // A brand-new member with only a trusted genesis pin skips epochs 1/2.
    const thirdEnvelope=await ownerForThird.wrapCommittedEpoch({
      transactionRef:'tx.next',recipient:who(thirdIdentity),
      sessionId:thirdSessions.authoritySession.sessionId,context:distributionContext,
    });
    const thirdAck=await thirdMgr.installCommittedEpoch({
      distribution:thirdEnvelope,context:distributionContext,
    });
    expect((await thirdStore.loadGroup(current.groupId))?.epoch).toBe(3);
    await ownerForThird.verifyInstalledAck(thirdAck,'tx.next');
  });

  test('signed local epoch invalidation prevents stale group membership after restart',async()=>{
    const s=await setup();await committed(s);
    await s.ownerManager.invalidateCurrentEpoch(s.genesis.groupId);
    const recovered=makeManager(s.owner,s.aSessions,s.ownerStore);
    await expect(recovered.resolveCurrentMembership(s.genesis.groupId,who(s.aIdentity)))
      .resolves.toMatchObject({authorized:false,reason:'corrupt-or-rolled-back'});
    await expect(recovered.commitPreparedAddition('tx.first'))
      .rejects.toMatchObject({code:'REVOKED'});
  });
});
