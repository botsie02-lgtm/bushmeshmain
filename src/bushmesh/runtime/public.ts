/**
 * Stable app-facing BushMesh runtime facade.
 *
 * The canonical integration boundary is datagram-based and transport-neutral.
 * Stateful subsystem engines remain available internally/through the legacy
 * runtime barrel, but are intentionally not part of this long-lived facade.
 */
export {BushMeshDatagramRuntime} from './BushMeshDatagramRuntime';
export type {
  BushMeshDatagramRuntimeOptions,
  BushMeshInboundAccepted,
  BushMeshInboundDuplicate,
  BushMeshInboundFragmentPending,
  BushMeshInboundProtocolAccepted,
  BushMeshInboundRejected,
  BushMeshInboundResult,
  BushMeshInboundSecurityControlAccepted,
  BushMeshOutboundPreparationOptions,
  BushMeshSecurityControlOutboundOptions,
} from './BushMeshDatagramRuntime';

export {systemBushMeshRuntimeClock} from './integration';
export type {
  BushMeshEmergencySecurityOptions,
  BushMeshInboundDatagram,
  BushMeshInboundLinkMetadata,
  BushMeshOutboundDatagram,
  BushMeshOutboundDiagnostics,
  BushMeshOutboundPriority,
  BushMeshRetryIntent,
  BushMeshRuntimeClock,
  BushMeshRuntimePersistence,
  BushMeshSecurityAdapter,
  BushMeshSecurityAssociation,
  BushMeshSecurityProtectionRequest,
  BushMeshSecurityProtectionResult,
  BushMeshSecurityUnprotectionRequest,
  BushMeshSecurityUnprotectionResult,
  BushMeshTimerHandle,
  BushMeshTransportAvailability,
  BushMeshTransportAvailabilityPort,
} from './integration';
