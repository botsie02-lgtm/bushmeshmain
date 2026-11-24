import {Buffer} from 'buffer';
import type {ProposedAndroidSecurityV2NativeBridge} from
  '../src/security/v2/platform/androidConvergence';
import {ReviewOnlyAndroidV2TransactionAdapter} from
  '../src/security/v2/testing/ReviewOnlyAndroidV2TransactionAdapter';
import {InMemorySecurityV2TransactionStore} from
  '../src/security/v2/testing/InMemorySecurityV2TransactionStore';
import type {GroupSnapshotV2, PinnedOwnerAnchorV2, PreparedAdditionV2,
  RosterMemberV2} from '../src/security/v2/contracts';
import {SECURITY_V2_PRODUCTION_ACTIVATION} from '../src/security/v2/contracts';

const id = 'bmg1_convoystore123';
const owner = {
  identityVersion: 1 as const, deviceId: 'bm1_ownertest123',
  fingerprint: 'p'.repeat(43), keyEpoch: 1, signingPublicKey: 'a'.repeat(43),
  agreementPublicKey: 'b'.repeat(43), createdAt: 1000,
};
const joiner = {deviceId: 'bm1_jointest234',fingerprint: 'q'.repeat(43),keyEpoch: 1};
const beforeDigest = 'a'.repeat(43);
const afterDigest = 'b'.repeat(43);
const proposalDigest = 'c'.repeat(43);
const issuedDigest = 'd'.repeat(43);
const ackDigest = 'e'.repeat(43);

function fixture() {
  const genesis = {
    kind: 'bushmesh-v2-owner-genesis' as const, version: 2 as const,
    convoyId: 'bmc1_test', groupId: id, owner, protocolVersion: 1,
    createdAt: 1000, signature: 'signed-genesis-only-in-test',
  };
  const anchor: PinnedOwnerAnchorV2 = {
    groupId: id, ownerFingerprint: owner.fingerprint,
    genesisDigest: 'z'.repeat(43),
  };
  const member: RosterMemberV2 = {
    deviceId: owner.deviceId, fingerprint:owner.fingerprint,
    keyEpoch:1, state:'active', joinedAt:1000,
  };
  const base: GroupSnapshotV2 = {
    version:2,convoyId:genesis.convoyId,groupId:id,genesis,
    genesisDigest: anchor.genesisDigest,protocolVersion:1,epoch:1,
    currentTransactionId:null,rosterDigest:beforeDigest,
    roster:[member],authoritySequence:1,
    revokedCredentials:[],state:'active',
  };
  const joined: RosterMemberV2 = {...joiner,state:'pending-install',joinedAt:1200};
  const next: GroupSnapshotV2 = {
    ...base,epoch:2,rosterDigest:afterDigest,
    currentTransactionId:'tx.test',roster:[member,joined],
  };
  const proposal = {
    schema:'bushmesh-convoy-enrolment-v2' as const,version:2 as const,
    operation:'add-member' as const,transactionId:'tx.test',
    requestId:'request.test',convoyId:base.convoyId,groupId:id,
    requester:joiner,approver: {
      deviceId:owner.deviceId,fingerprint:owner.fingerprint,keyEpoch:1,
    },expectedEpoch:1,nextEpoch:2,rosterDigestBefore:beforeDigest,
    rosterDigestAfter:afterDigest,credentialId:'credential.test',
    issuedAt:1100,expiresAt:900000,
  };
  const transaction: PreparedAdditionV2 = {
    transactionId:proposal.transactionId,requestId:proposal.requestId,
    proposalDigest,expectedEpoch:1,nextEpoch:2,
    join:{
      kind:'bushmesh-v2-join-request',version:2,convoyId:base.convoyId,
      groupId:id,requestId:proposal.requestId,requester:joiner,
      expectedEpoch:1,aadDigest:'x'.repeat(43),
      issuedAt:1100,expiresAt:900000,signature:'signature-test-only',
    },
    approval:{
      kind:'approval',proposal,signature:'signature-test-only',
      credential:{
        schema:'bushmesh-convoy-role-credential-v2',version:2,
        credentialId:'credential.test',convoyId:base.convoyId,groupId:id,
        ownerAnchorFingerprint:owner.fingerprint,
        subject:proposal.approver,role:'owner',issuer:proposal.approver,
        authoritySequence:1,groupEpoch:1,issuedAt:1100,
        expiresAt:900000,signature:'signature-test-only',
      },
    },
    nextRoster:next.roster,nextRosterDigest:afterDigest,status:'prepared',
    preparedAt:1100,verifiedReceipts:{},issuedDistributions:{},
  };
  return {base,next,anchor,transaction};
}

