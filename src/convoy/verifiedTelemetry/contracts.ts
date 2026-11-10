import type {BushMeshConvoyRole} from '../../bushmesh/protocol/convoy';
import type {BushMeshOutboundPreparationOptions} from '../../bushmesh/runtime/public';
import type {BushMeshLocationFix} from '../../location/positionPlanner';
import type {ConvoyMapMember} from '../../maps/convoyMapModel';

/**
 * Security-owned, current and independently verified roster + logical-node
 * bindings. This is NOT a deserializable credential, a MeshCore contact list,
 * a GroupRecord alone, or a view of pending invitations.
 *
 * Production resolver MUST check current protected group key, local active
 * selection, every active member's pinned fingerprint/trust, and an authenticated
 * nodeId -> deviceId mapping. Protocol v1/Security v1 cannot presently derive
 * the last mapping themselves; no production implementation is provided here.
 */
export type VerifiedTelemetryMember = {
  deviceId: string;
  fingerprint: string;
  nodeId: number;
  label: string;
  orderIndex: number;
  role: BushMeshConvoyRole | number;
  state: 'active' | 'revoked';
};

export type VerifiedTelemetryRoster = {
  verifiedBy: 'security-group-and-node-bindings';
  convoyId: string;
  protocolConvoyId: number;
  securityGroupId: string;
  currentEpoch: number;
  localDeviceId: string;
  localFingerprint: string;
  localNodeId: number;
  /** Changes when trust, membership, identity, authority or group epoch changes. */
  revision: string;
  members: readonly VerifiedTelemetryMember[];
};

export interface VerifiedTelemetryAuthority {
  /** Must query the current trusted Security/group/active-convoy state on EVERY call. */
  resolveActiveRoster(): Promise<VerifiedTelemetryRoster | null>;
  /** Mandatory immediate purge signal for revocation, epoch and identity changes. */
  subscribeInvalidations(listener: () => void): () => void;
}

/** The canonical runtime service already implements this; no radio send engine. */
export interface ProtectedConvoyRuntimePort {
  prepareAndQueue(
    wireBytes: number[] | Uint8Array,
    options: BushMeshOutboundPreparationOptions,
  ): Promise<unknown>;
}

/**
 * Mandatory production monotonic, crash-durable allocation, scoped to the
 * current device and protocol. A test counter is not production-safe.
 * Sequence and messageId MUST be unique across app/process restarts.
 */
export interface TelemetrySequencePort {
  next(groupId: string, deviceId: string): Promise<{
    sequence: number;
    messageId: number;
  }>;
}

/** Must include duty-cycle/airtime reservations and the protected-frame overhead. */
export interface TelemetryAirtimePort {
  allowProtectedPosition(input: {
    transport: string;
    plainBytes: number;
    nowMs: number;
  }): Promise<boolean>;
}

export type TelemetryCarrierTarget = {
  channelIndex: number;
  dataType: number;
  transport: string;
};

/** Caller must use LocationSessionProvider's genuine android-gps source. */
export type AndroidTelemetryFix = {
  providerId: 'android-gps';
  fix: BushMeshLocationFix | null;
};

export type VerifiedMemberPresence =
  | 'missing-position'
  | 'live'
  | 'recent'
  | 'stale'
  | 'disconnected';

export type VerifiedTelemetryMemberView = {
  deviceId: string;
  fingerprint: string;
  nodeId: number;
  label: string;
  presence: VerifiedMemberPresence;
  /** Null if no trusted current fix, invalidated, or retention elapsed. */
  position: ConvoyMapMember['position'];
  lastAuthenticatedAtMs: number | null;
};

export type VerifiedTelemetryProjection = {
  convoyId: string;
  securityGroupId: string;
  currentEpoch: number;
  generatedAtMs: number;
  members: readonly VerifiedTelemetryMemberView[];
  /** Only current roster members, never contacts or unverified radio traffic. */
  mapMembers: readonly ConvoyMapMember[];
};

export type PositionPublishResult =
  | {status: 'suppressed'; reason: string}
  | {status: 'queued-locally'; messageId: number; sequence: number};

/**
 * Optional secure and INTEGRITY-PROTECTED private checkpoint store. It cannot
 * authorize members or replace Security v1 replay persistence.
 */
export interface ProtectedTelemetryCheckpointStore {
  load(): Promise<unknown>;
  save(snapshot: unknown): Promise<void>;
  clear(): Promise<void>;
  isDurableAndProtected(): boolean;
}
