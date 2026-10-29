import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
} from './codec';
import {
  BushMeshControlPacket,
  decodeControlPacket,
  encodeControlPacket,
} from './controlPackets';
import {
  BushMeshConvoyStatus,
  decodeConvoyStatus,
  encodeConvoyStatus,
} from './convoy';
import {
  BushMeshNodeHello,
  BushMeshPing,
  decodeNodeHello,
  decodePing,
  encodeNodeHello,
  encodePing,
} from './discovery';
import {
  CompactLocation,
  LocationDelta,
  decodeLocationDelta,
  decodeLocationPayload,
  encodeLocationPayload,
} from './location';
import {
  BushMeshRouteAdvertisement,
  decodeRouteAdvertisement,
  encodeRouteAdvertisement,
} from './routeAdvertisement';
import {
  BushMeshRoutedPayload,
  decodeRoutedPayload,
} from './routedPayload';
import {
  BushMeshInventorySummary,
  BushMeshRangeRequest,
  BushMeshSyncFrame,
  BushMeshSyncFrameKind,
  decodeBushMeshSyncFrame,
  encodeInventorySummary,
  encodeRangeRequest,
} from './syncProtocol';
import {
  BushMeshDistress,
  BushMeshTelemetry,
  decodeDistressPayload,
  decodeTelemetryPayload,
  encodeDistressPayload,
  encodeTelemetryPayload,
} from './telemetry';
import {
  DecodedBushMeshWireMessage,
  decodeBushMeshWire,
  encodeBushMeshWire,
} from './transport';

export type BushMeshTypedPacket =
  | {kind: 'distress'; wire: DecodedBushMeshWireMessage; value: BushMeshDistress}
  | {kind: 'location'; wire: DecodedBushMeshWireMessage; value: CompactLocation}
  | {kind: 'location-delta'; wire: DecodedBushMeshWireMessage; value: LocationDelta}
  | {kind: 'telemetry'; wire: DecodedBushMeshWireMessage; value: BushMeshTelemetry}
  | {kind: 'device-info'; wire: DecodedBushMeshWireMessage; value: BushMeshNodeHello}
  | {kind: 'ping'; wire: DecodedBushMeshWireMessage; value: BushMeshPing}
  | {
      kind: 'route';
      wire: DecodedBushMeshWireMessage;
      value: BushMeshRouteAdvertisement;
    }
  | {kind: 'routed'; wire: DecodedBushMeshWireMessage; value: BushMeshRoutedPayload}
  | {kind: 'command'; wire: DecodedBushMeshWireMessage; value: BushMeshControlPacket}
  | {kind: 'sync'; wire: DecodedBushMeshWireMessage; value: BushMeshSyncFrame}
  | {kind: 'convoy'; wire: DecodedBushMeshWireMessage; value: BushMeshConvoyStatus}
  | {kind: 'file'; wire: DecodedBushMeshWireMessage; value: number[]}
  | {kind: 'other'; wire: DecodedBushMeshWireMessage; value: number[]};

export function encodeBushMeshDistressWire(
  distress: BushMeshDistress,
  messageId: number,
  options?: {ttlHops?: number},
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Distress,
    priority: BushMeshPriority.Emergency,
    compression: BushMeshCompressionProfile.Raw,
    messageId,
    ackRequested: true,
    storeAndForward: true,
    ttlHops: options?.ttlHops ?? 6,
    payload: encodeDistressPayload(distress),
  });
}

export function encodeBushMeshLocationWire(
  location: CompactLocation,
  messageId: number,
  options?: {ackRequested?: boolean},
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Location,
    priority: BushMeshPriority.Location,
    compression: BushMeshCompressionProfile.Gps,
    messageId,
    ackRequested: options?.ackRequested ?? false,
    payload: encodeLocationPayload(location),
  });
}

export function encodeBushMeshTelemetryWire(
  telemetry: BushMeshTelemetry,
  messageId: number,
  options?: {ackRequested?: boolean},
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Telemetry,
    priority: BushMeshPriority.Telemetry,
    compression: BushMeshCompressionProfile.Raw,
    messageId,
    ackRequested: options?.ackRequested ?? false,
    payload: encodeTelemetryPayload(telemetry),
  });
}

export function encodeBushMeshNodeHelloWire(
  hello: BushMeshNodeHello,
  messageId: number,
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.DeviceInfo,
    priority: BushMeshPriority.Background,
    compression: BushMeshCompressionProfile.Raw,
    messageId,
    ackRequested: false,
    payload: encodeNodeHello(hello),
  });
}

export function encodeBushMeshPingWire(
  ping: BushMeshPing,
  messageId: number,
  ackRequested = true,
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Ping,
    priority: BushMeshPriority.DirectMessage,
    compression: BushMeshCompressionProfile.Raw,
    messageId,
    ackRequested,
    payload: encodePing(ping),
  });
}

