import {Buffer} from 'buffer';

export type MeshCoreSelfInfo = {
  advertisementType: number;
  txPower: number;
  maxTxPower: number;
  publicKeyHex: string;
  bushMeshIdentityRef: string;
  latitude: number | null;
  longitude: number | null;
  frequencyMhz: number | null;
  bandwidthKhz: number | null;
  spreadingFactor: number | null;
  codingRate: number | null;
  deviceName: string | null;
};

function readUInt32LE(bytes: number[], offset: number): number | null {
  if (bytes.length < offset + 4) {
    return null;
  }

  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readInt32LE(bytes: number[], offset: number): number | null {
  const value = readUInt32LE(bytes, offset);
  if (value === null) {
    return null;
  }
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function toHex(bytes: number[]): string {
  return bytes
    .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

/**
 * Bushmesh currently uses the first 48 bits of the MeshCore public key as a
 * compact radio identity reference. This is an addressing/reference aid, not
 * authentication; signed identity verification remains a separate concern.
 */
export function meshCorePublicKeyToBushMeshIdentityRef(
  publicKeyHex: string,
): string {
  const normalized = publicKeyHex.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (normalized.length !== 64) {
    throw new Error('MeshCore public key must contain exactly 32 bytes.');
  }
  return normalized.slice(0, 12);
}

export function parseMeshCoreSelfInfo(
  bytes: number[] | Uint8Array,
): MeshCoreSelfInfo | null {
  const packet = Array.from(bytes);
  if (packet[0] !== 0x05) {
    return null;
  }

  if (packet.length < 36) {
    throw new Error('MeshCore SELF_INFO packet is too short for a public key.');
  }

  const publicKeyHex = toHex(packet.slice(4, 36));
  const latitudeRaw = readInt32LE(packet, 36);
  const longitudeRaw = readInt32LE(packet, 40);
  const frequencyRaw = readUInt32LE(packet, 48);
  const bandwidthRaw = readUInt32LE(packet, 52);
  const deviceName =
    packet.length > 58
      ? Buffer.from(packet.slice(58))
          .toString('utf8')
          .replace(/\0/g, '')
          .trim() || null
      : null;

  return {
    advertisementType: packet[1] ?? 0,
    txPower: packet[2] ?? 0,
    maxTxPower: packet[3] ?? 0,
    publicKeyHex,
    bushMeshIdentityRef: meshCorePublicKeyToBushMeshIdentityRef(publicKeyHex),
    latitude: latitudeRaw === null ? null : latitudeRaw / 1_000_000,
    longitude: longitudeRaw === null ? null : longitudeRaw / 1_000_000,
    frequencyMhz: frequencyRaw === null ? null : frequencyRaw / 1000,
    bandwidthKhz: bandwidthRaw === null ? null : bandwidthRaw / 1000,
    spreadingFactor: packet.length > 56 ? packet[56] : null,
    codingRate: packet.length > 57 ? packet[57] : null,
    deviceName,
  };
}
