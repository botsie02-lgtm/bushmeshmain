import {Buffer} from 'buffer';
import {NativeModules} from 'react-native';
import {SecurityError} from '../errors';
import type {CryptoProvider, GeneratedKeyPair, SecureSecretStore, SecurityMetadataStore} from '../ports';
import type {
  DeviceIdentity, DirectSessionRecord, GroupRecord, LocalIdentityKeyHandles,
  PeerTrustRecord, PendingHandshakeRecord, PrivateKeyHandle, PrivateKeyPurpose,
} from '../types';

/**
 * Not part of the default application security dependency graph.
 * Android keys are never exported; GROUP/SESSION symmetric keys necessarily
 * enter JS while used by the existing Security v1 CryptoProvider contract.
 */
export interface AndroidSecurityCapabilityReport {
  apiLevel: number;
  schemaVersion: 1;
  storageLevel: 'strongbox' | 'tee' | 'hardware-unclassified' | 'unavailable';
  strongBoxFeature: boolean;
  ed25519: boolean;
  x25519: boolean;
  ed25519Level?: string;
  x25519Level?: string;
  ed25519Failure?: string;
  x25519Failure?: string;
  enabled: boolean;
  enabledInApplication: false;
  hardwareRollbackResistantCounters: false;
}

export interface AndroidSecurityNativeBridge {
  probe(): Promise<string>;
  read(kind: string, name: string): Promise<string | null>;
  write(kind: string, name: string, base64: string): Promise<void>;
  remove(kind: string, name: string): Promise<void>;
  listMetadata(prefix: string): Promise<string[]>;
  setIdentityAtomic(identity: string, handles: string): Promise<void>;
  getNonceHigh(scope: string): Promise<string>;
  reserveNonce(scope: string, floor: string): Promise<string>;
  advanceNonceHigh(scope: string, value: string): Promise<void>;
  acceptReplay(scope: string, counter: string, window: number): Promise<boolean>;
  consumeHandshake(id: string, expiresAt: number): Promise<boolean>;
  commitEpoch(
    txId: string, groupId: string, digest: string, expected: number, next: number,
    record: string, keyRef: string, base64Secret: string,
  ): Promise<boolean>;
  epochHigh(groupId: string): Promise<number>;
  randomBytes(length: number): Promise<string>;
  sha256(value: string): Promise<string>;
  hkdf(input: string, salt: string, info: string, size: number): Promise<string>;
  aead(encrypt: boolean, key: string, nonce: string, body: string, aad: string): Promise<string>;
  createKey(algorithm: string, purpose: string): Promise<string>;
  hasKey(handle: string): Promise<boolean>;
  deleteKey(handle: string): Promise<void>;
  sign(handle: string, message: string): Promise<string>;
  verify(publicKey: string, message: string, signature: string): Promise<boolean>;
  agree(handle: string, publicKey: string): Promise<string>;
}

const PROVIDER = 'android-keystore-curve25519-v1';
const MAX_COUNTER = 0xffffffffffffffffn;
const b64 = (value: Uint8Array): string => Buffer.from(value).toString('base64');
const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, 'base64'));
const encodeJson = (value: unknown): string => JSON.stringify(value);

function parseJson<T>(value: string | null): T | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Not a record');
    }
    return parsed as T;
  } catch {
    throw new SecurityError('IDENTITY_CORRUPT', 'Protected security metadata is malformed');
  }
}

function assertCounter(value: bigint): string {
  if (value < 0n || value > MAX_COUNTER) {
    throw new SecurityError('INVALID_INPUT', 'Invalid 64-bit security counter');
  }
  return value.toString();
}

function assertHandle(handle: PrivateKeyHandle): void {
  if (
    handle.provider !== PROVIDER ||
    !/^[A-Za-z0-9_-]{24}$/.test(handle.id) ||
    !(
      (handle.algorithm === 'Ed25519' && handle.purpose === 'identity-signing') ||
      (handle.algorithm === 'X25519' &&
        (handle.purpose === 'identity-agreement' || handle.purpose === 'session-ephemeral'))
    )
  ) {
    throw new SecurityError('KEY_NOT_FOUND', 'Unknown or mismatched Android private-key handle');
  }
}

