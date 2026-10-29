export type SecurityVersion = number;
export type ProtocolVersion = number;
export type TrustState = 'unverified' | 'trusted' | 'revoked';
export type SessionState = 'active' | 'rotated' | 'expired' | 'revoked';
export type GroupKeyState = 'active' | 'rotated' | 'revoked';

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

export interface IdentityRotationProof {
  previousFingerprint: string;
  nextIdentity: DeviceIdentity;
  rotatedAt: number;
  signature: string;
}

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

export interface PairingProof {
  identity: DeviceIdentity;
  challenge: string;
  supportedSecurityVersions: SecurityVersion[];
  supportedProtocolVersions: ProtocolVersion[];
  issuedAt: number;
  signature: string;
}

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

export interface PendingHandshakeRecord {
  handshakeId: string;
  peerDeviceId: string;
  offer: SessionOffer;
  privateKeyRef: string;
  createdAt: number;
  expiresAt: number;
}

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

export interface GroupMembership {
  deviceId: string;
  identityFingerprint: string;
  role: GroupMemberRole;
  state: GroupMemberState;
  joinedAt: number;
  revokedAt?: number;
}

export interface GroupKeyEpochRecord {
  epoch: number;
  keyRef: string;
  state: GroupKeyState;
  createdAt: number;
  rotatedAt?: number;
  revokedAt?: number;
}

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

export interface EncryptedGroupMessage {
  securityVersion: SecurityVersion;
  protocolVersion: ProtocolVersion;
  groupId: string;
  epoch: number;
  senderDeviceId: string;
  counter: string;
  ciphertext: string;
}

export interface SecurityProtocolContext {
  /** Canonical protocol/runtime version selected for this protected exchange. */
  protocolVersion: ProtocolVersion;
  /** Canonical immutable protocol header bytes to authenticate as AEAD AAD. */
  authenticatedHeader: Uint8Array;
}
