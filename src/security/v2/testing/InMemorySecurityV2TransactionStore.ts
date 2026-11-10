import type {
  GroupSnapshotV2, PinnedOwnerAnchorV2, PreparedAdditionV2, SecurityV2TransactionalStore,
} from '../contracts';
import {SecurityV2Error} from '../contracts';
import {canonicalValue} from '../canonical';

/**
 * DETERMINISTIC TEST STORE ONLY. No disk persistence, encryption, isolation
 * between app processes or hardware anti-rollback. The state pointer swap
 * models atomicity; the separate fence models an independent rollback domain.
 */
type Root = {
  groups: Map<string, GroupSnapshotV2>;
  keys: Map<string, Uint8Array>;
  anchors: Map<string, PinnedOwnerAnchorV2>;
  transactions: Map<string, PreparedAdditionV2>;
  installed: Map<string, string>;
};
type Fault = 'before-commit' | 'after-commit' | 'before-install' | 'after-install';

function copy<T>(item: T): T {
  return JSON.parse(JSON.stringify(item)) as T;
}
function conflict(message: string): never {
  throw new SecurityV2Error('CONFLICT', message);
}
function keyId(groupId: string, epoch: number): string {
  return groupId + '/epoch-' + String(epoch);
}

export class InMemorySecurityV2TransactionStore implements SecurityV2TransactionalStore {
  private root: Root = {
    groups: new Map(), keys: new Map(), anchors: new Map(),
    transactions: new Map(), installed: new Map(),
  };
  private readonly epochFence = new Map<string, number>();
  private fault: Fault | null = null;

  private nextState(): Root {
    return {
      groups: new Map([...this.root.groups].map(([k,v]) => [k, copy(v)])),
      keys: new Map([...this.root.keys].map(([k,v]) => [k, v.slice()])),
      anchors: new Map([...this.root.anchors].map(([k,v]) => [k, copy(v)])),
      transactions: new Map([...this.root.transactions].map(([k,v]) => [k, copy(v)])),
      installed: new Map(this.root.installed),
    };
  }
  /** Test-only failpoint: before swap leaves no commit, after swap leaves a committed result. */
  failOnce(at: Fault): void {this.fault = at;}
  private fail(at: Fault): void {
    if (this.fault === at) {
      this.fault = null;
      throw new SecurityV2Error('STORE_UNAVAILABLE', 'Simulated power loss at ' + at);
    }
  }
  private swap(next: Root, groupId: string, newEpoch?: number): void {
    // This synchronous pair is a TEST MODEL, NOT an implementable guarantee
    // across independent filesystem/Keystore domains. A real provider must
    // document durable atomic protocol or fail closed on uncertain completion.
    if (newEpoch !== undefined) {
      const high = this.epochFence.get(groupId) ?? 0;
      if (newEpoch <= high) {
        throw new SecurityV2Error('STALE_EPOCH', 'Protected epoch fence is not advancing');
      }
    }
    this.root = next;
    if (newEpoch !== undefined) {this.epochFence.set(groupId, newEpoch);}
  }
  /** Simulates an independently verified user/platform owner root pin. */
  pinTrustedGenesis(anchor: PinnedOwnerAnchorV2): void {
    const old = this.root.anchors.get(anchor.groupId);
    if (old && canonicalValue(old) !== canonicalValue(anchor)) {
      conflict('Genesis pin cannot be silently replaced');
    }
    this.root.anchors.set(anchor.groupId, copy(anchor));
  }
  async getPinnedGenesis(groupId: string): Promise<PinnedOwnerAnchorV2 | null> {
    const x = this.root.anchors.get(groupId);
    return x ? copy(x) : null;
  }
  async loadGroup(groupId: string): Promise<GroupSnapshotV2 | null> {
    const x = this.root.groups.get(groupId);
    return x ? copy(x) : null;
  }
  async getEpochHighWater(groupId: string): Promise<number> {
    return this.epochFence.get(groupId) ?? 0;
  }
  async getEpochKey(groupId: string, epoch: number): Promise<Uint8Array | null> {
    return this.root.keys.get(keyId(groupId,epoch))?.slice() ?? null;
  }
  async getTransaction(transactionId: string): Promise<PreparedAdditionV2 | null> {
    const x = this.root.transactions.get(transactionId);
    return x ? copy(x) : null;
  }
  async getInstalledDistribution(transactionId: string): Promise<string | null> {
    return this.root.installed.get(transactionId) ?? null;
  }
  async getVerifiedReceipt(transactionId: string, deviceId: string): Promise<string | null> {
    return this.root.transactions.get(transactionId)?.verifiedReceipts[deviceId] ?? null;
  }

