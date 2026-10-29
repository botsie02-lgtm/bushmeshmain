import {Buffer} from 'buffer';

export type MeshCoreDeviceInfo = {
  firmwareVersion: number;
  maxContacts: number | null;
  maxChannels: number | null;
  blePin: number | null;
  firmwareBuild: string | null;
  model: string | null;
  version: string | null;
  clientRepeat: number | null;
  pathHashMode: number | null;
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

function readText(bytes: number[], start: number, length: number): string | null {
  if (bytes.length <= start) {
    return null;
  }

  const value = Buffer.from(bytes.slice(start, start + length))
    .toString('utf8')
    .replace(/\0/g, '')
    .trim();

  return value || null;
}

export function parseMeshCoreDeviceInfo(
  bytes: number[] | Uint8Array,
): MeshCoreDeviceInfo | null {
  const frame = Array.from(bytes);

  if (frame.length < 2 || frame[0] !== 0x0d) {
    return null;
  }

  const firmwareVersion = frame[1];

  if (firmwareVersion < 3 || frame.length < 80) {
    return {
      firmwareVersion,
      maxContacts: null,
      maxChannels: null,
      blePin: null,
      firmwareBuild: null,
      model: null,
      version: null,
      clientRepeat: null,
      pathHashMode: null,
    };
  }

  return {
    firmwareVersion,
    maxContacts: frame[2] * 2,
    maxChannels: frame[3],
    blePin: readUInt32LE(frame, 4),
    firmwareBuild: readText(frame, 8, 12),
    model: readText(frame, 20, 40),
    version: readText(frame, 60, 20),
    clientRepeat: frame.length > 80 ? frame[80] : null,
    pathHashMode: frame.length > 81 ? frame[81] : null,
  };
}