/** Runs only on a real registered Android RN runtime, or with an injected test bridge. */
export function getAndroidSecurityNativeBridge(): AndroidSecurityNativeBridge {
  const bridge = (NativeModules as {BushMeshSecurity?: AndroidSecurityNativeBridge}).BushMeshSecurity;
  if (!bridge || typeof bridge.probe !== 'function') {
    throw new SecurityError('UNSUPPORTED_VERSION', 'Android production security module is unavailable');
  }
  return bridge;
}

export async function probeAndroidProductionSecurity(
  bridge: AndroidSecurityNativeBridge = getAndroidSecurityNativeBridge(),
): Promise<AndroidSecurityCapabilityReport> {
  const report = parseJson<AndroidSecurityCapabilityReport>(await bridge.probe());
  if (!report || report.schemaVersion !== 1 || report.enabledInApplication !== false ||
      report.hardwareRollbackResistantCounters !== false) {
    throw new SecurityError('UNSUPPORTED_VERSION', 'Unexpected Android security capability version');
  }
  return report;
}

export class AndroidSecureSecretStore implements SecureSecretStore {
  constructor(private readonly native: AndroidSecurityNativeBridge) {}

  async setSecret(name: string, value: Uint8Array): Promise<void> {
    await this.native.write('secret', name, b64(value));
  }

  async getSecret(name: string): Promise<Uint8Array | null> {
    const value = await this.native.read('secret', name);
    return value === null ? null : bytes(value);
  }

  async deleteSecret(name: string): Promise<void> {
    await this.native.remove('secret', name);
  }
}

export class AndroidSecurityMetadataStore implements SecurityMetadataStore {
  constructor(private readonly native: AndroidSecurityNativeBridge) {}

  private async getRecord<T>(name: string): Promise<T | null> {
    const encoded = await this.native.read('meta', name);
    if (encoded === null) return null;
    return parseJson<T>(Buffer.from(encoded, 'base64').toString('utf8'));
  }

  private async putRecord(name: string, record: unknown): Promise<void> {
    await this.native.write('meta', name, b64(Buffer.from(encodeJson(record), 'utf8')));
  }

  private async listRecords<T>(prefix: string): Promise<T[]> {
    const keys = await this.native.listMetadata(prefix);
    return Promise.all(keys.map(async key => {
      const value = await this.getRecord<T>(key);
      if (value === null) {
        throw new SecurityError('IDENTITY_CORRUPT', 'Missing indexed security metadata');
      }
      return value;
    }));
  }

  getIdentity(): Promise<DeviceIdentity | null> {
    return this.getRecord('identity');
  }

  getIdentityKeyHandles(): Promise<LocalIdentityKeyHandles | null> {
    return this.getRecord('identityHandles');
  }

  async setLocalIdentity(identity: DeviceIdentity, handles: LocalIdentityKeyHandles): Promise<void> {
    if (identity.keyEpoch !== handles.keyEpoch) {
      throw new SecurityError('IDENTITY_CORRUPT', 'Identity and handle epochs must match');
    }
    await this.native.setIdentityAtomic(encodeJson(identity), encodeJson(handles));
  }

  listPeers(): Promise<PeerTrustRecord[]> {
    return this.listRecords('peer/');
  }

  getPeer(deviceId: string): Promise<PeerTrustRecord | null> {
    return this.getRecord('peer/' + deviceId);
  }

  setPeer(record: PeerTrustRecord): Promise<void> {
    return this.putRecord('peer/' + record.deviceId, record);
  }

  getPendingHandshake(id: string): Promise<PendingHandshakeRecord | null> {
    return this.getRecord('pending/' + id);
  }

  setPendingHandshake(record: PendingHandshakeRecord): Promise<void> {
    return this.putRecord('pending/' + record.handshakeId, record);
  }

  deletePendingHandshake(id: string): Promise<void> {
    return this.native.remove('meta', 'pending/' + id);
  }

  consumeHandshakeId(id: string, expiresAt: number): Promise<boolean> {
    return this.native.consumeHandshake(id, expiresAt);
  }

  getSession(sessionId: string): Promise<DirectSessionRecord | null> {
    return this.getRecord('session/' + sessionId);
  }

  async listSessions(peerDeviceId?: string): Promise<DirectSessionRecord[]> {
    const records = await this.listRecords<DirectSessionRecord>('session/');
    return peerDeviceId === undefined ? records : records.filter(r => r.peerDeviceId === peerDeviceId);
  }

