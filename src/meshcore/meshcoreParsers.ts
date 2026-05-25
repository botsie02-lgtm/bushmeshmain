import {Buffer} from 'buffer';

export type ParsedMeshCorePacket = {
  title: string;
  lines: string[];
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

function readText(bytes: number[], start: number, length?: number): string {
  const slice =
    typeof length === 'number'
      ? bytes.slice(start, start + length)
      : bytes.slice(start);

  return Buffer.from(slice)
    .toString('utf8')
    .replace(/\0/g, '')
    .trim();
}

function readHex(bytes: number[], start: number, length: number): string {
  return bytes
    .slice(start, start + length)
    .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

function formatMaybe(value: number | null | undefined, suffix = ''): string {
  if (value === null || typeof value === 'undefined') {
    return 'Unavailable';
  }

  return `${value}${suffix}`;
}

function parseSelfInfo(bytes: number[]): ParsedMeshCorePacket {
  const lines: string[] = [];

  lines.push(`Byte Length: ${bytes.length}`);

  if (bytes.length < 58) {
    lines.push('Parser Note: Packet is shorter than expected for full SELF_INFO.');
    return {
      title: 'Parsed Self Info',
      lines,
    };
  }

  const latitudeRaw = readInt32LE(bytes, 36);
  const longitudeRaw = readInt32LE(bytes, 40);
  const frequencyRaw = readUInt32LE(bytes, 48);
  const bandwidthRaw = readUInt32LE(bytes, 52);

  lines.push(`Advertisement Type: ${bytes[1]}`);
  lines.push(`TX Power: ${bytes[2]}`);
  lines.push(`Max TX Power: ${bytes[3]}`);
  lines.push(`Public Key: ${readHex(bytes, 4, 32)}`);

  if (latitudeRaw !== null && longitudeRaw !== null) {
    lines.push(`Advertisement Latitude: ${latitudeRaw / 1_000_000}`);
    lines.push(`Advertisement Longitude: ${longitudeRaw / 1_000_000}`);
  }

  lines.push(`Multi ACKs: ${bytes[44]}`);
  lines.push(`Advertisement Location Policy: ${bytes[45]}`);
  lines.push(`Telemetry Mode: ${bytes[46]}`);
  lines.push(`Manual Add Contacts: ${bytes[47] > 0 ? 'Yes' : 'No'}`);

  if (frequencyRaw !== null) {
    lines.push(`Radio Frequency: ${frequencyRaw / 1000} MHz`);
  }

  if (bandwidthRaw !== null) {
    lines.push(`Radio Bandwidth: ${bandwidthRaw / 1000} kHz`);
  }

  lines.push(`Radio Spreading Factor: ${formatMaybe(bytes[56])}`);
  lines.push(`Radio Coding Rate: ${formatMaybe(bytes[57])}`);

  const deviceName = readText(bytes, 58);

  if (deviceName) {
    lines.push(`Device Name: ${deviceName}`);
  }

  return {
    title: 'Parsed Self Info',
    lines,
  };
}

function parseDeviceInfo(bytes: number[]): ParsedMeshCorePacket {
  const lines: string[] = [];

  lines.push(`Byte Length: ${bytes.length}`);

  if (bytes.length < 2) {
    lines.push('Parser Note: Packet is too short for DEVICE_INFO.');
    return {
      title: 'Parsed Device Info',
      lines,
    };
  }

  const firmwareVersion = bytes[1];

  lines.push(`Firmware Version: ${firmwareVersion}`);

  if (firmwareVersion >= 3 && bytes.length >= 80) {
    const maxContactsRaw = bytes[2];
    const maxChannels = bytes[3];
    const blePin = readUInt32LE(bytes, 4);
    const firmwareBuild = readText(bytes, 8, 12);
    const model = readText(bytes, 20, 40);
    const version = readText(bytes, 60, 20);

    lines.push(`Max Contacts Raw: ${maxContactsRaw}`);
    lines.push(`Max Contacts Estimate: ${maxContactsRaw * 2}`);
    lines.push(`Max Channels: ${maxChannels}`);
    lines.push(`BLE PIN: ${blePin ?? 'Unavailable'}`);

    if (firmwareBuild) {
      lines.push(`Firmware Build: ${firmwareBuild}`);
    }

    if (model) {
      lines.push(`Model: ${model}`);
    }

    if (version) {
      lines.push(`Version: ${version}`);
    }

    if (bytes.length > 80) {
      lines.push(`Client Repeat Enabled/Preferred: ${bytes[80]}`);
    }

    if (bytes.length > 81) {
      lines.push(`Path Hash Mode: ${bytes[81]}`);
    }
  } else {
    lines.push('Parser Note: Older or short DEVICE_INFO packet.');
  }

  return {
    title: 'Parsed Device Info',
    lines,
  };
}

function parseChannelInfo(bytes: number[]): ParsedMeshCorePacket {
  const lines: string[] = [];

  lines.push(`Byte Length: ${bytes.length}`);

  if (bytes.length < 50) {
    lines.push('Parser Note: Packet is shorter than expected for CHANNEL_INFO.');
    return {
      title: 'Parsed Channel Info',
      lines,
    };
  }

  const channelIndex = bytes[1];
  const channelName = readText(bytes, 2, 32);
  const secretHex = readHex(bytes, 34, 16);
  const secretIsEmpty = secretHex === '00000000000000000000000000000000';

  lines.push(`Channel Index: ${channelIndex}`);
  lines.push(`Channel Name: ${channelName || 'Empty'}`);
  lines.push(`Secret: ${secretIsEmpty ? 'Empty / Public' : secretHex}`);

  return {
    title: 'Parsed Channel Info',
    lines,
  };
}

export function parseMeshCorePacketFields(
  bytes: number[],
): ParsedMeshCorePacket | null {
  const packetType = bytes[0];

  switch (packetType) {
    case 0x05:
      return parseSelfInfo(bytes);

    case 0x0d:
      return parseDeviceInfo(bytes);

    case 0x12:
      return parseChannelInfo(bytes);

    default:
      return null;
  }
}