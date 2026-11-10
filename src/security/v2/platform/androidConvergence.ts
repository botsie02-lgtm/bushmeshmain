import type {SecurityV2TransactionalStore} from '../contracts';
import {SecurityV2Error} from '../contracts';

/**
 * Evidence-based, READ-ONLY cross-branch API review.
 *
 * Android reviewed source:
 * feature/android-production-security-v1@b0558b643ffed8e839267bca16d4ae5cd363536b
 *
 * This module does NOT import, wrap, cast, or invoke AndroidSecurityEpochStorage.
 * Its V1 commitGroupEpoch/epochHigh operations cannot implement this V2 port.
 *
 * Each key is checked against the COMPLETE SecurityV2TransactionalStore at
 * TypeScript compile time, so adding a method to V2 forces a review update.
 */
export type AndroidV2LegacyCoverage = 'absent' | 'partial-incompatible';

type AndroidV2MethodGap = {
  /** Proposed additive native @ReactMethod; NONE exists at reviewed Android SHA. */
  nativeV2Method: string;
  legacyCoverage: AndroidV2LegacyCoverage;
  /** Exact reason the V1 bridge is not an acceptable implementation. */
  reason: string;
};

export const ANDROID_V2_STORAGE_METHOD_MATRIX = {
  getPinnedGenesis: {
    nativeV2Method: 'v2ReadOwnerAnchor',
    legacyCoverage: 'absent',
    reason: 'No independently provisioned pinned owner genesis/digest or immutable root.',
  },
  loadGroup: {
    nativeV2Method: 'v2ReadGroup',
    legacyCoverage: 'partial-incompatible',
    reason: 'V1 read(meta,group/...) returns GroupRecord, not a verified V2 snapshot.',
  },
  getEpochHighWater: {
    nativeV2Method: 'v2ReadEpochFence',
    legacyCoverage: 'partial-incompatible',
    reason: 'V1 epochHigh is a same-SQLite-file signed Int, not independent or rollback-resistant.',
  },
  getEpochKey: {
    nativeV2Method: 'v2ReadEpochSecret',
    legacyCoverage: 'partial-incompatible',
    reason: 'V1 read(secret,...) has no V2 key namespace, version or receipt binding.',
  },
  getTransaction: {
    nativeV2Method: 'v2ReadPreparedTransaction',
    legacyCoverage: 'partial-incompatible',
    reason: 'epoch_commit only stores tx ID/group/digest/epoch, not full prepared journal.',
  },
  getInstalledDistribution: {
    nativeV2Method: 'v2ReadInstalledDistribution',
    legacyCoverage: 'absent',
    reason: 'No recipient-install journal, ciphertext digest or replay identity.',
  },
  getVerifiedReceipt: {
    nativeV2Method: 'v2ReadVerifiedReceipt',
    legacyCoverage: 'absent',
    reason: 'No verified recipient-signature/ack digest storage.',
  },
  recordIssuedDistribution: {
    nativeV2Method: 'v2RecordIssuedDistribution',
    legacyCoverage: 'absent',
    reason: 'No durable per-recipient envelope/retry journal.',
  },
  initializeOwnedGroup: {
    nativeV2Method: 'v2AtomicCreateOwnerGroup',
    legacyCoverage: 'absent',
    reason: 'V1 commitEpoch(0,1) does not anchor signed genesis or verify the local owner.',
  },
  prepareAddition: {
    nativeV2Method: 'v2AtomicPrepareAddition',
    legacyCoverage: 'absent',
    reason: 'No expected-roster digest CAS or request replay journal without publishing.',
  },
  commitAddition: {
    nativeV2Method: 'v2AtomicCommitAddition',
    legacyCoverage: 'partial-incompatible',
    reason: 'V1 commitEpoch accepts V1 GroupRecord, misses prepared CAS/role state and retains old key.',
  },
  installEpoch: {
    nativeV2Method: 'v2AtomicInstallEpoch',
    legacyCoverage: 'absent',
    reason: 'No recipient genesis/fence/roster+key+installation-digest transaction.',
  },
  recordVerifiedReceipt: {
    nativeV2Method: 'v2AtomicVerifiedReceipt',
    legacyCoverage: 'absent',
    reason: 'No atomic unique receipt, signed distribution association or current epoch check.',
  },
  invalidateEpoch: {
    nativeV2Method: 'v2AtomicInvalidateEpoch',
    legacyCoverage: 'absent',
    reason: 'No atomic retired epoch tombstone plus key deletion for V2.',
  },
  revokeCredential: {
    nativeV2Method: 'v2AtomicRevokeCredential',
    legacyCoverage: 'absent',
    reason: 'No monotonic owner/admin authority-sequence CAS or revoked credentials.',
  },
} as const satisfies Record<keyof SecurityV2TransactionalStore, AndroidV2MethodGap>;

/**
 * PROPOSAL ONLY: future native bridge over *new* versioned SQL tables.
 *
 * These method names and arguments are the proposed Android worker boundary;
 * NOT methods of the existing BushMeshSecurity native module.
 *
 * JSON parameters are canonical validated V2 records; epoch values in
 * native receipts MUST be validated decimal strings or safe JS integers.
 * Secrets cross the RN bridge because the frozen V2 store takes Uint8Array.
 * Base64 transport does not provide non-exportable symmetric key custody.
 *
 * The native provider must implement CAS/recovery atomically and return
 * durable signed-digest-bound receipts, never infer membership from inputs.
 */
