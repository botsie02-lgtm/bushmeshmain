import type {
  DeviceIdentity,
  DirectSessionRecord,
  GroupRecord,
  LocalIdentityKeyHandles,
  PeerTrustRecord,
  PendingHandshakeRecord,
  PrivateKeyHandle,
  PrivateKeyPurpose,
} from './types';

export interface GeneratedKeyPair {
  publicKey: Uint8Array;
  privateKeyHandle: PrivateKeyHandle;
}

/**
 * Cryptographic boundary for BushMesh Security v1.
 *
 * Production implementations own asymmetric private-key material internally.
 * Callers receive only opaque, serializable handles. A provider MUST NOT require
 * Security v1 callers to export PKCS#8/private-key bytes in order to sign or
 * perform key agreement.
 *
 * Provider requirements:
 * - generated handles remain resolvable after process restart until deleted;
 * - handles are scoped to the provider named by PrivateKeyHandle.provider;
 * - hasPrivateKey returns false for deleted/unresolvable handles;
 * - sign/deriveSharedSecret fail closed with KEY_NOT_FOUND for an unavailable
 *   handle and reject algorithm/purpose mismatches;
 * - deletePrivateKey is safe to call during cleanup even after partial failure;
 * - returned public keys use the raw 32-byte Ed25519/X25519 Security v1 format.
 */
export interface CryptoProvider {
  randomBytes(length: number): Uint8Array;
  sha256(data: Uint8Array): Promise<Uint8Array>;
  hkdfSha256(
    inputKeyMaterial: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number,
  ): Promise<Uint8Array>;
  generateSigningKeyPair(
    purpose: Extract<PrivateKeyPurpose, 'identity-signing'>,
  ): Promise<GeneratedKeyPair>;
  generateAgreementKeyPair(
    purpose: Extract<PrivateKeyPurpose, 'identity-agreement' | 'session-ephemeral'>,
  ): Promise<GeneratedKeyPair>;
  hasPrivateKey(handle: PrivateKeyHandle): Promise<boolean>;
  deletePrivateKey(handle: PrivateKeyHandle): Promise<void>;
  sign(handle: PrivateKeyHandle, message: Uint8Array): Promise<Uint8Array>;
  verify(publicKeyRaw: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean>;
  deriveSharedSecret(handle: PrivateKeyHandle, peerPublicKeyRaw: Uint8Array): Promise<Uint8Array>;
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
 * Symmetric secret storage. Production implementations must protect values at
 * rest with platform security facilities and must never route them through
 * AsyncStorage, React state, logs, analytics or plaintext files. Asymmetric
 * private keys do NOT flow through this API.
 */
export interface SecureSecretStore {
  setSecret(name: string, value: Uint8Array): Promise<void>;
  getSecret(name: string): Promise<Uint8Array | null>;
  deleteSecret(name: string): Promise<void>;
}

/**
 * Non-secret security metadata persistence.
 *
 * Atomicity requirements are part of the production contract:
 * - setLocalIdentity MUST atomically commit the public identity and matching
 *   opaque private-key handles as one logical transaction. A crash must not
 *   expose one without the other.
 * - reserveNonceCounter MUST atomically compare the persisted counter against
 *   minimumHighWatermark, increment it, durably commit, then return it.
 * - advanceNonceHighWatermark MUST be atomic, durable and monotonic (max only).
 * - the nonce high-watermark SHOULD live in an independently protected rollback
 *   domain from the ordinary nonce counter when the platform supports it.
 * - acceptReplayCounter MUST atomically and durably update the complete replay
 *   window before returning true.
 * - consumeHandshakeId MUST atomically reject duplicate handshake IDs.
 */
export interface SecurityMetadataStore {
  getIdentity(): Promise<DeviceIdentity | null>;
  getIdentityKeyHandles(): Promise<LocalIdentityKeyHandles | null>;
  setLocalIdentity(identity: DeviceIdentity, handles: LocalIdentityKeyHandles): Promise<void>;

  listPeers(): Promise<PeerTrustRecord[]>;
  getPeer(deviceId: string): Promise<PeerTrustRecord | null>;
  setPeer(record: PeerTrustRecord): Promise<void>;

  getPendingHandshake(handshakeId: string): Promise<PendingHandshakeRecord | null>;
  setPendingHandshake(record: PendingHandshakeRecord): Promise<void>;
  deletePendingHandshake(handshakeId: string): Promise<void>;
  consumeHandshakeId(handshakeId: string, expiresAt: number): Promise<boolean>;

  getSession(sessionId: string): Promise<DirectSessionRecord | null>;
  listSessions(peerDeviceId?: string): Promise<DirectSessionRecord[]>;
  setSession(record: DirectSessionRecord): Promise<void>;

  getGroup(groupId: string): Promise<GroupRecord | null>;
  setGroup(record: GroupRecord): Promise<void>;

  getNonceHighWatermark(scope: string): Promise<bigint>;
  advanceNonceHighWatermark(scope: string, counter: bigint): Promise<void>;
  reserveNonceCounter(scope: string, minimumHighWatermark: bigint): Promise<bigint>;

  /** Atomically accept a fresh counter or reject a duplicate/too-old counter. */
  acceptReplayCounter(scope: string, counter: bigint, windowSize: number): Promise<boolean>;
}

export interface SecurityClock {
  now(): number;
}

export const systemClock: SecurityClock = {
  now: () => Date.now(),
};
