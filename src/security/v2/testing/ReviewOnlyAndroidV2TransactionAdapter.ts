import {Buffer} from 'buffer';
import type {SecurityV2TransactionalStore, GroupSnapshotV2, PinnedOwnerAnchorV2,
  PreparedAdditionV2} from '../contracts';
import {SecurityV2Error} from '../contracts';
import {assertSnapshotShape, canonicalValue} from '../canonical';
import {
  ANDROID_V2_NATIVE_METHODS,
  type ProposedAndroidSecurityV2NativeBridge,
} from '../platform/androidConvergence';

/**
 * ONLY A DETERMINISTIC TEST HARNESS FOR THE PROPOSED VERSIONED NATIVE API.
 *
 * Not exported by src/security/v2/index.ts, not connected to NativeModules,
 * never casts AndroidSecurityEpochStorage, and has no production factory.
 * No native bridge is registered in the Android app on this feature branch.
 *
 * This harness checks interface/receipt consistency, NOT native hardware
 * capabilities, owner-approval provenance or independent anti-rollback.
 */
export class ReviewOnlyAndroidV2TransactionAdapter implements SecurityV2TransactionalStore {
  private constructor(private readonly native: ProposedAndroidSecurityV2NativeBridge) {}

  static createForDeterministicTests(
    bridge: ProposedAndroidSecurityV2NativeBridge,
    permission: 'isolated-deterministic-tests-only',
  ): ReviewOnlyAndroidV2TransactionAdapter {
    if (permission !== 'isolated-deterministic-tests-only' ||
        !bridge || ANDROID_V2_NATIVE_METHODS.some(name =>
          typeof (bridge as unknown as Record<string, unknown>)[name] !== 'function')) {
      throw new SecurityV2Error('STORE_UNAVAILABLE',
        'Unreviewed or incomplete Android native V2 transaction bridge');
    }
    return new ReviewOnlyAndroidV2TransactionAdapter(bridge);
  }

