import {
  BUSHMESH_PROTOCOL_VERSION,
  BushMeshCompressionProfile,
  BushMeshPacketType,
  assertIntegerInRange,
} from './codec';

export type BushMeshProtocolRange = {
  minVersion: number;
  maxVersion: number;
};

export type BushMeshProtocolCompatibility = {
  compatible: boolean;
  negotiatedVersion: number | null;
  reason?: 'no-overlap' | 'local-version-outside-overlap';
};

export const BUSHMESH_V1_PACKET_TYPES = new Set<number>([
  BushMeshPacketType.Message,
  BushMeshPacketType.Location,
  BushMeshPacketType.Distress,
  BushMeshPacketType.Weather,
  BushMeshPacketType.Battery,
  BushMeshPacketType.DeviceInfo,
  BushMeshPacketType.Ping,
  BushMeshPacketType.Route,
  BushMeshPacketType.File,
  BushMeshPacketType.Command,
  BushMeshPacketType.Fragment,
  BushMeshPacketType.Ack,
  BushMeshPacketType.Sync,
  BushMeshPacketType.Routed,
]);

export const BUSHMESH_V1_COMPRESSION_PROFILES = new Set<number>([
  BushMeshCompressionProfile.Raw,
  BushMeshCompressionProfile.TextDictionary,
  BushMeshCompressionProfile.SensorDelta,
  BushMeshCompressionProfile.Gps,
  BushMeshCompressionProfile.Command,
  BushMeshCompressionProfile.Cbor,
  BushMeshCompressionProfile.CompressedBinary,
  BushMeshCompressionProfile.Semantic,
]);

export function evaluateBushMeshProtocolCompatibility(
  local: BushMeshProtocolRange,
  remote: BushMeshProtocolRange,
): BushMeshProtocolCompatibility {
  assertRange(local, 'Local protocol');
  assertRange(remote, 'Remote protocol');

  const overlapMin = Math.max(local.minVersion, remote.minVersion);
  const overlapMax = Math.min(local.maxVersion, remote.maxVersion);

  if (overlapMin > overlapMax) {
    return {
      compatible: false,
      negotiatedVersion: null,
      reason: 'no-overlap',
    };
  }

  if (
    BUSHMESH_PROTOCOL_VERSION < overlapMin ||
    BUSHMESH_PROTOCOL_VERSION > overlapMax
  ) {
    return {
      compatible: false,
      negotiatedVersion: null,
      reason: 'local-version-outside-overlap',
    };
  }

  return {
    compatible: true,
    negotiatedVersion: BUSHMESH_PROTOCOL_VERSION,
  };
}

export function isKnownBushMeshPacketType(
  type: number,
  version = BUSHMESH_PROTOCOL_VERSION,
): boolean {
  assertIntegerInRange(type, 0, 0x3f, 'Packet type');
  assertIntegerInRange(version, 0, 3, 'Protocol version');

  return version === 1 && BUSHMESH_V1_PACKET_TYPES.has(type);
}

export function isKnownBushMeshCompressionProfile(
  profile: number,
  version = BUSHMESH_PROTOCOL_VERSION,
): boolean {
  assertIntegerInRange(profile, 0, 7, 'Compression profile');
  assertIntegerInRange(version, 0, 3, 'Protocol version');

  return version === 1 && BUSHMESH_V1_COMPRESSION_PROFILES.has(profile);
}

export function assertBushMeshV1IdAvailable(
  category: 'packet' | 'compression',
  id: number,
): void {
  if (category === 'packet') {
    assertIntegerInRange(id, 0, 0x3f, 'Packet type');
    if (BUSHMESH_V1_PACKET_TYPES.has(id)) {
      throw new Error(`BushMesh v1 packet ID 0x${id.toString(16)} is already assigned.`);
    }
    return;
  }

  assertIntegerInRange(id, 0, 7, 'Compression profile');
  if (BUSHMESH_V1_COMPRESSION_PROFILES.has(id)) {
    throw new Error(`BushMesh v1 compression profile ${id} is already assigned.`);
  }
}

function assertRange(range: BushMeshProtocolRange, label: string): void {
  assertIntegerInRange(range.minVersion, 0, 3, `${label} minimum version`);
  assertIntegerInRange(
    range.maxVersion,
    range.minVersion,
    3,
    `${label} maximum version`,
  );
}