  setSession(record: DirectSessionRecord): Promise<void> {
    return this.putRecord('session/' + record.sessionId, record);
  }

  getGroup(groupId: string): Promise<GroupRecord | null> {
    return this.getRecord('group/' + groupId);
  }

  setGroup(record: GroupRecord): Promise<void> {
    return this.putRecord('group/' + record.groupId, record);
  }

  async getNonceHighWatermark(scope: string): Promise<bigint> {
    return BigInt(await this.native.getNonceHigh(scope));
  }

  async advanceNonceHighWatermark(scope: string, counter: bigint): Promise<void> {
    await this.native.advanceNonceHigh(scope, assertCounter(counter));
  }

  async reserveNonceCounter(scope: string, minimumHighWatermark: bigint): Promise<bigint> {
    return BigInt(await this.native.reserveNonce(scope, assertCounter(minimumHighWatermark)));
  }

  acceptReplayCounter(scope: string, counter: bigint, windowSize: number): Promise<boolean> {
    if (!Number.isSafeInteger(windowSize) || windowSize < 8 || windowSize > 1024) {
      throw new SecurityError('INVALID_INPUT', 'Invalid replay window size');
    }
    return this.native.acceptReplay(scope, assertCounter(counter), windowSize);
  }
}

/** Storage-only V2 CAS, not authority validation or operational enrolment. */
export class AndroidSecurityEpochStorage {
  constructor(private readonly native: AndroidSecurityNativeBridge) {}

  async commitGroupEpoch(params: {
    transactionId: string;
    groupId: string;
    commitDigest: string;
    expectedEpoch: number;
    nextRecord: GroupRecord;
    keyRef: string;
    newEpochKey: Uint8Array;
  }): Promise<boolean> {
    const {transactionId, groupId, commitDigest, expectedEpoch, nextRecord, keyRef, newEpochKey} = params;
    if (newEpochKey.length !== 32 || nextRecord.groupId !== groupId ||
        nextRecord.currentEpoch !== expectedEpoch + 1) {
      throw new SecurityError('INVALID_INPUT', 'Invalid epoch commit inputs');
    }
    return this.native.commitEpoch(
      transactionId, groupId, commitDigest, expectedEpoch, nextRecord.currentEpoch,
      JSON.stringify(nextRecord), keyRef, b64(newEpochKey),
    );
  }

  getHighWatermark(groupId: string): Promise<number> {
    return this.native.epochHigh(groupId);
  }
}

export class AndroidHardwareCryptoProvider implements CryptoProvider {
  private offset = 0;
  private constructor(
    private readonly native: AndroidSecurityNativeBridge,
    private readonly entropy: Uint8Array,
  ) {}

