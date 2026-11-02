import type {
  BushMeshInboundDatagram,
  BushMeshOutboundDatagram,
} from '../bushmesh/runtime/public';
import type {OutboundDatagramEnvelope} from '../radio/OutboundDatagram';
import type {ReceivedDatagram} from '../radio/ReceivedDatagram';

/** Preserve radio-core transport metadata while handing opaque bytes upward. */
export function receivedDatagramToBushMeshInbound(
  datagram: ReceivedDatagram,
): BushMeshInboundDatagram {
  return {
    channelIndex: datagram.channelIndex,
    dataType: datagram.dataType,
    payload: Uint8Array.from(datagram.payload),
    receivedAtMs: datagram.receivedAtMs,
    transport: datagram.transport,
    source: datagram.source,
    link: datagram.link ? {...datagram.link} : undefined,
    radioIdentityRef: datagram.radioIdentityRef,
    transportDeviceId: datagram.transportDeviceId,
    diagnosticLabel: datagram.diagnosticLabel,
  };
}

function canonicalOpaqueMetadata(
  datagram: BushMeshOutboundDatagram,
): Readonly<Record<string, string>> {
  return {
    'bushmesh.retryIntent': JSON.stringify(datagram.retryIntent),
    'bushmesh.identityAssociation': JSON.stringify(datagram.identityAssociation),
    'bushmesh.diagnostics': JSON.stringify(datagram.diagnostics),
  };
}

/**
 * Map a canonical already-encoded datagram into the radio-core queue contract.
 * Protocol-managed reliability is intentionally one carrier attempt; only the
 * canonical transport-retry intent may request more carrier attempts.
 * Canonical association/diagnostic data is carried as opaque metadata and is
 * never interpreted by radio-core.
 */
export function bushMeshOutboundToRadioEnvelope(
  datagram: BushMeshOutboundDatagram,
  radioIdentityRef: string | null,
): OutboundDatagramEnvelope {
  return {
    channelIndex: datagram.channelIndex,
    dataType: datagram.dataType,
    payload: Uint8Array.from(datagram.payload),
    priority: datagram.priority,
    expiresAtMs: datagram.expiresAtMs,
    retryPolicy: {
      maxAttempts: datagram.retryIntent.maxTransportAttempts,
    },
    identityRef: radioIdentityRef,
    description: datagram.diagnostics.label,
    createdAtMs: datagram.createdAtMs,
    transport: datagram.transport,
    opaqueMetadata: canonicalOpaqueMetadata(datagram),
  };
}