export function encodeBushMeshRouteWire(
  advertisement: BushMeshRouteAdvertisement,
  messageId: number,
  options?: {ttlHops?: number},
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Route,
    priority: BushMeshPriority.Background,
    compression: BushMeshCompressionProfile.Raw,
    messageId,
    ackRequested: false,
    storeAndForward: true,
    ttlHops: options?.ttlHops ?? 3,
    payload: encodeRouteAdvertisement(advertisement),
  });
}

export function encodeBushMeshControlWire(
  control: BushMeshControlPacket,
  messageId: number,
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Command,
    priority: BushMeshPriority.DirectMessage,
    compression: BushMeshCompressionProfile.Command,
    messageId,
    ackRequested: true,
    payload: encodeControlPacket(control),
  });
}

export function encodeBushMeshSyncWire(
  frame: BushMeshSyncFrame,
  messageId: number,
): number[] {
  const payload =
    frame.kind === BushMeshSyncFrameKind.Summary
      ? encodeInventorySummary(frame as BushMeshInventorySummary)
      : encodeRangeRequest(frame as BushMeshRangeRequest);

  return encodeBushMeshWire({
    type: BushMeshPacketType.Sync,
    priority: BushMeshPriority.Background,
    compression: BushMeshCompressionProfile.Raw,
    messageId,
    ackRequested: frame.kind === BushMeshSyncFrameKind.RequestRanges,
    payload,
  });
}

export function encodeBushMeshConvoyWire(
  status: BushMeshConvoyStatus,
  messageId: number,
  options?: {ackRequested?: boolean},
): number[] {
  const hazard = status.hazard === true;

  return encodeBushMeshWire({
    type: BushMeshPacketType.Convoy,
    priority: hazard
      ? BushMeshPriority.Emergency
      : BushMeshPriority.Location,
    compression: BushMeshCompressionProfile.Raw,
    messageId,
    // A hazard status should request confirmation where the current transport
    // can provide it; routine heartbeats stay acknowledgement-free.
    ackRequested: options?.ackRequested ?? hazard,
    payload: encodeConvoyStatus(status),
  });
}

export function encodeBushMeshFileWire(
  fileFrame: number[],
  messageId: number,
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.File,
    priority: BushMeshPriority.Background,
    compression: BushMeshCompressionProfile.Raw,
    messageId,
    ackRequested: true,
    payload: fileFrame,
  });
}

export function decodeBushMeshTypedPacket(bytes: number[]): BushMeshTypedPacket {
  const wire = decodeBushMeshWire(bytes);

  switch (wire.envelope.type) {
    case BushMeshPacketType.Distress:
      return {
        kind: 'distress',
        wire,
        value: decodeDistressPayload(wire.envelope.payload),
      };
    case BushMeshPacketType.Location: {
      if (wire.envelope.compression === BushMeshCompressionProfile.SensorDelta) {
        return {
          kind: 'location-delta',
          wire,
          value: decodeLocationDelta(wire.envelope.payload),
        };
      }

      if (wire.envelope.compression !== BushMeshCompressionProfile.Gps) {
        throw new Error(
          `Unsupported BushMesh LOCATION compression profile ${wire.envelope.compression}.`,
        );
      }

      const decoded = decodeLocationPayload(wire.envelope.payload);
      return {
        kind: 'location',
        wire,
        value: {
          latitude: decoded.latitude,
          longitude: decoded.longitude,
          precision: decoded.precision,
          batteryPercent: decoded.batteryPercent ?? undefined,
        },
      };
    }
    case BushMeshPacketType.Telemetry:
      return {
        kind: 'telemetry',
        wire,
        value: decodeTelemetryPayload(wire.envelope.payload),
      };
    case BushMeshPacketType.DeviceInfo:
      return {
        kind: 'device-info',
        wire,
        value: decodeNodeHello(wire.envelope.payload),
      };
    case BushMeshPacketType.Ping:
      return {kind: 'ping', wire, value: decodePing(wire.envelope.payload)};
    case BushMeshPacketType.Route:
      return {
        kind: 'route',
        wire,
        value: decodeRouteAdvertisement(wire.envelope.payload),
      };
    case BushMeshPacketType.Routed:
      return {
        kind: 'routed',
        wire,
        value: decodeRoutedPayload(wire.envelope.payload),
      };
    case BushMeshPacketType.Command:
      return {
        kind: 'command',
        wire,
        value: decodeControlPacket(wire.envelope.payload),
      };
    case BushMeshPacketType.Sync:
      return {
        kind: 'sync',
        wire,
        value: decodeBushMeshSyncFrame(wire.envelope.payload),
      };
    case BushMeshPacketType.Convoy:
      return {
        kind: 'convoy',
        wire,
        value: decodeConvoyStatus(wire.envelope.payload),
      };
    case BushMeshPacketType.File:
      return {kind: 'file', wire, value: [...wire.envelope.payload]};
    default:
      return {kind: 'other', wire, value: [...wire.envelope.payload]};
  }
}