  static async create(native: AndroidSecurityNativeBridge): Promise<AndroidHardwareCryptoProvider> {
    const report = await probeAndroidProductionSecurity(native);
    if (!report.enabled || !report.ed25519 || !report.x25519 ||
        !['tee', 'strongbox', 'hardware-unclassified'].includes(report.storageLevel)) {
      throw new SecurityError('UNSUPPORTED_VERSION',
        'Exact hardware Ed25519/X25519 not verified; production identity disabled');
    }
    // Synchronous CryptoProvider.randomBytes uses an independently sourced,
    // single-use native SecureRandom pool; exhaustion FAILS CLOSED.
    const seed = bytes(await native.randomBytes(16384));
    if (seed.length !== 16384) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Android entropy pool has wrong length');
    }
    return new AndroidHardwareCryptoProvider(native, seed);
  }

  randomBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length <= 0 || this.offset + length > this.entropy.length) {
      throw new SecurityError('INVALID_INPUT', 'Native CSPRNG pool exhausted or length invalid');
    }
    const out = this.entropy.slice(this.offset, this.offset + length);
    this.entropy.fill(0, this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  async sha256(data: Uint8Array): Promise<Uint8Array> {
    return bytes(await this.native.sha256(b64(data)));
  }

  async hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length < 1 || length > 8160) {
      throw new SecurityError('INVALID_INPUT', 'Invalid HKDF output length');
    }
    return bytes(await this.native.hkdf(b64(ikm), b64(salt), b64(info), length));
  }

  private async generate(algorithm: 'Ed25519' | 'X25519', purpose: PrivateKeyPurpose): Promise<GeneratedKeyPair> {
    const result = parseJson<{publicKey: string; privateKeyHandle: PrivateKeyHandle; hardwareLevel: string}>(
      await this.native.createKey(algorithm, purpose));
    if (!result || result.publicKey.length === 0 ||
        !['tee', 'strongbox', 'hardware-unclassified'].includes(result.hardwareLevel)) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Native key creation did not attest hardware residency');
    }
    assertHandle(result.privateKeyHandle);
    const publicKey = bytes(result.publicKey);
    if (publicKey.length !== 32 || result.privateKeyHandle.algorithm !== algorithm ||
        result.privateKeyHandle.purpose !== purpose) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Android key format or purpose mismatch');
    }
    return {publicKey, privateKeyHandle: result.privateKeyHandle};
  }

  generateSigningKeyPair(purpose: 'identity-signing'): Promise<GeneratedKeyPair> {
    return this.generate('Ed25519', purpose);
  }

  generateAgreementKeyPair(purpose: 'identity-agreement' | 'session-ephemeral'): Promise<GeneratedKeyPair> {
    return this.generate('X25519', purpose);
  }

  hasPrivateKey(handle: PrivateKeyHandle): Promise<boolean> {
    assertHandle(handle);
    return this.native.hasKey(encodeJson(handle));
  }

  deletePrivateKey(handle: PrivateKeyHandle): Promise<void> {
    assertHandle(handle);
    return this.native.deleteKey(encodeJson(handle));
  }

  async sign(handle: PrivateKeyHandle, message: Uint8Array): Promise<Uint8Array> {
    assertHandle(handle);
    if (handle.algorithm !== 'Ed25519' || handle.purpose !== 'identity-signing') {
      throw new SecurityError('INVALID_INPUT', 'Signing requires an identity-signing Ed25519 key');
    }
    return bytes(await this.native.sign(encodeJson(handle), b64(message)));
  }

  verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    if (publicKey.length !== 32 || signature.length !== 64) return Promise.resolve(false);
    return this.native.verify(b64(publicKey), b64(message), b64(signature));
  }

  async deriveSharedSecret(handle: PrivateKeyHandle, peerPublicKey: Uint8Array): Promise<Uint8Array> {
    assertHandle(handle);
    if (handle.algorithm !== 'X25519' || peerPublicKey.length !== 32) {
      throw new SecurityError('INVALID_INPUT', 'Key agreement requires X25519 and 32-byte peer key');
    }
    const result = bytes(await this.native.agree(encodeJson(handle), b64(peerPublicKey)));
    if (result.length !== 32 || result.every(b => b === 0)) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Android key agreement failed');
    }
    return result;
  }

  async aeadEncrypt(key: Uint8Array, nonce: Uint8Array, data: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    this.assertAead(key, nonce);
    return bytes(await this.native.aead(true, b64(key), b64(nonce), b64(data), b64(aad)));
  }

  async aeadDecrypt(key: Uint8Array, nonce: Uint8Array, data: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    this.assertAead(key, nonce);
    if (data.length < 16) throw new SecurityError('INVALID_INPUT', 'Invalid AEAD body');
    try {
      return bytes(await this.native.aead(false, b64(key), b64(nonce), b64(data), b64(aad)));
    } catch {
      throw new SecurityError('AUTHENTICATION_FAILED', 'AEAD ciphertext could not be authenticated');
    }
  }

  private assertAead(key: Uint8Array, nonce: Uint8Array): void {
    if (key.length !== 32 || nonce.length !== 12) {
      throw new SecurityError('INVALID_INPUT', 'Security v1 requires AES-256-GCM and 96-bit nonce');
    }
  }
}

/** Explicit opt-in factory only; the application never calls it automatically. */
export async function createAndroidProductionSecurity(
  bridge: AndroidSecurityNativeBridge = getAndroidSecurityNativeBridge(),
): Promise<{
  crypto: AndroidHardwareCryptoProvider;
  metadata: AndroidSecurityMetadataStore;
  secrets: AndroidSecureSecretStore;
  epochStorage: AndroidSecurityEpochStorage;
}> {
  const crypto = await AndroidHardwareCryptoProvider.create(bridge);
  return {
    crypto,
    metadata: new AndroidSecurityMetadataStore(bridge),
    secrets: new AndroidSecureSecretStore(bridge),
    epochStorage: new AndroidSecurityEpochStorage(bridge),
  };
}
