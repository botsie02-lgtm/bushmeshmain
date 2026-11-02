export {SecurityError, isSecurityError} from './errors';
export type {SecurityErrorCode} from './errors';
export {IdentityManager} from './identity';
export {PairingService} from './pairing';
export {PeerTrustManager} from './trust';
export {DirectSessionManager} from './session';
export {GroupKeyManager} from './group';
export {VersionPolicy, securityV1VersionPolicy} from './versionPolicy';

export type {
  CryptoProvider,
  GeneratedKeyPair,
  SecureSecretStore,
  SecurityClock,
  SecurityMetadataStore,
} from './ports';
export type {
  DeviceIdentity,
  DirectSessionRecord,
  EncryptedDirectMessage,
  EncryptedGroupMessage,
  GroupKeyEpochRecord,
  GroupMembership,
  GroupRecord,
  IdentityRotationProof,
  LocalIdentityKeyHandles,
  PairingProof,
  PeerTrustRecord,
  PendingHandshakeRecord,
  PrivateKeyAlgorithm,
  PrivateKeyHandle,
  PrivateKeyPurpose,
  ProtocolVersion,
  SecurityProtocolContext,
  SecurityVersion,
  SessionOffer,
  SessionResponse,
  SessionState,
  TrustState,
  WrappedGroupKeyDistribution,
} from './types';
