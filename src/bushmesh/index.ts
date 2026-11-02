/**
 * Canonical BushMesh application integration facade.
 *
 * App code should normally need only this file. Advanced protocol/firmware work
 * can use `protocol/public`; transport-neutral runtime work can use
 * `runtime/public`. MeshCore and radio-core types are deliberately absent.
 */
import * as BushMeshProtocol from './protocol/public';
import * as BushMeshRuntime from './runtime/public';

export {
  BUSHMESH_PROTOCOL_VERSION,
  BushMeshPacketType,
  BushMeshPriority,
  createBushMeshSecurityProtocolContext,
} from './protocol/public';
export type {
  BushMeshEmergencySecurityPolicy,
  BushMeshPeerPolicy,
  BushMeshSecurityProtocolContext,
  BushMeshSecurityRoutingContext,
  BushMeshSecurityTrafficClass,
  BushMeshTypedPacket,
  DecodedBushMeshWireMessage,
} from './protocol/public';

export {
  BushMeshDatagramRuntime,
  systemBushMeshRuntimeClock,
} from './runtime/public';
export type {
  BushMeshInboundDatagram,
  BushMeshInboundResult,
  BushMeshOutboundDatagram,
  BushMeshOutboundPreparationOptions,
  BushMeshRetryIntent,
  BushMeshRuntimeClock,
  BushMeshRuntimePersistence,
  BushMeshSecurityAdapter,
  BushMeshSecurityAssociation,
  BushMeshSecurityControlOutboundOptions,
  BushMeshTransportAvailability,
  BushMeshTransportAvailabilityPort,
} from './runtime/public';

export {BushMeshProtocol, BushMeshRuntime};
