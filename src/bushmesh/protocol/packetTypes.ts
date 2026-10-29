export const BushMeshPacketType = {
  Message: 0x01,
  Location: 0x02,
  Distress: 0x03,
  Weather: 0x04,
  Telemetry: 0x05,
  /** @deprecated Use Telemetry. Kept as a v1 source-compatible alias. */
  Battery: 0x05,
  DeviceInfo: 0x06,
  Ping: 0x07,
  Route: 0x08,
  File: 0x09,
  Command: 0x0a,
  Fragment: 0x0b,
  Ack: 0x0c,
  Sync: 0x0d,
  Routed: 0x0e,
  Convoy: 0x0f,
} as const;

export type BushMeshPacketType =
  (typeof BushMeshPacketType)[keyof typeof BushMeshPacketType];

export type BushMeshPacketStability = 'core' | 'reserved-core';

export type BushMeshPacketDefinition = {
  type: BushMeshPacketType;
  name: string;
  introducedInVersion: number;
  stability: BushMeshPacketStability;
  description: string;
};

/**
 * Authoritative v1 packet allocation table.
 *
 * Add new standardized packet IDs here first. Codecs, compatibility checks and
 * typed packet dispatch should consume this registry instead of maintaining
 * independent packet-range assumptions.
 */
export const BUSHMESH_PACKET_DEFINITIONS: readonly BushMeshPacketDefinition[] = [
  {type: BushMeshPacketType.Message, name: 'message', introducedInVersion: 1, stability: 'core', description: 'User text or semantic message.'},
  {type: BushMeshPacketType.Location, name: 'location', introducedInVersion: 1, stability: 'core', description: 'Absolute or delta location update.'},
  {type: BushMeshPacketType.Distress, name: 'distress', introducedInVersion: 1, stability: 'core', description: 'Emergency/distress report.'},
  {type: BushMeshPacketType.Weather, name: 'weather', introducedInVersion: 1, stability: 'reserved-core', description: 'Reserved v1 weather packet ID; no canonical schema is released yet.'},
  {type: BushMeshPacketType.Telemetry, name: 'telemetry', introducedInVersion: 1, stability: 'core', description: 'Compact device/vehicle telemetry.'},
  {type: BushMeshPacketType.DeviceInfo, name: 'device-info', introducedInVersion: 1, stability: 'core', description: 'Node discovery/capability advertisement.'},
  {type: BushMeshPacketType.Ping, name: 'ping', introducedInVersion: 1, stability: 'core', description: 'Ping/pong discovery exchange.'},
  {type: BushMeshPacketType.Route, name: 'route', introducedInVersion: 1, stability: 'core', description: 'Route advertisement.'},
  {type: BushMeshPacketType.File, name: 'file', introducedInVersion: 1, stability: 'core', description: 'File-transfer control/data frame.'},
  {type: BushMeshPacketType.Command, name: 'command', introducedInVersion: 1, stability: 'core', description: 'Typed control command.'},
  {type: BushMeshPacketType.Fragment, name: 'fragment', introducedInVersion: 1, stability: 'core', description: 'Application-level fragment.'},
  {type: BushMeshPacketType.Ack, name: 'ack', introducedInVersion: 1, stability: 'core', description: 'Fragment or delivery acknowledgement.'},
  {type: BushMeshPacketType.Sync, name: 'sync', introducedInVersion: 1, stability: 'core', description: 'Inventory/synchronisation frame.'},
  {type: BushMeshPacketType.Routed, name: 'routed', introducedInVersion: 1, stability: 'core', description: 'Routed BushMesh payload.'},
  {type: BushMeshPacketType.Convoy, name: 'convoy', introducedInVersion: 1, stability: 'core', description: 'Compact convoy status heartbeat.'},
] as const;

const packetDefinitionsByType = new Map<number, BushMeshPacketDefinition>(
  BUSHMESH_PACKET_DEFINITIONS.map(definition => [definition.type, definition]),
);

export function getBushMeshPacketDefinition(
  type: number,
): BushMeshPacketDefinition | null {
  return packetDefinitionsByType.get(type) ?? null;
}

export function isBushMeshCorePacketType(type: number): boolean {
  return getBushMeshPacketDefinition(type)?.stability === 'core';
}
