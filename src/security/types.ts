export type SecurityVersion = number;
export type ProtocolVersion = number;
export type TrustState = 'unverified' | 'trusted' | 'revoked';
export type SessionState = 'active' | 'rotated' | 'expired' | 'revoked';
export type GroupKeyState = 'active' | 'rotated' | 'revoked';
export type PrivateKeyAlgorithm = 'Ed25519' | 'X25519';
export type PrivateKeyPurpose =
  | 'identity-signing'
  | 'identity-agreement'
  | 'session-ephemeral';

/**
 * Serializable reference to asymmetric private key material owned by a
 * CryptoProvider. No private key bytes are carried in this object.
 */
export interface PrivateKeyHandle {
  provider: string;
  id: string;
  algorithm: PrivateKeyAlgorithm;
  purpose: PrivateKeyPurpose;
}

/** Local persistence record; not a transport/wire object. */
export interface LocalIdentityKeyHandles {
  keyEpoch: number;
  signingPrivateKey: PrivateKeyHandle;
  agreementPrivateKey: PrivateKeyHandle;
  createdAt: number;
}

/** Public stable device identity that may be transported inside Security v1 proofs/handshakes. */
export interface DeviceIdentity {
  identityVersion: 1;
  deviceId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
  fingerprint: string;
  keyEpoch: number;
  createdAt: number;
  rotatedAt?: number;
}

/** Transport-neutral signed proof that advances one peer identity key epoch. */
export interface IdentityRotationProof {
  previousFingerprint: string;
  nextIdentity: DeviceIdentity;
  rotatedAt: number;
  signature: string;
}

/** Local persistence record; not a transport/wire object. */
export interface PeerTrustRecord {
  deviceId: string;
  identity: DeviceIdentity;
  trustState: TrustState;
  fingerprintHistory: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  trustedAt?: number;
  revokedAt?: number;
  revocationReason?: string;
}

/** Transport-neutral challenge-bound proof used during pairing/trust establishment. */
export interface PairingProof {
  identity: DeviceIdentity;
  challenge: string;
  supportedSecurityVersions: SecurityVersion[];
  supportedProtocolVersions: ProtocolVersion[];
  issuedAt: number;
  signature: string;
}

/** Transport-neutral initiator half of the authenticated direct-session handshake. */
export interface SessionOffer {
  handshakeId: string;
  initiator: DeviceIdentity;
  responderDeviceId: string;
  ephemeralAgreementPublicKey: string;
  nonce: string;
  sendNoncePrefix: string;
  supportedSecurityVersions: SecurityVersion[];
  supportedProtocolVersions: ProtocolVersion[];
  issuedAt: number;
  signature: string;
}

/** Transport-neutral responder half of the authenticated direct-session handshake. */
export interface SessionResponse {
  handshakeId: string;
  responder: DeviceIdentity;
  initiatorDeviceId: string;
  ephemeralAgreementPublicKey: string;
  nonce: string;
  sendNoncePrefix: string;
  selectedSecurityVersion: SecurityVersion;
  selectedProtocolVersion: ProtocolVersion;
  issuedAt: number;
  signature: string;
}

/** Local persistence record; not a transport/wire object. */
export interface PendingHandshakeRecord {
  handshakeId: string;
  peerDeviceId: string;
  offer: SessionOffer;
  privateKeyHandle: PrivateKeyHandle;
  createdAt: number;
  expiresAt: number;
}

/** Local persistence record; not a transport/wire object. */
export interface DirectSessionRecord {
  sessionId: string;
  peerDeviceId: string;
  peerFingerprint: string;
  securityVersion: SecurityVersion;
  protocolVersion: ProtocolVersion;
  keyEpoch: number;
  sendKeyRef: string;
  receiveKeyRef: string;
  sendNoncePrefix: string;
  receiveNoncePrefix: string;
  sendNonceScope: string;
  receiveReplayScope: string;
  createdAt: number;
  expiresAt: number;
  state: SessionState;
}

/** Transport-neutral protected direct payload returned by DirectSessionManager.encrypt(). */
export interface EncryptedDirectMessage {
  securityVersion: SecurityVersion;
  protocolVersion: ProtocolVersion;
  sessionId: string;
  keyEpoch: number;
  counter: string;
  ciphertext: string;
}

export type GroupMemberRole = 'leader' | 'member';
export type GroupMemberState = 'active' | 'revoked';

/** Local/group-key-package membership record; not an independent routing object. */
export interface GroupMembership {
  deviceId: string;
  identityFingerprint: string;
  role: GroupMemberRole;
  state: GroupMemberState;
  joinedAt: number;
  revokedAt?: number;
}

/** Local persistence record; not a transport/wire object. */
export interface GroupKeyEpochRecord {
  epoch: number;
  keyRef: string;
  state: GroupKeyState;
  createdAt: number;
  rotatedAt?: number;
  revokedAt?: number;
}

/** Local persistence record; not a transport/wire object. */
export interface GroupRecord {
  groupId: string;
  securityVersion: SecurityVersion;
  protocolVersion: ProtocolVersion;
  currentEpoch: number;
  members: GroupMembership[];
  keyEpochs: GroupKeyEpochRecord[];
  createdAt: number;
  updatedAt: number;
}

/** Transport-neutral protected group payload returned by GroupKeyManager.encrypt(). */
export interface EncryptedGroupMessage {
  securityVersion: SecurityVersion;
  protocolVersion: ProtocolVersion;
  groupId: string;
  epoch: number;
  senderDeviceId: string;
  counter: string;
  ciphertext: string;
}

/**
 * Transport-neutral group-key delivery container. The actual group key and
 * membership package exist only inside the authenticated direct-session
 * ciphertext carried by encryptedPayload.
 */
export interface WrappedGroupKeyDistribution {
  distributionVersion: 1;
  groupId: string;
  epoch: number;
  senderDeviceId: string;
  senderFingerprint: string;
  recipientDeviceId: string;
  recipientFingerprint: string;
  securityVersion: SecurityVersion;
  protocolVersion: ProtocolVersion;
  sessionId: string;
  encryptedPayload: EncryptedDirectMessage;
}

/**
 * Integration boundary supplied by the canonical protocol/runtime for every
 * protected direct/group exchange.
 *
 * authenticatedHeader is the protocol branch's deterministic byte encoding of
 * immutable end-to-end metadata that must not be attacker-rewritable. Security
 * v1 authenticates these bytes as AEAD AAD but deliberately does not define the
 * protocol header schema, routing fields or packet framing.
 */
export interface SecurityProtocolContext {
  /** Must exactly match the protocol version selected for the session/group. */
  protocolVersion: ProtocolVersion;
  /** Canonical immutable end-to-end protocol header bytes to authenticate. */
  authenticatedHeader: Uint8Array;
}
