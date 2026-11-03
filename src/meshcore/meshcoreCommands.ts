import {Buffer} from 'buffer';

import {
  MESHCORE_CHANNEL_NAME_BYTES,
  MESHCORE_CHANNEL_SECRET_BYTES,
} from './meshcoreChannelInfo';

const MESHCORE_PUBLIC_KEY_BYTES = 32;
const MESHCORE_MAX_PATH_BYTES = 64;
const MESHCORE_CONTACT_NAME_BYTES = 32;

export function bytesToBase64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}

export function bytesToHex(bytes: number[]): string {
  return bytes
    .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

function assertByte(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${label} must be an integer between 0 and 255.`);
  }
}

function writeUInt32LE(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('MeshCore uint32 value is out of range.');
  }
  return [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ];
}

function fixedUtf8(value: string, length: number, label: string): number[] {
  const bytes = Array.from(Buffer.from(value, 'utf8'));
  if (bytes.length > length) {
    throw new Error(`${label} cannot exceed ${length} UTF-8 bytes.`);
  }
  return [...bytes, ...new Array(length - bytes.length).fill(0)];
}

function parseHexBytes(value: string, length: number, label: string): number[] {
  const normalized = value.replace(/[^0-9a-f]/gi, '');
  if (!new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(normalized)) {
    throw new Error(`${label} must contain exactly ${length} bytes.`);
  }
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

function parsePublicKey(publicKeyHex: string): number[] {
  return parseHexBytes(
    publicKeyHex,
    MESHCORE_PUBLIC_KEY_BYTES,
    'MeshCore contact public key',
  );
}

function parsePublicKeyPrefix(publicKeyPrefixHex: string): number[] {
  return parseHexBytes(
    publicKeyPrefixHex,
    6,
    'MeshCore contact public-key prefix',
  );
}

export function buildGetContactsCommand(since?: number): string {
  return bytesToBase64(
    typeof since === 'number' ? [0x04, ...writeUInt32LE(since)] : [0x04],
  );
}

export function getContactsCommandHex(since?: number): string {
  return bytesToHex(
    typeof since === 'number' ? [0x04, ...writeUInt32LE(since)] : [0x04],
  );
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

export function buildGetDeviceTimeCommand(): string {
  return bytesToBase64([0x05]);
}

export function buildSetDeviceTimeCommand(timestampSeconds: number): string {
  return bytesToBase64([0x06, ...writeUInt32LE(timestampSeconds)]);
}

export function buildGetChannelCommand(channelIndex: number): string {
  assertByte(channelIndex, 'MeshCore channel index');
  return bytesToBase64([0x1f, channelIndex]);
}

export function getChannelCommandHex(channelIndex: number): string {
  assertByte(channelIndex, 'MeshCore channel index');
  return bytesToHex([0x1f, channelIndex]);
}

export function buildSetChannelCommand(
  channelIndex: number,
  channelName: string,
  secret: Uint8Array,
): string {
  assertByte(channelIndex, 'MeshCore channel index');
  if (secret.length !== MESHCORE_CHANNEL_SECRET_BYTES) {
    throw new Error('MeshCore channel secret must be exactly 16 bytes.');
  }
  const name = fixedUtf8(
    channelName,
    MESHCORE_CHANNEL_NAME_BYTES,
    'MeshCore channel name',
  );
  return bytesToBase64([0x20, channelIndex, ...name, ...Array.from(secret)]);
}

/** Safe command description: intentionally never includes the channel secret. */
export function setChannelCommandSafeHex(
  channelIndex: number,
  channelName: string,
): string {
  assertByte(channelIndex, 'MeshCore channel index');
  const name = fixedUtf8(
    channelName,
    MESHCORE_CHANNEL_NAME_BYTES,
    'MeshCore channel name',
  );
  return `${bytesToHex([0x20, channelIndex, ...name])} <16-byte secret redacted>`;
}

export function buildGetContactByKeyCommand(publicKeyHex: string): string {
  return bytesToBase64([0x1e, ...parsePublicKey(publicKeyHex)]);
}

export function buildRemoveContactCommand(publicKeyHex: string): string {
  return bytesToBase64([0x0f, ...parsePublicKey(publicKeyHex)]);
}

export type MeshCoreContactWriteInput = {
  publicKey: string;
  name: string;
  type?: number;
  flags?: number;
  outPath?: Uint8Array;
  lastAdvert?: number;
};

/**
 * CMD_ADD_UPDATE_CONTACT (0x09). This helper supports a full 32-byte identity
 * with an optional direct-routing path. It never handles node private keys.
 */
export function buildAddUpdateContactCommand(
  input: MeshCoreContactWriteInput,
): string {
  const publicKey = parsePublicKey(input.publicKey);
  const type = input.type ?? 0;
  const flags = input.flags ?? 0;
  assertByte(type, 'MeshCore contact type');
  assertByte(flags, 'MeshCore contact flags');
  const outPath = Array.from(input.outPath ?? new Uint8Array());
  if (outPath.length > MESHCORE_MAX_PATH_BYTES) {
    throw new Error(`MeshCore contact path cannot exceed ${MESHCORE_MAX_PATH_BYTES} bytes.`);
  }
  const name = fixedUtf8(
    input.name,
    MESHCORE_CONTACT_NAME_BYTES,
    'MeshCore contact name',
  );
  const paddedPath = [
    ...outPath,
    ...new Array(MESHCORE_MAX_PATH_BYTES - outPath.length).fill(0),
  ];
  return bytesToBase64([
    0x09,
    ...publicKey,
    type,
    flags,
    outPath.length,
    ...paddedPath,
    ...name,
    ...writeUInt32LE(input.lastAdvert ?? 0),
  ]);
}

export function buildExportContactCommand(publicKeyHex: string): string {
  return bytesToBase64([0x11, ...parsePublicKey(publicKeyHex)]);
}

/**
 * CMD_IMPORT_CONTACT (0x12). The export payload is deliberately opaque; if the
 * response-code byte (0x0B) is present it is stripped before import.
 */
export function buildImportContactCommand(exportedContact: Uint8Array): string {
  const bytes = Array.from(exportedContact);
  const payload = bytes[0] === 0x0b ? bytes.slice(1) : bytes;
  if (payload.length <= 98) {
    throw new Error('MeshCore exported contact payload is too short to import.');
  }
  return bytesToBase64([0x12, ...payload]);
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
  assertByte(channelIndex, 'MeshCore channel index');
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
  assertByte(channelIndex, 'MeshCore channel index');
  const messageBytes = Array.from(Buffer.from(message, 'utf8'));
  return bytesToHex([
    0x03,
    0x00,
    channelIndex,
    ...writeUInt32LE(timestampSeconds),
    ...messageBytes,
  ]);
}

function sendContactMessageCommandBytes(
  publicKeyPrefixHex: string,
  message: string,
  timestampSeconds: number,
  attempt: number,
): number[] {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > 3) {
    throw new Error('MeshCore direct-message attempt must be between 0 and 3.');
  }
  if (
    !Number.isInteger(timestampSeconds) ||
    timestampSeconds < 0 ||
    timestampSeconds > 0xffffffff
  ) {
    throw new Error('MeshCore direct-message timestamp must be a uint32 value.');
  }

  const messageBytes = Array.from(Buffer.from(message, 'utf8'));
  if (messageBytes.length === 0) {
    throw new Error('MeshCore direct message is empty.');
  }
  if (messageBytes.length > 160) {
    throw new Error('MeshCore direct message cannot exceed 160 UTF-8 bytes.');
  }

  return [
    0x02,
    0x00,
    attempt,
    ...writeUInt32LE(timestampSeconds),
    ...parsePublicKeyPrefix(publicKeyPrefixHex),
    ...messageBytes,
  ];
}

/** MeshCore CMD_SEND_TXT_MSG (0x02), direct to one contact. */
export function buildSendContactMessageCommand(
  publicKeyPrefixHex: string,
  message: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
  attempt = 0,
): string {
  return bytesToBase64(
    sendContactMessageCommandBytes(
      publicKeyPrefixHex,
      message,
      timestampSeconds,
      attempt,
    ),
  );
}

export function sendContactMessageCommandHex(
  publicKeyPrefixHex: string,
  message: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
  attempt = 0,
): string {
  return bytesToHex(
    sendContactMessageCommandBytes(
      publicKeyPrefixHex,
      message,
      timestampSeconds,
      attempt,
    ),
  );
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
  // Capacity is firmware/device specific. The session layer validates the
  // index against DEVICE_INFO.maxChannels; the wire field itself is one byte.
  assertByte(channelIndex, 'MeshCore channel index');

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
