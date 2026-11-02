import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
  assertIntegerInRange,
  encodeVarUint,
} from './codec';
import {decodeBushMeshWire} from './transport';

/** Domain separator + schema version for BushMesh protocol AAD. */
export const BUSHMESH_AUTHENTICATED_HEADER_PREFIX = [
  0x42, // B
  0x4d, // M
  0x41, // A
  0x01, // authenticated-header schema v1
] as const;

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

/**
 * Canonical immutable BushMesh header authenticated by Security v1.
 *
 * TTL/path counters are intentionally excluded because forwarding may mutate
 * them. The fields encoded here must remain byte-for-byte stable end to end.
 */
export function encodeBushMeshAuthenticatedHeader(
  fields: BushMeshAuthenticatedHeaderFields,
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
): BushMeshSecurityProtocolContext {
  const fields = getBushMeshAuthenticatedHeaderFields(wireBytes);
  return {
    protocolVersion: fields.protocolVersion,
    authenticatedHeader: Uint8Array.from(
      encodeBushMeshAuthenticatedHeader(fields),
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
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
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

export type BushMeshSecurityRequirement =
  | 'required-direct-session'
  | 'required-group'
  | 'policy-dependent'
  | 'unassigned-v1-control-schema';

export type BushMeshSecurityTreatment = {
  trafficClass: BushMeshSecurityTrafficClass;
  packetType: number | null;
  requirement: BushMeshSecurityRequirement;
  rationale: string;
};

/**
 * Security treatment audit for protocol-v1 integration.
 *
 * The null packet types are deliberate: Security v1 objects exist, but their
 * BushMesh transport packet/container schema has not yet been frozen. They
 * must not be smuggled through Command, DeviceInfo or another unrelated packet.
 */
export const BUSHMESH_SECURITY_TREATMENTS: readonly BushMeshSecurityTreatment[] = [
  {
    trafficClass: 'direct-message',
    packetType: BushMeshPacketType.Message,
    requirement: 'required-direct-session',
    rationale: 'Private peer-to-peer traffic is protected by a trusted direct session.',
  },
  {
    trafficClass: 'group-message',
    packetType: BushMeshPacketType.Message,
    requirement: 'required-group',
    rationale: 'Private group/channel message traffic uses the active group security context.',
  },
  {
    trafficClass: 'convoy-group',
    packetType: BushMeshPacketType.Convoy,
    requirement: 'required-group',
    rationale: 'Convoy operational traffic is group-scoped and should authenticate membership.',
  },
  {
    trafficClass: 'pairing-session-establishment',
    packetType: null,
    requirement: 'unassigned-v1-control-schema',
    rationale: 'Pairing proofs and session offers/responses are owned by Security v1; BushMesh framing is not frozen yet.',
  },
  {
    trafficClass: 'group-key-distribution',
    packetType: null,
    requirement: 'unassigned-v1-control-schema',
    rationale: 'Authenticated wrapped group-key distribution needs a dedicated frozen transport schema.',
  },
  {
    trafficClass: 'identity-rotation',
    packetType: null,
    requirement: 'unassigned-v1-control-schema',
    rationale: 'Identity rotation proofs must not reuse general Command packets without a frozen schema.',
  },
  {
    trafficClass: 'peer-revocation',
    packetType: null,
    requirement: 'unassigned-v1-control-schema',
    rationale: 'Revocation/session retirement signalling requires a dedicated authenticated control schema.',
  },
  {
    trafficClass: 'emergency-distress',
    packetType: BushMeshPacketType.Distress,
    requirement: 'policy-dependent',
    rationale: 'Emergency traffic should authenticate when security context exists, while the unauthenticated fallback policy remains a product/safety decision.',
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
} as const;
