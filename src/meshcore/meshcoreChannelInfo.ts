import {Buffer} from 'buffer';

export const MESHCORE_CHANNEL_NAME_BYTES = 32;
export const MESHCORE_CHANNEL_SECRET_BYTES = 16;

export type MeshCoreChannelInfo = {
  channelIndex: number;
  channelName: string;
  secret: Uint8Array;
  empty: boolean;
};

export function isZeroMeshCoreChannelSecret(secret: Uint8Array): boolean {
  return (
    secret.length === MESHCORE_CHANNEL_SECRET_BYTES &&
    Array.from(secret).every(byte => byte === 0)
  );
}

export function parseMeshCoreChannelInfo(
  bytes: number[] | Uint8Array,
): MeshCoreChannelInfo | null {
  const frame = Array.from(bytes);
  if (frame.length < 50 || frame[0] !== 0x12) {
    return null;
  }

  const nameBytes = frame.slice(2, 2 + MESHCORE_CHANNEL_NAME_BYTES);
  const firstNull = nameBytes.indexOf(0);
  const channelName = Buffer.from(
    firstNull >= 0 ? nameBytes.slice(0, firstNull) : nameBytes,
  )
    .toString('utf8')
    .trim();
  const secret = Uint8Array.from(
    frame.slice(34, 34 + MESHCORE_CHANNEL_SECRET_BYTES),
  );
  const empty = channelName.length === 0 && isZeroMeshCoreChannelSecret(secret);

  return {
    channelIndex: frame[1],
    channelName,
    secret,
    empty,
  };
}

export function meshCoreSecretToHex(secret: Uint8Array): string {
  if (secret.length !== MESHCORE_CHANNEL_SECRET_BYTES) {
    throw new Error('MeshCore channel secret must be exactly 16 bytes.');
  }
  return Array.from(secret)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function meshCoreSecretFromHex(value: string): Uint8Array {
  const normalized = value.replace(/[^0-9a-f]/gi, '');
  if (!/^[0-9a-fA-F]{32}$/.test(normalized)) {
    throw new Error(
      'MeshCore channel secret must contain exactly 16 bytes (32 hex characters).',
    );
  }

  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return Uint8Array.from(bytes);
}

export function meshCoreSecretsEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export function safeMeshCoreChannel(
  channel: MeshCoreChannelInfo,
): {
  channelIndex: string;
  channelName: string;
  secret: string;
} {
  const zeroSecret = isZeroMeshCoreChannelSecret(channel.secret);
  return {
    channelIndex: String(channel.channelIndex),
    channelName: channel.channelName || 'Empty',
    secret: channel.empty
      ? 'Empty / Public'
      : zeroSecret
        ? 'Public / zero secret'
        : 'Configured (redacted)',
  };
}