  async initializeOwnedGroup(snapshot: GroupSnapshotV2,
    anchor: PinnedOwnerAnchorV2, freshKey: Uint8Array): Promise<void> {
    if (this.root.groups.has(snapshot.groupId) || this.epochFence.has(snapshot.groupId) ||
        this.root.anchors.has(snapshot.groupId)) {
      conflict('Group or owner genesis already anchored');
    }
    if (snapshot.epoch !== 1 || snapshot.currentTransactionId !== null ||
        snapshot.state !== 'active' || freshKey.length !== 32 ||
        anchor.groupId !== snapshot.groupId || anchor.genesisDigest !== snapshot.genesisDigest ||
        anchor.ownerFingerprint !== snapshot.genesis.owner.fingerprint) {
      throw new SecurityV2Error('INVALID_INPUT', 'Invalid initial group/secret/anchor');
    }
    const next = this.nextState();
    next.groups.set(snapshot.groupId, copy(snapshot));
    next.anchors.set(snapshot.groupId, copy(anchor));
    next.keys.set(keyId(snapshot.groupId,1), freshKey.slice());
    this.swap(next, snapshot.groupId, 1);
  }

  async prepareAddition(expectedEpoch: number, expectedRosterDigest: string,
    record: PreparedAdditionV2): Promise<PreparedAdditionV2> {
    const groupId = record.approval.proposal.groupId;
    const group = this.root.groups.get(groupId);
    if (!group || group.state !== 'active' ||
        group.epoch !== expectedEpoch || group.rosterDigest !== expectedRosterDigest ||
        this.epochFence.get(groupId) !== expectedEpoch) {
      throw new SecurityV2Error('STALE_EPOCH', 'Prepare does not match atomic current roster');
    }
    const existing = this.root.transactions.get(record.transactionId);
    if (existing) {
      if (existing.proposalDigest !== record.proposalDigest ||
          existing.requestId !== record.requestId ||
          existing.expectedEpoch !== record.expectedEpoch ||
          existing.nextRosterDigest !== record.nextRosterDigest) {
        conflict('Transaction ID collides with another signed proposal');
      }
      return copy(existing);
    }
    for (const other of this.root.transactions.values()) {
      if (other.requestId === record.requestId) {
        throw new SecurityV2Error('REPLAY', 'Request ID was already durably consumed');
      }
    }
    if (record.status !== 'prepared' || record.expectedEpoch !== expectedEpoch ||
        record.nextEpoch !== expectedEpoch + 1 ||
        record.approval.proposal.rosterDigestBefore !== expectedRosterDigest) {
      conflict('Invalid prepare journal transition');
    }
    const next = this.nextState();
    next.transactions.set(record.transactionId, copy(record));
    this.swap(next, groupId);
    return copy(record);
  }

