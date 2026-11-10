import {
  ANDROID_V2_NATIVE_METHODS,
  ANDROID_V2_STORAGE_METHOD_MATRIX,
  inspectAndroidSecurityV2Surface,
  rejectUnreviewedAndroidV2Store,
} from '../src/security/v2/platform/androidConvergence';
import {InMemorySecurityV2TransactionStore} from
  '../src/security/v2/testing/InMemorySecurityV2TransactionStore';

/**
 * THESE ARE NEGATIVE CROSS-BRANCH COMPATIBILITY TESTS ONLY.
 *
 * Reviewed Android source (not imported into this branch):
 * feature/android-production-security-v1@b0558b643ffed8e839267bca16d4ae5cd363536b
 *
 * AndroidSecurityNativeBridge presently implements commitEpoch/epochHigh,
 * while AndroidSecurityEpochStorage exposes commitGroupEpoch/getHighWatermark.
 * Neither is SecurityV2TransactionalStore, even if the V1 CAS is durable.
 */
describe('Android production-security to Security v2 contract convergence', () => {
  const legacyCapability = {
    schemaVersion: 1,
    enabledInApplication: false,
    hardwareRollbackResistantCounters: false,
    storageLevel: 'tee',
    ed25519: true,
    x25519: true,
  } as const;

  test('every SecurityV2TransactionalStore operation has a proposed distinct native API', () => {
    // The compile-checked matrix must also cover the deterministic reference
    // implementation; test-only hooks are intentionally excluded.
    const testStore = new InMemorySecurityV2TransactionStore();
    for (const [storeMethod, mapping] of Object.entries(ANDROID_V2_STORAGE_METHOD_MATRIX)) {
      expect(typeof testStore[storeMethod as keyof InMemorySecurityV2TransactionStore])
        .toBe('function');
      expect(mapping.nativeV2Method).toMatch(/^v2[A-Z]/);
      expect(mapping.reason.length).toBeGreaterThan(20);
    }
    expect(new Set(ANDROID_V2_NATIVE_METHODS).size)
      .toBe(ANDROID_V2_NATIVE_METHODS.length);
    expect(ANDROID_V2_NATIVE_METHODS).toHaveLength(
      Object.keys(ANDROID_V2_STORAGE_METHOD_MATRIX).length + 1,
    );
  });

  test('realistic Android V1 bridge subset fails closed; V1 CAS never called', () => {
    const native = {
      probe: jest.fn(async () => JSON.stringify(legacyCapability)),
      read: jest.fn(async () => null),
      write: jest.fn(async () => undefined),
      commitEpoch: jest.fn(async () => true),
      epochHigh: jest.fn(async () => 2),
    };
    const review = inspectAndroidSecurityV2Surface(native, legacyCapability);
    expect(review).toMatchObject({
      productionActivationApproved: false,
      nativeSurfaceComplete: false,
      legacyEpochCasPresent: true,
      legacyEpochHighPresent: true,
      rollbackEvidence: 'same-db-counter-not-resistant',
    });
    expect(review.missingNativeMethods).toContain('v2AtomicPrepareAddition');
    expect(review.missingNativeMethods).toContain('v2AtomicCommitAddition');
    expect(review.missingNativeMethods).toContain('v2AtomicInstallEpoch');
    expect(review.missingNativeMethods).toContain('v2AtomicVerifiedReceipt');
    expect(review.missingNativeMethods).toContain('v2ReadOwnerAnchor');
    expect(() => rejectUnreviewedAndroidV2Store(native, legacyCapability))
      .toThrow('Android V1 epoch CAS is not an authenticated Security V2 transactional store');
    expect(native.probe).not.toHaveBeenCalled();
    expect(native.commitEpoch).not.toHaveBeenCalled();
    expect(native.epochHigh).not.toHaveBeenCalled();
    expect(native.read).not.toHaveBeenCalled();
    expect(native.write).not.toHaveBeenCalled();
  });

  test('TypeScript AndroidSecurityEpochStorage wrapper is never cast to V2 store', () => {
    const old = {
      commitGroupEpoch: jest.fn(async () => true),
      getHighWatermark: jest.fn(async () => 1),
    };
    const result = inspectAndroidSecurityV2Surface(old);
    expect(result.legacyEpochCasPresent).toBe(true);
    expect(result.legacyEpochHighPresent).toBe(true);
    expect(result.nativeSurfaceComplete).toBe(false);
    expect(result.productionActivationApproved).toBe(false);
    expect(() => rejectUnreviewedAndroidV2Store(old))
      .toThrow();
    expect(old.commitGroupEpoch).not.toHaveBeenCalled();
    expect(old.getHighWatermark).not.toHaveBeenCalled();
  });

  test('missing even one native recipient transaction blocks surface completeness', () => {
    const fake: Record<string, jest.Mock> = {};
    for (const operation of ANDROID_V2_NATIVE_METHODS) {
      fake[operation] = jest.fn(async () => null);
    }
    delete fake.v2AtomicInstallEpoch;
    const result = inspectAndroidSecurityV2Surface(fake, {
      schemaVersion: 2, enabledInApplication: false,
      hardwareRollbackResistantEpochFence: false,
    });
    expect(result.nativeSurfaceComplete).toBe(false);
    expect(result.missingNativeMethods).toEqual(['v2AtomicInstallEpoch']);
    expect(result.blockers).toContain('missing-versioned-native-transactional-methods');
    expect(result.rollbackEvidence).toBe('same-db-counter-not-resistant');
    expect(Object.values(fake).every(fn => fn.mock.calls.length === 0)).toBe(true);
  });

  test('a mock claiming complete V2 native methods and hardware is still not approved', () => {
    const fake: Record<string, jest.Mock> = {};
    for (const operation of ANDROID_V2_NATIVE_METHODS) {
      fake[operation] = jest.fn(async () => 'success');
    }
    const report = {
      schemaVersion: 2,
      enabledInApplication: false,
      hardwareRollbackResistantEpochFence: true, // self-declaration is NOT attestation
      sqliteAtomicTransactions: true,
    };
    const result = inspectAndroidSecurityV2Surface(fake, report);
    expect(result.nativeSurfaceComplete).toBe(true);
    expect(result.missingNativeMethods).toHaveLength(0);
    expect(result.productionActivationApproved).toBe(false);
    expect(result.rollbackEvidence).toBe('self-declared-only');
    expect(result.blockers)
      .toContain('independent-rollback-recovery-and-physical-device-review-required');
    expect(() => rejectUnreviewedAndroidV2Store(fake, report))
      .toThrow('Android V2 method names alone do not prove atomicity or rollback safety');
    expect(Object.values(fake).every(fn => fn.mock.calls.length === 0)).toBe(true);
  });

  test('malformed or absent capability evidence cannot promote a storage bridge', () => {
    const fake = {v2AtomicCommitAddition: jest.fn(async () => 'committed')};
    for (const evidence of [null, {}, {schemaVersion: 1},
      {schemaVersion: 2, enabledInApplication: true}]) {
      const assessment = inspectAndroidSecurityV2Surface(fake, evidence);
      expect(assessment.productionActivationApproved).toBe(false);
      expect(assessment.nativeSurfaceComplete).toBe(false);
      expect(assessment.blockers.length).toBeGreaterThan(1);
    }
    expect(fake.v2AtomicCommitAddition).not.toHaveBeenCalled();
  });
});
