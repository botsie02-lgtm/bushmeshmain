import {Buffer} from 'buffer';
import {
  AndroidHardwareCryptoProvider, AndroidSecureSecretStore, AndroidSecurityEpochStorage,
  AndroidSecurityMetadataStore, createAndroidProductionSecurity, probeAndroidProductionSecurity,
  retireAndroidLocalIdentity,
} from '../src/security/platform/androidProductionSecurity';
import type {AndroidSecurityNativeBridge} from '../src/security/platform/androidProductionSecurity';
import {SecurityError} from '../src/security/errors';
import type {DeviceIdentity, LocalIdentityKeyHandles, GroupRecord} from '../src/security/types';

const available = {
  apiLevel: 35, schemaVersion: 1, storageLevel: 'tee',
  strongBoxFeature: false, ed25519: true, x25519: true, enabled: true,
  enabledInApplication: false, hardwareRollbackResistantCounters: false,
};

function bridge(overrides: Partial<AndroidSecurityNativeBridge> = {}): AndroidSecurityNativeBridge {
  return {
    probe: jest.fn(async () => JSON.stringify(available)),
    read: jest.fn(async () => null),
    write: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
    listMetadata: jest.fn(async () => []),
    setIdentityAtomic: jest.fn(async () => undefined),
    getNonceHigh: jest.fn(async () => '0'),
    reserveNonce: jest.fn(async () => '1'),
    advanceNonceHigh: jest.fn(async () => undefined),
    acceptReplay: jest.fn(async () => true),
    consumeHandshake: jest.fn(async () => true),
    commitEpoch: jest.fn(async () => true),
    epochHigh: jest.fn(async () => 0),
    retireIdentity: jest.fn(async () => undefined),
    randomBytes: jest.fn(async (size: number) => Buffer.alloc(size, 5).toString('base64')),
    sha256: jest.fn(async () => Buffer.alloc(32).toString('base64')),
    hkdf: jest.fn(async () => Buffer.alloc(32).toString('base64')),
    aead: jest.fn(async () => Buffer.alloc(16).toString('base64')),
    createKey: jest.fn(async (algorithm: string, purpose: string) =>
      JSON.stringify({
        publicKey: Buffer.alloc(32, 9).toString('base64'),
        hardwareLevel: 'tee',
        privateKeyHandle: {
          provider: 'android-keystore-curve25519-v1',
          id: 'ABCDEFGHIJKLMNOPQRSTUVWX',
          algorithm, purpose,
        },
      })),
    hasKey: jest.fn(async () => true),
    deleteKey: jest.fn(async () => undefined),
    sign: jest.fn(async () => Buffer.alloc(64, 1).toString('base64')),
    verify: jest.fn(async () => true),
    agree: jest.fn(async () => Buffer.alloc(32, 2).toString('base64')),
    ...overrides,
  };
}

it('reports disabled production capability and blocks identity without hardware proof', async () => {
  const native = bridge({
    probe: jest.fn(async () => JSON.stringify({...available, x25519: false, enabled: false})),
  });
  expect((await probeAndroidProductionSecurity(native)).enabled).toBe(false);
  await expect(AndroidHardwareCryptoProvider.create(native))
    .rejects.toMatchObject({code: 'UNSUPPORTED_VERSION'});
  expect(native.createKey).not.toHaveBeenCalled();
});

it('rejects contradictory or invalid native capability claims', async () => {
  const native = bridge({
    probe: jest.fn(async () => JSON.stringify({...available, hardwareRollbackResistantCounters: true})),
  });
  await expect(probeAndroidProductionSecurity(native))
    .rejects.toMatchObject({code: 'UNSUPPORTED_VERSION'});
});

it('uses one-time native entropy, exact raw key lengths, and opaque handles', async () => {
  const native = bridge();
  const services = await createAndroidProductionSecurity(native);
  const {crypto} = services;
  expect(crypto.randomBytes(16)).toEqual(new Uint8Array(16).fill(5));
  expect(crypto.randomBytes(16)).toEqual(new Uint8Array(16).fill(5));
  expect(crypto.randomBytes(16)).not.toBeInstanceOf(Promise);
  const signing = await crypto.generateSigningKeyPair('identity-signing');
  const agreement = await crypto.generateAgreementKeyPair('identity-agreement');
  expect(signing.publicKey).toHaveLength(32);
  expect(agreement.publicKey).toHaveLength(32);
  expect(signing.privateKeyHandle).not.toHaveProperty('privateKey');
  expect((await crypto.sign(signing.privateKeyHandle, new Uint8Array([1])))).toHaveLength(64);
  expect((await crypto.deriveSharedSecret(agreement.privateKeyHandle, new Uint8Array(32)))).toHaveLength(32);
  await expect(crypto.hasPrivateKey(signing.privateKeyHandle)).resolves.toBe(true);
  await crypto.deletePrivateKey(agreement.privateKeyHandle);
  expect(native.deleteKey).toHaveBeenCalled();
});