  async commitAddition(transactionId: string, nextGroup: GroupSnapshotV2,
    freshKey: Uint8Array): Promise<PreparedAdditionV2> {
    const tx = this.root.transactions.get(transactionId);
    if (!tx) {throw new SecurityV2Error('NOT_COMMITTED', 'No prepared journal');}
    if (tx.status === 'committed') {
      const current = this.root.groups.get(nextGroup.groupId);
      if (current?.currentTransactionId !== transactionId ||
          current.epoch !== tx.nextEpoch) {
        throw new SecurityV2Error('STALE_EPOCH', 'Committed transaction superseded');
      }
      return copy(tx);
    }
    const previous = this.root.groups.get(nextGroup.groupId);
    if (!previous || previous.state !== 'active' ||
        this.epochFence.get(previous.groupId) !== previous.epoch ||
        previous.epoch !== tx.expectedEpoch ||
        previous.rosterDigest !== tx.approval.proposal.rosterDigestBefore ||
        nextGroup.epoch !== previous.epoch + 1 ||
        nextGroup.currentTransactionId !== transactionId ||
        nextGroup.rosterDigest !== tx.nextRosterDigest ||
        canonicalValue(nextGroup.roster) !== canonicalValue(tx.nextRoster) ||
        nextGroup.genesisDigest !== previous.genesisDigest ||
        nextGroup.authoritySequence !== previous.authoritySequence ||
        canonicalValue(nextGroup.revokedCredentials) !==
          canonicalValue(previous.revokedCredentials) ||
        freshKey.length !== 32) {
      throw new SecurityV2Error('CONFLICT', 'Atomic group/roster/key CAS failed');
    }
    if (previous.roster.some(before=>!nextGroup.roster.some(after=>
      before.deviceId === after.deviceId &&
      canonicalValue(before) === canonicalValue(after)))) {
      conflict('Commit removed or modified a protected previous member');
    }
    const oldKey = this.root.keys.get(keyId(previous.groupId,previous.epoch));
    if (!oldKey || oldKey.length !== 32 ||
        oldKey.every((v,i)=>v === freshKey[i])) {
      throw new SecurityV2Error('KEY_MISSING', 'Epoch rekey requires an available, distinct old key');
    }
    this.fail('before-commit');
    const next = this.nextState();
    next.keys.delete(keyId(previous.groupId,previous.epoch));
    next.keys.set(keyId(previous.groupId,nextGroup.epoch), freshKey.slice());
    next.groups.set(previous.groupId, copy(nextGroup));
    next.transactions.set(transactionId, {...copy(tx), status: 'committed'});
    this.swap(next, previous.groupId, nextGroup.epoch);
    this.fail('after-commit');
    return copy(next.transactions.get(transactionId)!);
  }

  async recordIssuedDistribution(transactionId: string, recipient: string,
    digest: string): Promise<void> {
    const tx = this.root.transactions.get(transactionId);
    if (!tx || tx.status !== 'committed' ||
        !tx.nextRoster.some(m=>m.deviceId === recipient && m.state !== 'revoked')) {
      throw new SecurityV2Error('NOT_COMMITTED', 'Distribution requires committed recipient');
    }
    const next = this.nextState();
    const updated = next.transactions.get(transactionId)!;
    const prev = updated.issuedDistributions[recipient] ?? [];
    if (!prev.includes(digest)) {
      updated.issuedDistributions[recipient] = [...prev, digest];
    }
    this.swap(next, tx.approval.proposal.groupId);
  }

