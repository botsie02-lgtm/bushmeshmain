/**
 * Stable BushMesh protocol facade.
 *
 * Keep this surface intentionally small. Application/radio adapters should not
 * depend on implementation helpers such as schedulers, persistence, MeshCore
 * carriers, debug tooling or experimental codecs.
 */
export {
  BUSHMESH_PROTOCOL_VERSION,
  BushMeshCompressionProfile,
  BushMeshPriority,
  decodeEnvelope,
  encodeEnvelope,
} from './codec';
export type {BushMeshEnvelope, DecodedBushMeshEnvelope} from './codec';

export {
  BUSHMESH_PACKET_DEFINITIONS,
  BushMeshPacketType,
  getBushMeshPacketDefinition,
  isBushMeshCorePacketType,
} from './packetTypes';
export type {
  BushMeshPacketDefinition,
  BushMeshPacketStability,
} from './packetTypes';

export {
  BUSHMESH_MAX_ENVELOPE_PROTOCOL_VERSION,
  BUSHMESH_MAX_SUPPORTED_PROTOCOL_VERSION,
  BUSHMESH_MIN_SUPPORTED_PROTOCOL_VERSION,
  BushMeshPacketTypeClass,
  assertBushMeshEnvelopeCompatibility,
  classifyBushMeshPacketType,
  negotiateBushMeshProtocolRanges,
  negotiateBushMeshProtocolVersion,
} from './versioning';
export type {BushMeshProtocolCompatibility} from './versioning';

export {
  BUSHMESH_DEFAULT_CAPABILITIES,
  BushMeshCapability,
  BushMeshNodeRole,
  decodeNodeHello,
  encodeNodeHello,
  hasBushMeshCapability,
  negotiateBushMeshCapabilities,
} from './discovery';
export type {BushMeshNodeHello, BushMeshPing} from './discovery';

export {
  assertBushMeshPeerPolicyNotDowngraded,
  encodeTextForBushMeshPeer,
  evaluateBushMeshPeerPolicyDowngrade,
  negotiateBushMeshPeerPolicy,
} from './capabilityPolicy';
export type {
  BushMeshCapabilityDowngrade,
  BushMeshPeerPolicy,
  BushMeshPeerPolicyOptions,
} from './capabilityPolicy';

export {
  BUSHMESH_TEXT_CARRIER_PREFIX,
  BUSHMESH_WIRE_MAGIC,
  decodeBushMeshTextCarrier,
  decodeBushMeshWire,
  encodeBushMeshTextCarrier,
  encodeBushMeshTextMessage,
  encodeBushMeshWire,
} from './transport';
export type {
  DecodedBushMeshWireMessage,
  EncodedBushMeshTextMessage,
} from './transport';

export {
  decodeBushMeshTypedPacket,
  encodeBushMeshControlWire,
  encodeBushMeshConvoyWire,
  encodeBushMeshDistressWire,
  encodeBushMeshFileWire,
  encodeBushMeshLocationWire,
  encodeBushMeshNodeHelloWire,
  encodeBushMeshPingWire,
  encodeBushMeshRouteWire,
  encodeBushMeshSyncWire,
  encodeBushMeshTelemetryWire,
} from './typedPackets';
export type {BushMeshTypedPacket} from './typedPackets';

export {
  BUSHMESH_AUTHENTICATED_HEADER_PREFIX,
  BUSHMESH_SECURITY_DEFAULTS,
  BUSHMESH_SECURITY_TREATMENTS,
  bushMeshAuthenticatedHeadersEqual,
  createBushMeshSecurityProtocolContext,
  encodeBushMeshAuthenticatedHeader,
  getBushMeshAuthenticatedHeaderFields,
  securityTreatmentFor,
} from './securityBoundary';
export type {
  BushMeshAuthenticatedHeaderFields,
  BushMeshSecurityProtocolContext,
  BushMeshSecurityRequirement,
  BushMeshSecurityTrafficClass,
  BushMeshSecurityTreatment,
} from './securityBoundary';

// Stable payload object types referenced by the typed wire helpers above.
export type {CompactLocation, LocationDelta} from './location';
export type {BushMeshDistress, BushMeshTelemetry} from './telemetry';
export {BushMeshDistressType} from './telemetry';
export type {BushMeshConvoyStatus} from './convoy';
export type {BushMeshControlPacket} from './controlPackets';
export {BushMeshControlCommand} from './controlPackets';
export type {BushMeshRouteAdvertisement} from './routeAdvertisement';
export type {BushMeshRoutedPayload} from './routedPayload';
export type {
  BushMeshInventorySummary,
  BushMeshRangeRequest,
  BushMeshSyncFrame,
  BushMeshSyncRange,
} from './syncProtocol';
export {BushMeshSyncFrameKind, BushMeshSyncNamespace} from './syncProtocol';
