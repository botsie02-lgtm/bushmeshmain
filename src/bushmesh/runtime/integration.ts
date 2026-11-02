import type {
  BushMeshSecurityProtocolContext,
  BushMeshSecurityTrafficClass,
} from '../protocol/securityBoundary';

export type BushMeshOutboundPriority =
  | 'safety'
  | 'control'
  | 'message'
  | 'position'
  | 'bulk';

export type BushMeshRetryIntent =
  | {
      mode: 'none' | 'protocol-managed';
      maxTransportAttempts: 1;
    }
  | {
      mode: 'transport-retry';
      maxTransportAttempts: number;
    };

export type BushMeshSecurityAssociation =
  | {kind: 'direct-session'; sessionId: string; peerDeviceId?: string}
  | {kind: 'group'; groupId: string}
  | {kind: 'identity'; deviceId: string}
  | {kind: 'none'};

export type BushMeshOutboundDiagnostics = {
  protocolVersion: number;
  packetType: number;
  messageId: number;
  protected: boolean;
  fragmented?: boolean;
  fragmentIndex?: number;
  fragmentCount?: number;
  label: string;
  transportAvailable?: boolean;
};

/**
 * Canonical BushMesh runtime result handed to radio-core or another carrier.
 * The payload is already encoded and must be treated as opaque by the radio.
 */
export type BushMeshOutboundDatagram = {
  channelIndex: number;
  dataType: number;
  payload: Uint8Array;
  transport: string;
  priority: BushMeshOutboundPriority;
  createdAtMs: number;
  expiresAtMs: number | null;
  retryIntent: BushMeshRetryIntent;
  identityAssociation: BushMeshSecurityAssociation;
  diagnostics: BushMeshOutboundDiagnostics;
};

export type BushMeshInboundLinkMetadata = {
  rssiDbm?: number;
  snrDb?: number;
  pathLength?: number;
};

export type BushMeshInboundDatagram = {
  channelIndex: number;
  dataType: number;
  payload: Uint8Array;
  receivedAtMs: number;
  transport: string;
  source: 'live' | 'background-replay';
  link?: BushMeshInboundLinkMetadata;
  sourceNodeId?: number;
  radioIdentityRef?: string | null;
  transportDeviceId?: string | null;
  diagnosticLabel?: string | null;
  securityProtected?: boolean;
};

export type BushMeshTransportAvailability = {
  transport: string;
  available: boolean;
  reason?: string;
  maxPayloadBytes?: number;
};

export interface BushMeshTransportAvailabilityPort {
  getAvailability(): BushMeshTransportAvailability;
  subscribe?(listener: (value: BushMeshTransportAvailability) => void): () => void;
}

export interface BushMeshRuntimePersistence {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

export type BushMeshTimerHandle = unknown;

export interface BushMeshRuntimeClock {
  now(): number;
  setTimeout(handler: () => void, delayMs: number): BushMeshTimerHandle;
  clearTimeout(handle: BushMeshTimerHandle): void;
}

export const systemBushMeshRuntimeClock: BushMeshRuntimeClock = {
  now: () => Date.now(),
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type BushMeshSecurityProtectionRequest = {
  plaintextWireBytes: Uint8Array;
  context: BushMeshSecurityProtocolContext;
  association: Exclude<BushMeshSecurityAssociation, {kind: 'none'}>;
  trafficClass: BushMeshSecurityTrafficClass;
};

export type BushMeshSecurityProtectionResult = {
  /** Final bytes handed to the radio adapter after Security v1 wrapping. */
  datagramPayload: Uint8Array;
  /** Opaque Security v1 protected object retained only for integration diagnostics. */
  protectedPayload: unknown;
  securityVersion?: number;
};

export type BushMeshSecurityUnprotectionRequest = {
  datagramPayload: Uint8Array;
  channelIndex: number;
  dataType: number;
  transport: string;
  receivedAtMs: number;
};

export type BushMeshSecurityUnprotectionResult = {
  plaintextWireBytes: Uint8Array;
  /** The exact AAD header used by Security v1 during verification/decryption. */
  authenticatedHeader: Uint8Array;
  protectedPayload: unknown;
  association: BushMeshSecurityAssociation;
  securityVersion?: number;
};

/**
 * Adapter implemented by the final application when Security v1 is integrated.
 * BushMesh never receives private keys or implements cryptography itself.
 */
export interface BushMeshSecurityAdapter {
  protect(
    request: BushMeshSecurityProtectionRequest,
  ): Promise<BushMeshSecurityProtectionResult>;
  unprotect(
    request: BushMeshSecurityUnprotectionRequest,
  ): Promise<BushMeshSecurityUnprotectionResult>;
}