  async installEpoch(transactionId: string, distributionDigest: string,
    group: GroupSnapshotV2, freshKey: Uint8Array): Promise<'installed' | 'duplicate'> {
    const oldDigest = this.root.installed.get(transactionId);
    if (oldDigest !== undefined) {
      if (oldDigest !== distributionDigest) {conflict('Conflicting duplicate distribution');}
      return 'duplicate';
    }
    const anchor = this.root.anchors.get(group.groupId);
    const old = this.root.groups.get(group.groupId);
    const high = this.epochFence.get(group.groupId) ?? 0;
    if (!anchor || anchor.genesisDigest !== group.genesisDigest ||
        anchor.ownerFingerprint !== group.genesis.owner.fingerprint ||
        group.epoch <= high || freshKey.length !== 32 ||
        group.state !== 'active' ||
        (old && (old.genesisDigest !== group.genesisDigest || old.epoch >= group.epoch)) ||
        (old && old.roster.some(before=>before.state === 'revoked' &&
          !group.roster.some(after=>after.deviceId === before.deviceId &&
            after.state === 'revoked')))) {
      throw new SecurityV2Error('STALE_EPOCH',
        'Recipient install is unanchored, older, or would revive a revoked member');
    }
    const oldKey = old ? this.root.keys.get(keyId(group.groupId,old.epoch)) : null;
    if (oldKey && oldKey.every((v,i)=>v === freshKey[i])) {
      throw new SecurityV2Error('KEY_MISSING', 'Received epoch reused old secret');
    }
    this.fail('before-install');
    const next = this.nextState();
    if (old) {next.keys.delete(keyId(group.groupId,old.epoch));}
    next.keys.set(keyId(group.groupId,group.epoch), freshKey.slice());
    next.groups.set(group.groupId, copy(group));
    next.installed.set(transactionId, distributionDigest);
    this.swap(next,group.groupId,group.epoch);
    this.fail('after-install');
    return 'installed';
  }

  async recordVerifiedReceipt(transactionId: string, recipient: string,
    ackDigest: string): Promise<boolean> {
    const tx = this.root.transactions.get(transactionId);
    if (!tx || tx.status !== 'committed' ||
        (tx.issuedDistributions[recipient] ?? []).length === 0) {
      throw new SecurityV2Error('NOT_COMMITTED','Receipt has no issued distribution');
    }
    const old = tx.verifiedReceipts[recipient];
    if (old !== undefined) {
      if (old !== ackDigest) {throw new SecurityV2Error('REPLAY', 'Different verified ack already exists');}
      return true;
    }
    const next = this.nextState();
    next.transactions.get(transactionId)!.verifiedReceipts[recipient] = ackDigest;
    this.swap(next, tx.approval.proposal.groupId);
    return true;
  }

  async invalidateEpoch(groupId: string, expectedEpoch: number): Promise<void> {
    const group = this.root.groups.get(groupId);
    if (!group || group.state !== 'active' || group.epoch !== expectedEpoch ||
        this.epochFence.get(groupId) !== expectedEpoch) {
      throw new SecurityV2Error('STALE_EPOCH','Epoch invalidation CAS failed');
    }
    const next = this.nextState();
    next.groups.set(groupId,{...copy(group),state:'invalidated'});
    next.keys.delete(keyId(groupId,expectedEpoch));
    this.swap(next,groupId);
  }

  async revokeCredential(groupId: string, expectedSequence: number,
    credentialId: string): Promise<void> {
    const group = this.root.groups.get(groupId);
    if (!group || group.state !== 'active' || group.authoritySequence !== expectedSequence ||
        group.revokedCredentials.includes(credentialId) ||
        this.epochFence.get(groupId) !== group.epoch) {
      throw new SecurityV2Error('CONFLICT','Authority sequence CAS failed');
    }
    const next = this.nextState();
    next.groups.set(groupId,{...copy(group),
      authoritySequence: expectedSequence + 1,
      revokedCredentials: [...group.revokedCredentials,credentialId]});
    for (const tx of next.transactions.values()) {
      if (tx.approval.proposal.groupId === groupId && tx.status === 'prepared') {
        tx.status = 'superseded';
      }
    }
    this.swap(next,groupId);
  }

  /** Test-only fault injection; never used by a production provider. */
  unsafeRollbackGroup(groupId: string, snapshot: GroupSnapshotV2): void {
    this.root.groups.set(groupId, copy(snapshot)); // does NOT alter protected fence
  }
  unsafeDeleteEpochKey(groupId: string, epoch: number): void {
    this.root.keys.delete(keyId(groupId,epoch));
  }
  unsafeCorruptJournal(transactionId: string): void {
    const tx = this.root.transactions.get(transactionId);
    if (tx) {this.root.transactions.set(transactionId,{...copy(tx),proposalDigest:'corrupt'});}
  }
}
