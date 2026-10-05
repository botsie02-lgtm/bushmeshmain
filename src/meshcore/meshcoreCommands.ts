import {Buffer} from 'buffer';

export function bytesToBase64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}

export function bytesToHex(bytes: number[]): string {
  return bytes
    .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}
export function buildGetContactsCommand(since?: number): string {
  if (typeof since === 'number') {
    return bytesToBase64([
      0x04,
      since & 0xff,
      (since >> 8) & 0xff,
      (since >> 16) & 0xff,
      (since >> 24) & 0xff,
    ]);
  }

  return bytesToBase64([0x04]);
}

export function getContactsCommandHex(since?: number): string {
  if (typeof since === 'number') {
    return bytesToHex([
      0x04,
      since & 0xff,
      (since >> 8) & 0xff,
      (since >> 16) & 0xff,
      (since >> 24) & 0xff,
    ]);
  }

  return bytesToHex([0x04]);
}
function writeUInt32LE(value: number): number[] {
  return [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ];
}

export function buildAppStartCommand(appName = 'BushMesh'): string {
  const appNameBytes = Array.from(Buffer.from(appName, 'utf8'));

  return bytesToBase64([
    0x01,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    ...appNameBytes,
  ]);
}

export function buildDeviceQueryCommand(): string {
  return bytesToBase64([0x16, 0x03]);
}

export function buildGetChannelCommand(channelIndex: number): string {
  return bytesToBase64([0x1f, channelIndex]);
}

export function getChannelCommandHex(channelIndex: number): string {
  return bytesToHex([0x1f, channelIndex]);
}

export function buildGetMessageCommand(): string {
  return bytesToBase64([0x0a]);
}
export function buildGetBatteryCommand(): string {
  return bytesToBase64([0x14]);
}

export function getBatteryCommandHex(): string {
  return bytesToHex([0x14]);
}
export function getMessageCommandHex(): string {
  return bytesToHex([0x0a]);
}

export function buildSendChannelMessageCommand(
  channelIndex: number,
  message: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  const messageBytes = Array.from(Buffer.from(message, 'utf8'));

  return bytesToBase64([
    0x03,
    0x00,
    channelIndex,
    ...writeUInt32LE(timestampSeconds),
    ...messageBytes,
  ]);
}

export function sendChannelMessageCommandHex(
  channelIndex: number,
  message: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  const messageBytes = Array.from(Buffer.from(message, 'utf8'));

  return bytesToHex([
    0x03,
    0x00,
    channelIndex,
    ...writeUInt32LE(timestampSeconds),
    ...messageBytes,
  ]);
}

/** MeshCore CMD_SEND_CHANNEL_DATA (0x3E), using flood routing. */
export function buildSendChannelDataFloodCommand(
  channelIndex: number,
  dataType: number,
  payload: Uint8Array,
): string {
  return bytesToBase64(
    sendChannelDataFloodCommandBytes(channelIndex, dataType, payload),
  );
}

export function sendChannelDataFloodCommandHex(
  channelIndex: number,
  dataType: number,
  payload: Uint8Array,
): string {
  return bytesToHex(
    sendChannelDataFloodCommandBytes(channelIndex, dataType, payload),
  );
}

function sendChannelDataFloodCommandBytes(
  channelIndex: number,
  dataType: number,
  payload: Uint8Array,
): number[] {
  if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 7) {
    throw new Error('MeshCore channel index must be between 0 and 7.');
  }

  if (!Number.isInteger(dataType) || dataType <= 0 || dataType > 0xffff) {
    throw new Error('MeshCore channel data type must be between 0x0001 and 0xFFFF.');
  }

  if (payload.length > 163) {
    throw new Error('MeshCore channel data payload cannot exceed 163 bytes.');
  }

  return [
    0x3e,
    channelIndex,
    0xff,
    dataType & 0xff,
    (dataType >>> 8) & 0xff,
    ...Array.from(payload),
  ];
}
