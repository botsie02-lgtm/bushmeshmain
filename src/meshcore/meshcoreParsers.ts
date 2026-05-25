import {Buffer} from 'buffer';

export type ParsedChannelMessage = {
  packetType: 'channel';
  channelIndex: string;
  text: string;
  timestamp: number | null;
  pathLength: number | null;
  textType: number | null;
  snr: number | null;
};
export type ParsedBatteryInfo = {
  batteryMv: number;
  batteryVolts: number;
  usedStorageKb: number | null;
  totalStorageKb: number | null;
  storagePercent: number | null;
};
export type ParsedContactMessage = {
  packetType: 'contact';
  publicKeyPrefix: string;
  text: string;
  timestamp: number | null;
  pathLength: number | null;
  textType: number | null;
  snr: number | null;
};

export type ParsedMeshCorePacket = {
  title: string;
  lines: string[];
  channelMessage?: ParsedChannelMessage;
  contactMessage?: ParsedContactMessage;
  batteryInfo?: ParsedBatteryInfo;
  contactInfo?: ParsedContactInfo;
  contactsStartCount?: number;
  contactsEndLastModified?: number | null;
};
export type ParsedContactInfo = {
  publicKey: string;
  publicKeyPrefix: string;
  type: number;
  flags: number;
  outPathLength: number;
  name: string;
  lastAdvert: number | null;
  latitude: number | null;
  longitude: number | null;
  lastModified: number | null;
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

function readSignedByte(byte: number): number {
  return byte > 127 ? byte - 256 : byte;
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

function parseChannelMessage(bytes: number[]): ParsedMeshCorePacket {
  const lines: string[] = [];
  const isV3 = bytes[0] === 0x11;

  lines.push(`Byte Length: ${bytes.length}`);

  let offset = 1;
  let snr: number | null = null;

  if (isV3) {
    if (bytes.length < 11) {
      lines.push('Parser Note: Packet is shorter than expected for CHANNEL_MSG_RECV_V3.');
      return {
        title: 'Parsed Channel Message',
        lines,
      };
    }

    snr = readSignedByte(bytes[offset]) / 4;
    offset += 3;
  } else if (bytes.length < 8) {
    lines.push('Parser Note: Packet is shorter than expected for CHANNEL_MSG_RECV.');
    return {
      title: 'Parsed Channel Message',
      lines,
    };
  }

  const channelIndex = bytes[offset];
  const pathLength = bytes[offset + 1];
  const textType = bytes[offset + 2];
  const timestamp = readUInt32LE(bytes, offset + 3);
  const text = readText(bytes, offset + 7);

  lines.push(`Channel Index: ${channelIndex}`);
  lines.push(`Path Length: ${pathLength}`);
  lines.push(`Text Type: ${textType}`);
  lines.push(`Timestamp: ${timestamp ?? 'Unavailable'}`);

  if (snr !== null) {
    lines.push(`SNR: ${snr}`);
  }

  lines.push(`Message: ${text}`);

  return {
    title: isV3 ? 'Parsed Channel Message V3' : 'Parsed Channel Message',
    lines,
    channelMessage: {
      packetType: 'channel',
      channelIndex: String(channelIndex),
      text,
      timestamp,
      pathLength,
      textType,
      snr,
    },
  };
}

function parseContactMessage(bytes: number[]): ParsedMeshCorePacket {
  const lines: string[] = [];
  const isV3 = bytes[0] === 0x10;

  lines.push(`Byte Length: ${bytes.length}`);

  let offset = 1;
  let snr: number | null = null;

  if (isV3) {
    if (bytes.length < 20) {
      lines.push('Parser Note: Packet is shorter than expected for CONTACT_MSG_RECV_V3.');
      return {
        title: 'Parsed Contact Message',
        lines,
      };
    }

    snr = readSignedByte(bytes[offset]) / 4;
    offset += 3;
  } else if (bytes.length < 13) {
    lines.push('Parser Note: Packet is shorter than expected for CONTACT_MSG_RECV.');
    return {
      title: 'Parsed Contact Message',
      lines,
    };
  }

  const publicKeyPrefix = readHex(bytes, offset, 6);
  offset += 6;

  const pathLength = bytes[offset];
  const textType = bytes[offset + 1];
  offset += 2;

  const timestamp = readUInt32LE(bytes, offset);
  offset += 4;

  if (textType === 2) {
    offset += 4;
  }

  const text = readText(bytes, offset);

  lines.push(`Public Key Prefix: ${publicKeyPrefix}`);
  lines.push(`Path Length: ${pathLength}`);
  lines.push(`Text Type: ${textType}`);
  lines.push(`Timestamp: ${timestamp ?? 'Unavailable'}`);

  if (snr !== null) {
    lines.push(`SNR: ${snr}`);
  }

  lines.push(`Message: ${text}`);

  return {
    title: isV3 ? 'Parsed Contact Message V3' : 'Parsed Contact Message',
    lines,
    contactMessage: {
      packetType: 'contact',
      publicKeyPrefix,
      text,
      timestamp,
      pathLength,
      textType,
      snr,
    },
  };
}

function parseNoMoreMessages(bytes: number[]): ParsedMeshCorePacket {
  return {
    title: 'Parsed No More Messages',
    lines: [`Byte Length: ${bytes.length}`, 'No more queued messages.'],
  };
}

function parseMessagesWaiting(bytes: number[]): ParsedMeshCorePacket {
  return {
    title: 'Parsed Messages Waiting',
    lines: [
      `Byte Length: ${bytes.length}`,
      'Messages are waiting on the companion node.',
    ],
  };
}
function parseBatteryInfo(bytes: number[]): ParsedMeshCorePacket {
  const lines: string[] = [];

  lines.push(`Byte Length: ${bytes.length}`);

  if (bytes.length < 3) {
    lines.push('Parser Note: Packet is shorter than expected for BATTERY.');
    return {
      title: 'Parsed Battery Info',
      lines,
    };
  }

  const batteryMv = bytes[1] | (bytes[2] << 8);
  const batteryVolts = batteryMv / 1000;

  const usedStorageKb = readUInt32LE(bytes, 3);
  const totalStorageKb = readUInt32LE(bytes, 7);

  const storagePercent =
    usedStorageKb !== null && totalStorageKb !== null && totalStorageKb > 0
      ? Math.round((usedStorageKb / totalStorageKb) * 100)
      : null;

  lines.push(`Battery: ${batteryMv} mV`);
  lines.push(`Battery Volts: ${batteryVolts.toFixed(2)} V`);

  if (usedStorageKb !== null) {
    lines.push(`Used Storage: ${usedStorageKb} KB`);
  }

  if (totalStorageKb !== null) {
    lines.push(`Total Storage: ${totalStorageKb} KB`);
  }

  if (storagePercent !== null) {
    lines.push(`Storage Used: ${storagePercent}%`);
  }

  return {
    title: 'Parsed Battery Info',
    lines,
    batteryInfo: {
      batteryMv,
      batteryVolts,
      usedStorageKb,
      totalStorageKb,
      storagePercent,
    },
  };
}
function parseContactsStart(bytes: number[]): ParsedMeshCorePacket {
  const count = readUInt32LE(bytes, 1) ?? 0;

  return {
    title: 'Parsed Contacts Start',
    lines: [`Byte Length: ${bytes.length}`, `Contact Count: ${count}`],
    contactsStartCount: count,
  };
}

function parseContactInfo(bytes: number[]): ParsedMeshCorePacket {
  const lines: string[] = [];

  lines.push(`Byte Length: ${bytes.length}`);

  if (bytes.length < 143) {
    lines.push('Parser Note: Packet is shorter than expected for CONTACT.');
    return {
      title: 'Parsed Contact',
      lines,
    };
  }

  const publicKey = readHex(bytes, 1, 32);
  const publicKeyPrefix = publicKey.slice(0, 12);
  const type = bytes[33];
  const flags = bytes[34];
  const outPathLengthRaw = bytes[35];
  const outPathLength = outPathLengthRaw > 127 ? outPathLengthRaw - 256 : outPathLengthRaw;
  const name = readText(bytes, 100, 32) || 'Unnamed Contact';
  const lastAdvert = readUInt32LE(bytes, 132);
  const latitudeRaw = readInt32LE(bytes, 136);
  const longitudeRaw = readInt32LE(bytes, 140);
  const lastModified = readUInt32LE(bytes, 144);

  const latitude = latitudeRaw !== null ? latitudeRaw / 1_000_000 : null;
  const longitude = longitudeRaw !== null ? longitudeRaw / 1_000_000 : null;

  lines.push(`Name: ${name}`);
  lines.push(`Public Key Prefix: ${publicKeyPrefix}`);
  lines.push(`Type: ${type}`);
  lines.push(`Flags: ${flags}`);
  lines.push(`Out Path Length: ${outPathLength}`);
  lines.push(`Last Advert: ${lastAdvert ?? 'Unavailable'}`);

  if (latitude !== null && longitude !== null) {
    lines.push(`Latitude: ${latitude}`);
    lines.push(`Longitude: ${longitude}`);
  }

  lines.push(`Last Modified: ${lastModified ?? 'Unavailable'}`);

  return {
    title: 'Parsed Contact',
    lines,
    contactInfo: {
      publicKey,
      publicKeyPrefix,
      type,
      flags,
      outPathLength,
      name,
      lastAdvert,
      latitude,
      longitude,
      lastModified,
    },
  };
}

function parseContactsEnd(bytes: number[]): ParsedMeshCorePacket {
  const lastModified = readUInt32LE(bytes, 1);

  return {
    title: 'Parsed Contacts End',
    lines: [
      `Byte Length: ${bytes.length}`,
      `Most Recent Last Modified: ${lastModified ?? 'Unavailable'}`,
    ],
    contactsEndLastModified: lastModified,
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

    case 0x08:
    case 0x11:
      return parseChannelMessage(bytes);

    case 0x07:
    case 0x10:
      return parseContactMessage(bytes);

    case 0x0a:
      return parseNoMoreMessages(bytes);

    case 0x83:
      return parseMessagesWaiting(bytes);
    
    case 0x0c:
      return parseBatteryInfo(bytes);
    case 0x02:
      return parseContactsStart(bytes);

    case 0x03:
      return parseContactInfo(bytes);

    case 0x04:
      return parseContactsEnd(bytes);
      
    default:
      return null;
  }
}