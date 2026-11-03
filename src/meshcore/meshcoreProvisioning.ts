import {MeshCoreDeviceInfo} from './meshcoreDeviceInfo';
import {
  MESHCORE_CHANNEL_SECRET_BYTES,
  MeshCoreChannelInfo,
  meshCoreSecretsEqual,
} from './meshcoreChannelInfo';

export type MeshCoreChannelProvisioningPort = {
  getDeviceInfo: () => Promise<MeshCoreDeviceInfo>;
  readChannel: (channelIndex: number) => Promise<MeshCoreChannelInfo>;
  writeChannel: (
    channelIndex: number,
    channelName: string,
    secret: Uint8Array,
  ) => Promise<void>;
};

export type MeshCoreProvisionedChannel = {
  channelIndex: number;
  channelName: string;
  secret: Uint8Array;
};

export type MeshCoreChannelProvisionRequest = {
  channelName: string;
  secret?: Uint8Array;
  channelIndex?: number | null;
  randomBytes?: (length: number) => Promise<Uint8Array>;
};

function requireChannelCapacity(deviceInfo: MeshCoreDeviceInfo): number {
  const maxChannels = deviceInfo.maxChannels;
  if (!Number.isInteger(maxChannels) || (maxChannels ?? 0) <= 0) {
    throw new Error(
      'This MeshCore firmware did not advertise a usable channel capacity. Update firmware or reconnect and refresh Device Info.',
    );
  }
  return maxChannels as number;
}

export function validateMeshCoreChannelIndex(
  channelIndex: number,
  maxChannels: number,
): void {
  if (
    !Number.isInteger(channelIndex) ||
    channelIndex < 0 ||
    channelIndex >= maxChannels
  ) {
    throw new Error(
      `MeshCore channel slot ${channelIndex} is invalid for this node (available slots: 0-${Math.max(
        0,
        maxChannels - 1,
      )}).`,
    );
  }
}

export async function readAllMeshCoreChannels(
  port: MeshCoreChannelProvisioningPort,
): Promise<MeshCoreChannelInfo[]> {
  const deviceInfo = await port.getDeviceInfo();
  const maxChannels = requireChannelCapacity(deviceInfo);
  const channels: MeshCoreChannelInfo[] = [];
  for (let channelIndex = 0; channelIndex < maxChannels; channelIndex += 1) {
    channels.push(await port.readChannel(channelIndex));
  }
  return channels;
}

function normalizedChannelName(channelName: string): string {
  const value = channelName.trim();
  if (!value) {
    throw new Error('Private MeshCore channel name cannot be empty.');
  }
  return value;
}

async function resolveProvisioningSlot(
  port: MeshCoreChannelProvisioningPort,
  requestedIndex: number | null | undefined,
): Promise<{channelIndex: number; maxChannels: number}> {
  const deviceInfo = await port.getDeviceInfo();
  const maxChannels = requireChannelCapacity(deviceInfo);
  if (typeof requestedIndex === 'number') {
    validateMeshCoreChannelIndex(requestedIndex, maxChannels);
    return {channelIndex: requestedIndex, maxChannels};
  }

  for (let channelIndex = 0; channelIndex < maxChannels; channelIndex += 1) {
    const existing = await port.readChannel(channelIndex);
    if (existing.empty) {
      return {channelIndex, maxChannels};
    }
  }

  throw new Error(
    `This MeshCore node has no empty channel slots (${maxChannels} of ${maxChannels} are configured). Clear a slot or choose one explicitly to replace it.`,
  );
}

export async function provisionMeshCoreChannel(
  port: MeshCoreChannelProvisioningPort,
  request: MeshCoreChannelProvisionRequest,
): Promise<MeshCoreProvisionedChannel> {
  const channelName = normalizedChannelName(request.channelName);
  const {channelIndex} = await resolveProvisioningSlot(
    port,
    request.channelIndex,
  );

  let secret = request.secret;
  if (!secret) {
    if (!request.randomBytes) {
      throw new Error('A cryptographically secure random source is required to create a private channel.');
    }
    secret = await request.randomBytes(MESHCORE_CHANNEL_SECRET_BYTES);
  }
  if (secret.length !== MESHCORE_CHANNEL_SECRET_BYTES) {
    throw new Error('MeshCore channel secret must be exactly 16 bytes.');
  }
  const secretCopy = Uint8Array.from(secret);

  await port.writeChannel(channelIndex, channelName, secretCopy);
  const verified = await port.readChannel(channelIndex);
  if (
    verified.channelIndex !== channelIndex ||
    verified.channelName !== channelName ||
    !meshCoreSecretsEqual(verified.secret, secretCopy)
  ) {
    throw new Error(
      `MeshCore channel ${channelIndex} write did not verify. The app will not activate or claim this channel was joined.`,
    );
  }

  return {channelIndex, channelName, secret: secretCopy};
}

export async function clearMeshCoreChannel(
  port: MeshCoreChannelProvisioningPort,
  channelIndex: number,
): Promise<MeshCoreChannelInfo> {
  const deviceInfo = await port.getDeviceInfo();
  const maxChannels = requireChannelCapacity(deviceInfo);
  validateMeshCoreChannelIndex(channelIndex, maxChannels);

  await port.writeChannel(
    channelIndex,
    '',
    new Uint8Array(MESHCORE_CHANNEL_SECRET_BYTES),
  );
  const verified = await port.readChannel(channelIndex);
  if (!verified.empty) {
    throw new Error(
      `MeshCore channel ${channelIndex} clear did not verify. The slot still contains channel configuration.`,
    );
  }
  return verified;
}