  private parse<T>(raw: string, kind: string): T {
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Not a JSON object');
      }
      return value as T;
    } catch {
      throw new SecurityV2Error('CORRUPT_STATE',
        'Malformed protected Android V2 ' + kind + ' journal');
    }
  }

  private high(value: string): number {
    if (!/^(0|[1-9][0-9]{0,9})$/.test(value)) {
      throw new SecurityV2Error('CORRUPT_STATE', 'Invalid decimal Android V2 epoch');
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) {
      throw new SecurityV2Error('CORRUPT_STATE', 'Android V2 epoch overflow');
    }
    return n;
  }

  private assertStatus(result: string, accepted: readonly string[]): void {
    if (!accepted.includes(result)) {
      throw new SecurityV2Error('STORE_UNAVAILABLE',
        'Unexpected or ambiguous Android V2 native transaction outcome');
    }
  }

  async getPinnedGenesis(groupId: string): Promise<PinnedOwnerAnchorV2 | null> {
    const raw = await this.native.v2ReadOwnerAnchor(groupId);
    if (raw === null) return null;
    const pin = this.parse<PinnedOwnerAnchorV2>(raw, 'owner anchor');
    if (pin.groupId !== groupId || !pin.genesisDigest || !pin.ownerFingerprint) {
      throw new SecurityV2Error('CORRUPT_STATE', 'Mismatch in pinned Android owner genesis');
    }
    return pin;
  }

  async loadGroup(groupId: string): Promise<GroupSnapshotV2 | null> {
    const raw = await this.native.v2ReadGroup(groupId);
    if (raw === null) return null;
    const group = this.parse<GroupSnapshotV2>(raw, 'group');
    assertSnapshotShape(group);
    if (group.groupId !== groupId) {
      throw new SecurityV2Error('CORRUPT_STATE', 'Android V2 group identifier changed');
    }
    return group;
  }

  async getEpochHighWater(groupId: string): Promise<number> {
    return this.high(await this.native.v2ReadEpochFence(groupId));
  }

  async getEpochKey(groupId: string, epoch: number): Promise<Uint8Array | null> {
    if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch > 0xffffffff) {
      throw new SecurityV2Error('INVALID_INPUT', 'Invalid Android epoch key lookup');
    }
    const encoded = await this.native.v2ReadEpochSecret(groupId, String(epoch));
    if (encoded === null) return null;
    const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
    if (bytes.length !== 32) {
      bytes.fill(0);
      throw new SecurityV2Error('CORRUPT_STATE', 'Android returned wrong epoch key length');
    }
    return bytes;
  }

  async getTransaction(id: string): Promise<PreparedAdditionV2 | null> {
    const raw = await this.native.v2ReadPreparedTransaction(id);
    if (raw === null) return null;
    const tx = this.parse<PreparedAdditionV2>(raw, 'prepared transaction');
    if (tx.transactionId !== id ||
        !['prepared', 'committed', 'superseded'].includes(tx.status) ||
        tx.approval?.proposal?.transactionId !== id) {
      throw new SecurityV2Error('CORRUPT_STATE', 'Transaction reference or status differs');
    }
    return tx;
  }

  getInstalledDistribution(id: string): Promise<string | null> {
    return this.native.v2ReadInstalledDistribution(id);
  }

  getVerifiedReceipt(id: string, deviceId: string): Promise<string | null> {
    return this.native.v2ReadVerifiedReceipt(id, deviceId);
  }

  async recordIssuedDistribution(id: string, recipient: string, digest: string): Promise<void> {
    this.assertStatus(await this.native.v2RecordIssuedDistribution(id, recipient, digest),
      ['recorded', 'already-recorded-identical']);
    const tx = await this.getTransaction(id);
    if (!(tx?.issuedDistributions[recipient] ?? []).includes(digest)) {
      throw new SecurityV2Error('CORRUPT_STATE',
        'Issued envelope was not durably reflected in Android journal');
    }
  }

  async initializeOwnedGroup(
    snapshot: GroupSnapshotV2, pin: PinnedOwnerAnchorV2, freshKey: Uint8Array,
  ): Promise<void> {
    assertSnapshotShape(snapshot);
    if (freshKey.length !== 32) {
      throw new SecurityV2Error('KEY_MISSING', 'Invalid genesis key length');
    }
    // The separate, user-approved native ceremony MUST have pinned owner
    // before this call. Never create trust on first use from a signed group.
    const existing = await this.getPinnedGenesis(snapshot.groupId);
    if (!existing || canonicalValue(existing) !== canonicalValue(pin)) {
      throw new SecurityV2Error('UNTRUSTED', 'No independently approved native owner pin');
    }
    this.assertStatus(await this.native.v2AtomicCreateOwnerGroup(
      JSON.stringify(snapshot), JSON.stringify(pin),
      Buffer.from(freshKey).toString('base64')), ['created']);
    const persisted = await this.loadGroup(snapshot.groupId);
    if (!persisted || persisted.epoch !== 1 ||
        persisted.rosterDigest !== snapshot.rosterDigest ||
        await this.getEpochHighWater(snapshot.groupId) !== 1) {
      throw new SecurityV2Error('CORRUPT_STATE',
        'Android owner genesis did not persist atomically');
    }
  }

  async prepareAddition(expectedEpoch: number, expectedDigest: string,
    record: PreparedAdditionV2): Promise<PreparedAdditionV2> {
    const result = await this.native.v2AtomicPrepareAddition(
      String(expectedEpoch), expectedDigest, JSON.stringify(record));
    const stored = this.parse<PreparedAdditionV2>(result, 'prepared acknowledgement');
    if (stored.transactionId !== record.transactionId ||
        stored.proposalDigest !== record.proposalDigest ||
        stored.expectedEpoch !== expectedEpoch ||
        stored.nextRosterDigest !== record.nextRosterDigest) {
      throw new SecurityV2Error('CORRUPT_STATE', 'Android prepare receipt altered authenticated plan');
    }
    return stored;
  }

  async commitAddition(id: string, next: GroupSnapshotV2,
    key: Uint8Array): Promise<PreparedAdditionV2> {
    assertSnapshotShape(next);
    if (key.length !== 32) {
      throw new SecurityV2Error('KEY_MISSING', 'Missing fresh committed epoch key');
    }
    this.assertStatus(await this.native.v2AtomicCommitAddition(
      id, JSON.stringify(next), Buffer.from(key).toString('base64')),
      ['committed', 'already-committed-identical']);
    const [tx, group] = await Promise.all([
      this.getTransaction(id), this.loadGroup(next.groupId),
    ]);
    if (!tx || tx.status !== 'committed' || !group ||
        group.currentTransactionId !== id || group.epoch !== next.epoch ||
        group.rosterDigest !== next.rosterDigest ||
        tx.nextRosterDigest !== next.rosterDigest) {
      throw new SecurityV2Error('CORRUPT_STATE', 'Android commit receipt/snapshot divergence');
    }
    return tx;
  }

  async installEpoch(id: string, digest: string, snapshot: GroupSnapshotV2,
    key: Uint8Array): Promise<'installed' | 'duplicate'> {
    assertSnapshotShape(snapshot);
    if (key.length !== 32) {
      throw new SecurityV2Error('KEY_MISSING', 'Missing recipient epoch secret');
    }
    const result = await this.native.v2AtomicInstallEpoch(id, digest,
      JSON.stringify(snapshot), Buffer.from(key).toString('base64'));
    this.assertStatus(result, ['installed', 'already-installed-identical']);
    const [receipt, group] = await Promise.all([
      this.getInstalledDistribution(id), this.loadGroup(snapshot.groupId),
    ]);
    if (receipt !== digest || !group || group.currentTransactionId !== id ||
        group.epoch !== snapshot.epoch || group.rosterDigest !== snapshot.rosterDigest) {
      throw new SecurityV2Error('CORRUPT_STATE', 'Android installation is missing durable evidence');
    }
    return result === 'installed' ? 'installed' : 'duplicate';
  }

  async recordVerifiedReceipt(id: string, recipient: string,
    digest: string): Promise<boolean> {
    this.assertStatus(await this.native.v2AtomicVerifiedReceipt(id, recipient, digest),
      ['verified', 'already-verified-identical']);
    if (await this.getVerifiedReceipt(id, recipient) !== digest) {
      throw new SecurityV2Error('CORRUPT_STATE', 'Android signed ack not durably verified');
    }
    return true;
  }

  async invalidateEpoch(groupId: string, expectedEpoch: number): Promise<void> {
    this.assertStatus(await this.native.v2AtomicInvalidateEpoch(
      groupId, String(expectedEpoch)), ['invalidated']);
    const group = await this.loadGroup(groupId);
    if (!group || group.state !== 'invalidated') {
      throw new SecurityV2Error('CORRUPT_STATE', 'Android epoch invalidation not persisted');
    }
  }

  async revokeCredential(groupId: string, expectedSequence: number,
    credentialId: string): Promise<void> {
    this.assertStatus(await this.native.v2AtomicRevokeCredential(
      groupId,String(expectedSequence),credentialId), ['revoked']);
    const group = await this.loadGroup(groupId);
    if (!group || group.authoritySequence !== expectedSequence + 1 ||
        !group.revokedCredentials.includes(credentialId)) {
      throw new SecurityV2Error('CORRUPT_STATE', 'Android role revocation not persisted');
    }
  }
}
