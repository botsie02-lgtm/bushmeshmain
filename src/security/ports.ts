import type {
  DeviceIdentity,
  DirectSessionRecord,
  GroupRecord,
  PeerTrustRecord,
  PendingHandshakeRecord,
} from './types';

export interface GeneratedKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface CryptoProvider {
  randomBytes(length: number): Uint8Array;
  sha256(data: Uint8Array): Promise<Uint8Array>;
  hkdfSha256(
    inputKeyMaterial: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number,
  ): Promise<Uint8Array>;
  generateSigningKeyPair(): Promise<GeneratedKeyPair>;
  generateAgreementKeyPair(): Promise<GeneratedKeyPair>;
  sign(privateKeyPkcs8: Uint8Array, message: Uint8Array): Promise<Uint8Array>;
  verify(publicKeyRaw: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean>;
  deriveSharedSecret(privateKeyPkcs8: Uint8Array, peerPublicKeyRaw: Uint8Array): Promise<Uint8Array>;
  aeadEncrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    associatedData: Uint8Array,
  ): Promise<Uint8Array>;
  aeadDecrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
    associatedData: Uint8Array,
  ): Promise<Uint8Array>;
}

/**
 * Production implementations must map these opaque names to Android Keystore,
 * iOS Keychain/Secure Enclave, or equivalent hardware-backed storage.
 */
export interface SecureSecretStore {
  setSecret(name: string, value: Uint8Array): Promise<void>;
  getSecret(name: string): Promise<Uint8Array | null>;
  deleteSecret(name: string): Promise<void>;
}

/**
 * Non-secret metadata may live in normal application persistence. The nonce and
 * replay methods MUST be atomic and durable in production.
 */
export interface SecurityMetadataStore {
  getIdentity(): Promise<DeviceIdentity | null>;
  setIdentity(identity: DeviceIdentity): Promise<void>;

  listPeers(): Promise<PeerTrustRecord[]>;
  getPeer(deviceId: string): Promise<PeerTrustRecord | null>;
  setPeer(record: PeerTrustRecord): Promise<void>;

  getPendingHandshake(handshakeId: string): Promise<PendingHandshakeRecord | null>;
  setPendingHandshake(record: PendingHandshakeRecord): Promise<void>;
  deletePendingHandshake(handshakeId: string): Promise<void>;

  getSession(sessionId: string): Promise<DirectSessionRecord | null>;
  setSession(record: DirectSessionRecord): Promise<void>;

  getGroup(groupId: string): Promise<GroupRecord | null>;
  setGroup(record: GroupRecord): Promise<void>;

  /** Reserve and persist the next counter before encryption occurs. */
  reserveNonceCounter(scope: string): Promise<bigint>;

  /** Atomically accept a fresh counter or reject a duplicate/too-old counter. */
  acceptReplayCounter(scope: string, counter: bigint, windowSize: number): Promise<boolean>;
}

export interface SecurityClock {
  now(): number;
}

export const systemClock: SecurityClock = {
  now: () => Date.now(),
};