/**
 * JavaScript fake is deliberately NOT an Android crypto or hardware provider.
 * It models the proposed React Native method surface on top of the existing
 * deterministic memory-only transaction store, for adapter contract tests.
 */
function bridgeFixture() {
  const memory = new InMemorySecurityV2TransactionStore();
  let externallyApproved: PinnedOwnerAnchorV2 | null = null;
  const wrapped = (value: unknown) => value === null ? null : JSON.stringify(value);
  const b64 = (bytes: Uint8Array | null) =>
    bytes === null ? null : Buffer.from(bytes).toString('base64');
  const bridge: ProposedAndroidSecurityV2NativeBridge = {
    v2DescribeCapabilities: jest.fn(async()=>JSON.stringify({
      schemaVersion:2,hardwareRollbackResistantEpochFence:false,
      enabledInApplication:false,testingOnly:true,
    })),
    v2ProvisionApprovedOwnerAnchor: jest.fn(async()=>{
      throw new Error('No real owner ceremony exists in the test fake');
    }),
    v2ReadOwnerAnchor: jest.fn(async (groupId:string) =>
      wrapped(await memory.getPinnedGenesis(groupId) ?? (
        externallyApproved?.groupId === groupId ? externallyApproved : null))),
    v2ReadGroup: jest.fn(async groupId => wrapped(await memory.loadGroup(groupId))),
    v2ReadEpochFence: jest.fn(async groupId =>
      String(await memory.getEpochHighWater(groupId))),
    v2ReadEpochSecret: jest.fn(async (groupId,epoch) =>
      b64(await memory.getEpochKey(groupId,Number(epoch)))),
    v2ReadPreparedTransaction: jest.fn(async txId =>
      wrapped(await memory.getTransaction(txId))),
    v2ReadInstalledDistribution: jest.fn(txId => memory.getInstalledDistribution(txId)),
    v2ReadVerifiedReceipt: jest.fn((txId,who) =>
      memory.getVerifiedReceipt(txId,who)),
    v2RecordIssuedDistribution: jest.fn(async(txId,recipient,digest)=>{
      await memory.recordIssuedDistribution(txId,recipient,digest);
      return 'recorded';
    }),
    v2AtomicCreateOwnerGroup: jest.fn(async (raw,anchorRaw,keyB64)=>{
      await memory.initializeOwnedGroup(
        JSON.parse(raw) as GroupSnapshotV2,
        JSON.parse(anchorRaw) as PinnedOwnerAnchorV2,
        Uint8Array.from(Buffer.from(keyB64,'base64')),
      );
      return 'created';
    }),
    v2AtomicPrepareAddition: jest.fn(async(expected,before,raw) =>
      JSON.stringify(await memory.prepareAddition(
        Number(expected),before,JSON.parse(raw) as PreparedAdditionV2))),
    v2AtomicCommitAddition: jest.fn(async(txId,raw,keyB64)=>{
      const prior = await memory.getTransaction(txId);
      await memory.commitAddition(txId,JSON.parse(raw) as GroupSnapshotV2,
        Uint8Array.from(Buffer.from(keyB64,'base64')));
      return prior?.status === 'committed' ?
        'already-committed-identical' : 'committed';
    }),
    v2AtomicInstallEpoch: jest.fn(async(txId,digest,raw,keyB64)=>
      await memory.installEpoch(txId,digest,JSON.parse(raw) as GroupSnapshotV2,
        Uint8Array.from(Buffer.from(keyB64,'base64'))) === 'installed' ?
        'installed' : 'already-installed-identical'),
    v2AtomicVerifiedReceipt: jest.fn(async(txId,recipient,digest)=>{
      await memory.recordVerifiedReceipt(txId,recipient,digest);
      return 'verified';
    }),
    v2AtomicInvalidateEpoch: jest.fn(async(groupId,expected)=>{
      await memory.invalidateEpoch(groupId,Number(expected));
      return 'invalidated';
    }),
    v2AtomicRevokeCredential: jest.fn(async(groupId,seq,cred)=>{
      await memory.revokeCredential(groupId,Number(seq),cred);
      return 'revoked';
    }),
  };
  const adapter = ReviewOnlyAndroidV2TransactionAdapter.createForDeterministicTests(
    bridge,'isolated-deterministic-tests-only',
  );
  return {
    bridge, memory, adapter,
    approveTestPin: (anchor: PinnedOwnerAnchorV2) => {externallyApproved=anchor;},
  };
}

