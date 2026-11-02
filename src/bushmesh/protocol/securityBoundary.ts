import {Buffer} from 'buffer';

import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
  assertIntegerInRange,
  encodeVarUint,
} from './codec';
import {
  BUSHMESH_SECURITY_MAX_IDENTIFIER_BYTES,
  BushMeshSecurityContainerKind,
  BushMeshSecurityRoutingContext,
} from './securityWire';
import {decodeBushMeshWire} from './transport';

/** Domain separator + schema version for BushMesh protocol AAD. */
export const BUSHMESH_AUTHENTICATED_HEADER_PREFIX = [
  0x42, // B
  0x4d, // M
  0x41, // A
  0x01, // authenticated-header schema v1
] as const;

const AAD_ROUTING_SOURCE = 0x01;
const AAD_ROUTING_DESTINATION = 0x02;
const AAD_ROUTING_GROUP = 0x04;

export type BushMeshAuthenticatedHeaderFields = {
  protocolVersion: number;
  packetType: number;
  priority: number;
  compression: number;
  messageId: number;
  ackRequested: boolean;
  storeAndForward: boolean;
};

export type BushMeshSecurityProtocolContext = {
  protocolVersion: number;
  authenticatedHeader: Uint8Array;
};

function encodeRoutingForAad(routing: BushMeshSecurityRoutingContext): number[] {
  let flags = 0;
  if (routing.sourceNodeId !== undefined) {
    assertIntegerInRange(routing.sourceNodeId, 0, 0xffffffff, 'AAD source node ID');
    flags |= AAD_ROUTING_SOURCE;
  }
  if (routing.destinationNodeId !== undefined) {
    assertIntegerInRange(
      routing.destinationNodeId,
      0,
      0xffffffff,
      'AAD destination node ID',
    );
    flags |= AAD_ROUTING_DESTINATION;
  }

  let groupBytes: number[] = [];
  if (routing.groupId !== undefined) {
    if (!routing.groupId) {
      throw new Error('AAD group ID cannot be empty.');
    }
    groupBytes = Array.from(Buffer.from(routing.groupId, 'utf8'));
    if (groupBytes.length > BUSHMESH_SECURITY_MAX_IDENTIFIER_BYTES) {
      throw new Error('AAD group ID exceeds the BushMesh v1 size limit.');
    }
    flags |= AAD_ROUTING_GROUP;
  }

  return [
    flags,
    ...(routing.sourceNodeId === undefined
      ? []
      : encodeVarUint(routing.sourceNodeId)),
    ...(routing.destinationNodeId === undefined
      ? []
      : encodeVarUint(routing.destinationNodeId)),
    ...(routing.groupId === undefined
      ? []
      : [...encodeVarUint(groupBytes.length), ...groupBytes]),
  ];
}

/**
 * Canonical immutable BushMesh header authenticated by Security v1.
 *
 * AAD v1 binds the logical router-visible source/destination/group selector
 * whenever one exists. TTL, hop/path state, next-hop state, RSSI/SNR, transport
 * retry state and arrival timestamps are deliberately excluded because valid
 * forwarding changes them after end-to-end protection is applied.
 */
export function encodeBushMeshAuthenticatedHeader(
  fields: BushMeshAuthenticatedHeaderFields,
  routing: BushMeshSecurityRoutingContext = {},
): number[] {
  assertIntegerInRange(fields.protocolVersion, 0, 3, 'Protocol version');
  assertIntegerInRange(fields.packetType, 0, 0x3f, 'Packet type');
  assertIntegerInRange(fields.priority, 0, 7, 'Priority');
  assertIntegerInRange(fields.compression, 0, 7, 'Compression profile');
  assertIntegerInRange(fields.messageId, 0, 0xffffffff, 'Message ID');

  const first = (fields.protocolVersion << 6) | fields.packetType;
  const second =
    (fields.priority << 5) |
    (fields.compression << 2) |
    (fields.ackRequested ? 0x02 : 0) |
    (fields.storeAndForward ? 0x01 : 0);

  return [
    ...BUSHMESH_AUTHENTICATED_HEADER_PREFIX,
    first,
    second,
    ...encodeVarUint(fields.messageId),
    ...encodeRoutingForAad(routing),
  ];
}

export function getBushMeshAuthenticatedHeaderFields(
  wireBytes: number[],
): BushMeshAuthenticatedHeaderFields {
  const decoded = decodeBushMeshWire(wireBytes);
  const {envelope} = decoded;
  return {
    protocolVersion: envelope.version,
    packetType: envelope.type,
    priority: envelope.priority,
    compression: envelope.compression,
    messageId: envelope.messageId,
    ackRequested: envelope.ackRequested,
    storeAndForward: envelope.storeAndForward,
  };
}

export function createBushMeshSecurityProtocolContext(
  wireBytes: number[],
  routing: BushMeshSecurityRoutingContext = {},
): BushMeshSecurityProtocolContext {
  const fields = getBushMeshAuthenticatedHeaderFields(wireBytes);
  return {
    protocolVersion: fields.protocolVersion,
    authenticatedHeader: Uint8Array.from(
      encodeBushMeshAuthenticatedHeader(fields, routing),
    ),
  };
}

export function bushMeshAuthenticatedHeadersEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

export type BushMeshSecurityTrafficClass =
  | 'direct-message'
  | 'group-message'
  | 'convoy-group'
  | 'pairing-session-establishment'
  | 'group-key-distribution'
  | 'identity-rotation'
  | 'peer-revocation'
  | 'emergency-distress';

export type BushMeshEmergencySecurityPolicy =
  | 'require-authentication'
  | 'allow-unauthenticated-fallback';

export type BushMeshSecurityRequirement =
  | 'required-direct-session'
  | 'required-group'
  | 'security-control-container'
  | 'policy-dependent'
  | 'local-only';

export type BushMeshSecurityTreatment = {
  trafficClass: BushMeshSecurityTrafficClass;
  packetType: number | null;
  containerKind?: number | null;
  requirement: BushMeshSecurityRequirement;
  rationale: string;
};

/**
 * Frozen Security treatment table for BushMesh Protocol v1.
 *
 * Security control objects use the dedicated B5 53 container rather than
 * consuming ordinary BushMesh packet IDs. Peer revocation remains local-only in
 * Security v1; there is deliberately no unauthenticated network revocation
 * command or session-retirement authority object in Protocol v1.
 */
export const BUSHMESH_SECURITY_TREATMENTS: readonly BushMeshSecurityTreatment[] = [
  {
    trafficClass: 'direct-message',
    packetType: BushMeshPacketType.Message,
    containerKind: BushMeshSecurityContainerKind.ProtectedDirect,
    requirement: 'required-direct-session',
    rationale:
      'Private peer-to-peer traffic requires a trusted direct session and an authenticated source/destination routing selector.',
  },
  {
    trafficClass: 'group-message',
    packetType: BushMeshPacketType.Message,
    containerKind: BushMeshSecurityContainerKind.ProtectedGroup,
    requirement: 'required-group',
    rationale:
      'Private group/channel traffic requires the active group security context and authenticated group routing selector.',
  },
  {
    trafficClass: 'convoy-group',
    packetType: BushMeshPacketType.Convoy,
    containerKind: BushMeshSecurityContainerKind.ProtectedGroup,
    requirement: 'required-group',
    rationale:
      'Convoy operational traffic is group-scoped and authenticates both protocol semantics and router-visible group identity.',
  },
  {
    trafficClass: 'pairing-session-establishment',
    packetType: null,
    containerKind: null,
    requirement: 'security-control-container',
    rationale:
      'PairingProof, SessionOffer and SessionResponse use dedicated frozen Security v1 control-container kinds.',
  },
  {
    trafficClass: 'group-key-distribution',
    packetType: null,
    containerKind: BushMeshSecurityContainerKind.WrappedGroupKeyDistribution,
    requirement: 'security-control-container',
    rationale:
      'WrappedGroupKeyDistribution is transported as its dedicated Security v1 control container.',
  },
  {
    trafficClass: 'identity-rotation',
    packetType: null,
    containerKind: BushMeshSecurityContainerKind.IdentityRotationProof,
    requirement: 'security-control-container',
    rationale:
      'IdentityRotationProof is transported verbatim through its dedicated signed Security v1 control container.',
  },
  {
    trafficClass: 'peer-revocation',
    packetType: null,
    containerKind: null,
    requirement: 'local-only',
    rationale:
      'Security v1 defines revocation/session retirement as local trust/session state. Protocol v1 does not accept a network revocation authority message.',
  },
  {
    trafficClass: 'emergency-distress',
    packetType: BushMeshPacketType.Distress,
    containerKind: null,
    requirement: 'policy-dependent',
    rationale:
      'Authenticate distress when a direct/group context is available. Unauthenticated fallback is forbidden by default and requires explicit product policy.',
  },
] as const;

export function securityTreatmentFor(
  trafficClass: BushMeshSecurityTrafficClass,
): BushMeshSecurityTreatment {
  const treatment = BUSHMESH_SECURITY_TREATMENTS.find(
    value => value.trafficClass === trafficClass,
  );
  if (!treatment) {
    throw new Error(`Unknown BushMesh security traffic class ${trafficClass}.`);
  }
  return treatment;
}

/** Convenience defaults used by integration code when constructing messages. */
export const BUSHMESH_SECURITY_DEFAULTS = {
  directMessage: {
    packetType: BushMeshPacketType.Message,
    priority: BushMeshPriority.DirectMessage,
    compression: BushMeshCompressionProfile.Raw,
  },
  convoyGroup: {
    packetType: BushMeshPacketType.Convoy,
    priority: BushMeshPriority.Location,
    compression: BushMeshCompressionProfile.Raw,
  },
  emergencyPolicy: 'require-authentication' as BushMeshEmergencySecurityPolicy,
} as const;
