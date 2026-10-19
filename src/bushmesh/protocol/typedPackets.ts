import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
} from './codec';
import {
  BushMeshNodeHello,
  BushMeshPing,
  decodeNodeHello,
  decodePing,
  encodeNodeHello,
  encodePing,
} from './discovery';
import {
  BushMeshRouteAdvertisement,
  decodeRouteAdvertisement,
  encodeRouteAdvertisement,
} from './routeAdvertisement';
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
  | {kind: 'telemetry'; wire: DecodedBushMeshWireMessage; value: BushMeshTelemetry}
  | {kind: 'device-info'; wire: DecodedBushMeshWireMessage; value: BushMeshNodeHello}
  | {kind: 'ping'; wire: DecodedBushMeshWireMessage; value: BushMeshPing}
  | {
      kind: 'route';
      wire: DecodedBushMeshWireMessage;
      value: BushMeshRouteAdvertisement;
    }
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

export function encodeBushMeshTelemetryWire(
  telemetry: BushMeshTelemetry,
  messageId: number,
  options?: {ackRequested?: boolean},
): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Battery,
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
    case BushMeshPacketType.Battery:
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
    case BushMeshPacketType.File:
      return {kind: 'file', wire, value: [...wire.envelope.payload]};
    default:
      return {kind: 'other', wire, value: [...wire.envelope.payload]};
  }
}