it('rejects forged algorithm/purpose and ciphertext authentication failures', async () => {
  const native = bridge({
    aead: jest.fn(async () => { throw new Error('native failed'); }),
  });
  const crypto = await AndroidHardwareCryptoProvider.create(native);
  const wrong = {
    provider: 'android-keystore-curve25519-v1',
    id: 'ABCDEFGHIJKLMNOPQRSTUVWX',
    algorithm: 'X25519' as const,
    purpose: 'session-ephemeral' as const,
  };
  await expect(crypto.sign(wrong, new Uint8Array(1))).rejects.toBeInstanceOf(SecurityError);
  await expect(crypto.aeadDecrypt(new Uint8Array(32), new Uint8Array(12),
    new Uint8Array(16), new Uint8Array(0)))
    .rejects.toMatchObject({code: 'AUTHENTICATION_FAILED'});
  expect(native.sign).not.toHaveBeenCalled();
});

it('persists bytes behind an explicit secret API and commits identity as one native transaction', async () => {
  const native = bridge({
    read: jest.fn(async () => Buffer.from([3, 2, 1]).toString('base64')),
  });
  const secrets = new AndroidSecureSecretStore(native);
  await secrets.setSecret('group/example/epoch-1', new Uint8Array([3, 2, 1]));
  expect(native.write).toHaveBeenCalledWith('secret', 'group/example/epoch-1', 'AwIB');
  expect(await secrets.getSecret('group/example/epoch-1')).toEqual(new Uint8Array([3, 2, 1]));
  await secrets.deleteSecret('group/example/epoch-1');
  expect(native.remove).toHaveBeenCalledWith('secret', 'group/example/epoch-1');

  const metadata = new AndroidSecurityMetadataStore(native);
  const identity = {keyEpoch: 1} as DeviceIdentity;
  const handles = {keyEpoch: 1} as LocalIdentityKeyHandles;
  await metadata.setLocalIdentity(identity, handles);
  expect(native.setIdentityAtomic).toHaveBeenCalledTimes(1);
  await expect(metadata.setLocalIdentity(identity, {...handles, keyEpoch: 2}))
    .rejects.toMatchObject({code: 'IDENTITY_CORRUPT'});
});

it('passes monotonic bigints as exact decimal strings across the native boundary', async () => {
  const native = bridge({
    getNonceHigh: jest.fn(async () => '18446744073709551613'),
    reserveNonce: jest.fn(async () => '18446744073709551614'),
  });
  const metadata = new AndroidSecurityMetadataStore(native);
  expect(await metadata.getNonceHighWatermark('session/a')).toBe(18446744073709551613n);
  expect(await metadata.reserveNonceCounter('session/a', 18446744073709551613n))
    .toBe(18446744073709551614n);
  expect(native.reserveNonce).toHaveBeenCalledWith('session/a', '18446744073709551613');
  await expect(metadata.reserveNonceCounter('session/a', -1n))
    .rejects.toMatchObject({code: 'INVALID_INPUT'});
  expect(await metadata.acceptReplayCounter('scope', 99n, 128)).toBe(true);
  expect(native.acceptReplay).toHaveBeenCalledWith('scope', '99', 128);
});

it('exposes only a storage-only epoch CAS and never invokes enrolment', async () => {
  const native = bridge();
  const storage = new AndroidSecurityEpochStorage(native);
  const next = {groupId: 'bmg1_test', currentEpoch: 2} as GroupRecord;
  expect(await storage.commitGroupEpoch({
    transactionId: 'tx123', groupId: 'bmg1_test', commitDigest: 'sha256-abc',
    expectedEpoch: 1, nextRecord: next, keyRef: 'group/bmg1_test/epoch-2',
    newEpochKey: new Uint8Array(32).fill(9),
  })).toBe(true);
  expect(native.commitEpoch).toHaveBeenCalledWith(
    'tx123', 'bmg1_test', 'sha256-abc', 1, 2, JSON.stringify(next),
    'group/bmg1_test/epoch-2', Buffer.alloc(32, 9).toString('base64'),
  );
  expect(native.createKey).not.toHaveBeenCalled();
});

it('fails closed rather than parsing corrupted protected metadata', async () => {
  const metadata = new AndroidSecurityMetadataStore(bridge({
    read: jest.fn(async () => Buffer.from('{invalid').toString('base64')),
  }));
  await expect(metadata.getIdentity()).rejects.toMatchObject({code: 'IDENTITY_CORRUPT'});
});

it('retirement requires explicit invocation of the dedicated native API', async () => {
  const native = bridge();
  await retireAndroidLocalIdentity(native);
  expect(native.retireIdentity).toHaveBeenCalledTimes(1);
});