export interface ProposedAndroidSecurityV2NativeBridge {
  v2DescribeCapabilities(): Promise<string>;
  v2ReadOwnerAnchor(groupId: string): Promise<string | null>;
  v2ReadGroup(groupId: string): Promise<string | null>;
  v2ReadEpochFence(groupId: string): Promise<string>;
  v2ReadEpochSecret(groupId: string, epochDecimal: string): Promise<string | null>;
  v2ReadPreparedTransaction(transactionId: string): Promise<string | null>;
  v2ReadInstalledDistribution(transactionId: string): Promise<string | null>;
  v2ReadVerifiedReceipt(transactionId: string, deviceId: string): Promise<string | null>;
  v2RecordIssuedDistribution(
    transactionId: string, recipient: string, distributionDigest: string,
  ): Promise<string>;
  v2AtomicCreateOwnerGroup(
    snapshotJson: string, genesisAnchorJson: string, freshKeyBase64: string,
  ): Promise<string>;
  v2AtomicPrepareAddition(
    expectedEpochDecimal: string, expectedRosterDigest: string,
    preparedJournalJson: string,
  ): Promise<string>;
  v2AtomicCommitAddition(
    transactionId: string, nextSnapshotJson: string, newEpochKeyBase64: string,
  ): Promise<string>;
  v2AtomicInstallEpoch(
    transactionId: string, distributionDigest: string,
    snapshotJson: string, newEpochKeyBase64: string,
  ): Promise<string>;
  v2AtomicVerifiedReceipt(
    transactionId: string, recipientDeviceId: string, signedAckDigest: string,
  ): Promise<string>;
  v2AtomicInvalidateEpoch(groupId: string, expectedEpochDecimal: string): Promise<string>;
  v2AtomicRevokeCredential(
    groupId: string, expectedAuthoritySequenceDecimal: string,
    credentialId: string,
  ): Promise<string>;
}

export const ANDROID_V2_NATIVE_METHODS = [
  'v2DescribeCapabilities',
  ...Object.values(ANDROID_V2_STORAGE_METHOD_MATRIX).map(x => x.nativeV2Method),
] as readonly string[];

export type AndroidV2SurfaceAssessment = {
  /** Surface parity alone is never formal security approval. */
  readonly productionActivationApproved: false;
  readonly nativeSurfaceComplete: boolean;
  readonly missingNativeMethods: readonly string[];
  readonly legacyEpochCasPresent: boolean;
  readonly legacyEpochHighPresent: boolean;
  readonly rollbackEvidence:
    | 'same-db-counter-not-resistant'
    | 'unverified'
    | 'self-declared-only';
  readonly blockers: readonly string[];
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Pure structural review; does not call or trust any injected method.
 * Injected "capabilities" are declarations, NOT hardware evidence.
 */
export function inspectAndroidSecurityV2Surface(
  nativeBridge: unknown, capabilities?: unknown,
): AndroidV2SurfaceAssessment {
  const bridge = record(nativeBridge) ? nativeBridge : {};
  const declared = record(capabilities) ? capabilities : {};
  const missingNativeMethods = ANDROID_V2_NATIVE_METHODS.filter(
    method => typeof bridge[method] !== 'function',
  );

  // Legacy Android reports schemaVersion=1 and explicitly declares false.
  const rollbackEvidence = declared.hardwareRollbackResistantCounters === false ||
      declared.hardwareRollbackResistantEpochFence === false
    ? 'same-db-counter-not-resistant'
    : declared.hardwareRollbackResistantEpochFence === true
      ? 'self-declared-only'
      : 'unverified';
  const blockers: string[] = [];
  if (missingNativeMethods.length > 0) {
    blockers.push('missing-versioned-native-transactional-methods');
  }
  if (declared.schemaVersion !== 2) {
    blockers.push('no-reviewed-android-v2-capability-schema');
  }
  if (declared.enabledInApplication !== false) {
    blockers.push('production-activation-gate-not-independently-verified');
  }
  // An independently tested monotonic anchor or fail-closed fresh-epoch
  // recovery is mandatory; no JS boolean can certify the hardware property.
  blockers.push('independent-rollback-recovery-and-physical-device-review-required');
  blockers.push('no-reviewed-native-v2-adapter-or-authority-trust-ceremony');

  return {
    productionActivationApproved: false,
    nativeSurfaceComplete: missingNativeMethods.length === 0,
    missingNativeMethods,
    legacyEpochCasPresent: typeof bridge.commitEpoch === 'function' ||
      typeof bridge.commitGroupEpoch === 'function',
    legacyEpochHighPresent: typeof bridge.epochHigh === 'function' ||
      typeof bridge.getHighWatermark === 'function',
    rollbackEvidence,
    blockers,
  };
}

/**
 * Explicit fail-closed boundary. There is deliberately NO V2 store adapter
 * until the Android worker has implemented and verified the complete native
 * transaction contract. In particular, do not coerce AndroidSecurityEpochStorage
 * to SecurityV2TransactionalStore or use v1 metadata setters to fill gaps.
 */
export function rejectUnreviewedAndroidV2Store(
  nativeBridge: unknown, capabilities?: unknown,
): never {
  const assessment = inspectAndroidSecurityV2Surface(nativeBridge, capabilities);
  throw new SecurityV2Error(
    'STORE_UNAVAILABLE',
    assessment.nativeSurfaceComplete
      ? 'Android V2 method names alone do not prove atomicity or rollback safety'
      : 'Android V1 epoch CAS is not an authenticated Security V2 transactional store',
  );
}