describe('Wave5 unregistered Android V2 transaction bridge adapter',()=>{
  test('no live activation or production adapter factory',()=>{
    expect(SECURITY_V2_PRODUCTION_ACTIVATION).toBe('disabled-pending-formal-review');
    expect(typeof ReviewOnlyAndroidV2TransactionAdapter.createForDeterministicTests)
      .toBe('function');
    expect(Object.keys(ReviewOnlyAndroidV2TransactionAdapter))
      .not.toContain('createProduction');
  });

  test('missing independent owner pin rejects genesis before native mutation',async()=>{
    const f=fixture(), node=bridgeFixture();
    await expect(node.adapter.initializeOwnedGroup(
      f.base,f.anchor,new Uint8Array(32).fill(1)))
      .rejects.toMatchObject({code:'UNTRUSTED'});
    expect(node.bridge.v2AtomicCreateOwnerGroup).not.toHaveBeenCalled();
    expect(node.bridge.v2ProvisionApprovedOwnerAnchor).not.toHaveBeenCalled();
  });

  test('prepared journal is non-publishing, native CAS is idempotent and old epoch key retires',async()=>{
    const f=fixture(), node=bridgeFixture();
    node.approveTestPin(f.anchor); // OUT-OF-BAND TEST MODEL, no real trust.
    await node.adapter.initializeOwnedGroup(f.base,f.anchor,new Uint8Array(32).fill(1));
    await node.adapter.prepareAddition(1,beforeDigest,f.transaction);
    expect((await node.adapter.loadGroup(id))?.roster).toHaveLength(1);
    await node.adapter.prepareAddition(1,beforeDigest,f.transaction);
    expect((await node.adapter.getTransaction('tx.test'))?.status).toBe('prepared');
    await node.adapter.commitAddition('tx.test',f.next,new Uint8Array(32).fill(2));
    const second=await node.adapter.commitAddition('tx.test',f.next,new Uint8Array(32).fill(3));
    expect(second.status).toBe('committed');
    expect(await node.adapter.getEpochHighWater(id)).toBe(2);
    expect(await node.adapter.getEpochKey(id,1)).toBeNull();
    expect(await node.adapter.getEpochKey(id,2)).toHaveLength(32);
    expect((await node.adapter.loadGroup(id))?.roster[1].state).toBe('pending-install');
  });

  test('simulated post-SQLite-commit bridge failure recovers by reading exact journal',async()=>{
    const f=fixture(), node=bridgeFixture();
    node.approveTestPin(f.anchor);
    await node.adapter.initializeOwnedGroup(f.base,f.anchor,new Uint8Array(32).fill(1));
    await node.adapter.prepareAddition(1,beforeDigest,f.transaction);
    node.memory.failOnce('after-commit');
    await expect(node.adapter.commitAddition(
      'tx.test',f.next,new Uint8Array(32).fill(2)))
      .rejects.toMatchObject({code:'STORE_UNAVAILABLE'});
    const journal=await node.adapter.getTransaction('tx.test');
    expect(journal?.status).toBe('committed');
    expect(journal?.proposalDigest).toBe(proposalDigest);
    expect((await node.adapter.loadGroup(id))?.epoch).toBe(2);
    await expect(node.adapter.commitAddition('tx.test',f.next,
      new Uint8Array(32).fill(3))).resolves.toMatchObject({status:'committed'});
  });

  test('same transaction ID with different digest cannot replace prepared plan',async()=>{
    const f=fixture(), node=bridgeFixture();
    node.approveTestPin(f.anchor);
    await node.adapter.initializeOwnedGroup(f.base,f.anchor,new Uint8Array(32).fill(1));
    await node.adapter.prepareAddition(1,beforeDigest,f.transaction);
    await expect(node.adapter.prepareAddition(1,beforeDigest,{
      ...f.transaction,proposalDigest:'other_digest',
    })).rejects.toMatchObject({code:'CONFLICT'});
    expect((await node.adapter.loadGroup(id))?.epoch).toBe(1);
  });

  test('verified ack cannot precede issued ciphertext; duplicate signed receipt is idempotent',async()=>{
    const f=fixture(), node=bridgeFixture();
    node.approveTestPin(f.anchor);
    await node.adapter.initializeOwnedGroup(f.base,f.anchor,new Uint8Array(32).fill(1));
    await node.adapter.prepareAddition(1,beforeDigest,f.transaction);
    await node.adapter.commitAddition('tx.test',f.next,new Uint8Array(32).fill(2));
    await expect(node.adapter.recordVerifiedReceipt('tx.test',joiner.deviceId,ackDigest))
      .rejects.toMatchObject({code:'NOT_COMMITTED'});
    await node.adapter.recordIssuedDistribution('tx.test',joiner.deviceId,issuedDigest);
    await expect(node.adapter.recordVerifiedReceipt('tx.test',joiner.deviceId,ackDigest))
      .resolves.toBe(true);
    await expect(node.adapter.recordVerifiedReceipt('tx.test',joiner.deviceId,ackDigest))
      .resolves.toBe(true);
    expect(await node.adapter.getVerifiedReceipt('tx.test',joiner.deviceId)).toBe(ackDigest);
    await expect(node.adapter.recordVerifiedReceipt('tx.test',joiner.deviceId,'different'))
      .rejects.toMatchObject({code:'REPLAY'});
  });

  test('recipient install requires prior owner pin and rejects duplicate/stale epoch',async()=>{
    const f=fixture(), node=bridgeFixture();
    await expect(node.adapter.installEpoch('tx.test',issuedDigest,
      f.next,new Uint8Array(32).fill(9))).rejects.toMatchObject({code:'STALE_EPOCH'});
    // Only test fixture permits an out-of-band pin, NEVER a production ceremony.
    node.memory.pinTrustedGenesis(f.anchor);
    expect(await node.adapter.installEpoch('tx.test',issuedDigest,
      f.next,new Uint8Array(32).fill(9))).toBe('installed');
    expect(await node.adapter.installEpoch('tx.test',issuedDigest,
      f.next,new Uint8Array(32).fill(8))).toBe('duplicate');
    await expect(node.adapter.installEpoch('tx.new','other-digest',
      f.next,new Uint8Array(32).fill(8))).rejects.toMatchObject({code:'STALE_EPOCH'});
  });

  test('role revocation sequence persists; ordinary metadata rollback is detected',async()=>{
    const f=fixture(), node=bridgeFixture();
    node.approveTestPin(f.anchor);
    await node.adapter.initializeOwnedGroup(f.base,f.anchor,new Uint8Array(32).fill(1));
    await node.adapter.revokeCredential(id,1,'credential.test');
    expect((await node.adapter.loadGroup(id))?.authoritySequence).toBe(2);
    await expect(node.adapter.revokeCredential(id,1,'credential.test'))
      .rejects.toMatchObject({code:'CONFLICT'});
    node.memory.unsafeRollbackGroup(id,f.base);
    // In-memory independent fence stays at epoch 1, so this reversion of role
    // sequence alone is NOT detectable. This is a formal anti-rollback blocker.
    expect((await node.adapter.loadGroup(id))?.authoritySequence).toBe(1);
  });

  test('malformed epoch from fake native bridge is not silently truncated',async()=>{
    const f=fixture(), node=bridgeFixture();
    node.approveTestPin(f.anchor);
    await node.adapter.initializeOwnedGroup(f.base,f.anchor,new Uint8Array(32).fill(1));
    (node.bridge.v2ReadEpochFence as jest.Mock).mockResolvedValueOnce('4294967296');
    await expect(node.adapter.getEpochHighWater(id))
      .rejects.toMatchObject({code:'CORRUPT_STATE'});
    (node.bridge.v2ReadEpochFence as jest.Mock).mockResolvedValueOnce('1e3');
    await expect(node.adapter.getEpochHighWater(id))
      .rejects.toMatchObject({code:'CORRUPT_STATE'});
  });
});
