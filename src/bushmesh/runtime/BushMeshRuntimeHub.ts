import {
  BushMeshControlCommand,
  BushMeshConvoyAction,
  BushMeshPacketType,
  BushMeshTypedPacket,
  decodeBushMeshTypedPacket,
  encodeBushMeshControlWire,
  encodeBushMeshConvoyWire,
} from '../protocol';
import {tryDecodeBushMeshChannelFrame} from '../../meshcore/meshcoreBushMeshBridge';
import {BushMeshNetworkRuntime} from './BushMeshNetworkRuntime';
import {
  acceptBushMeshConvoyCommandRemote,
  acceptBushMeshConvoyRemote,
  markBushMeshConvoyTransmitted,
  nextBushMeshConvoyCommand,
} from './BushMeshConvoyHub';
import {
  clearMeshCorePublicKey,
  publishMeshCorePublicKey,
} from './BushMeshIdentityHub';

let activeRuntime: BushMeshNetworkRuntime | null = null;

export function setActiveBushMeshRuntime(
  runtime: BushMeshNetworkRuntime | null,
): void {
  activeRuntime = runtime;

  if (!runtime) {
    clearMeshCorePublicKey();
  }
}

export function getActiveBushMeshRuntime(): BushMeshNetworkRuntime | null {
  return activeRuntime;
}

function inspectMeshCoreIdentity(bytes: number[]): void {
  // MeshCore PACKET_SELF_INFO (0x05) carries the 32-byte public key at offset 4.
  if (bytes[0] !== 0x05 || bytes.length < 36) {
    return;
  }

  const publicKey = bytes
    .slice(4, 36)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

  publishMeshCorePublicKey(publicKey);
}

function inspectBushMeshConvoy(bytes: number[], now: number): void {
  try {
    const channelFrame = tryDecodeBushMeshChannelFrame(bytes);
    if (!channelFrame) {
      return;
    }

    const packetType = channelFrame.decoded.envelope.type;
    if (
      packetType !== BushMeshPacketType.Convoy &&
      packetType !== BushMeshPacketType.Command
    ) {
      return;
    }

    const typed: BushMeshTypedPacket = decodeBushMeshTypedPacket(
      channelFrame.decoded.wireBytes,
    );
    if (typed.kind === 'convoy') {
      acceptBushMeshConvoyRemote(typed.value, now);
      return;
    }

    if (
      typed.kind === 'command' &&
      typed.value.command === BushMeshControlCommand.ConvoyAction
    ) {
      acceptBushMeshConvoyCommandRemote(typed.value, now);
    }
  } catch {
    // The normal network runtime owns decode-error accounting. Convoy inspection
    // is intentionally side-effect-free when a frame is malformed.
  }
}

export async function sendActiveBushMeshConvoyStatus(
  channelIndex: number,
  status: Parameters<typeof encodeBushMeshConvoyWire>[0],
): Promise<void> {
  if (!activeRuntime) {
    throw new Error('BushMesh networking runtime is not active.');
  }

  const wireBytes = encodeBushMeshConvoyWire(
    status,
    activeRuntime.nextMessageId(),
  );
  await activeRuntime.sendWire(channelIndex, wireBytes, {
    allowFragmentation: false,
  });
  markBushMeshConvoyTransmitted();
}

export async function sendActiveBushMeshConvoyCommand(
  channelIndex: number,
  originNodeId: number,
  action: BushMeshConvoyAction | number,
  options?: {targetOrderIndex?: number; etaMinutes?: number},
): Promise<ReturnType<typeof nextBushMeshConvoyCommand>> {
  if (!activeRuntime) {
    throw new Error('BushMesh networking runtime is not active.');
  }

  const command = nextBushMeshConvoyCommand(originNodeId, action, options);
  const wireBytes = encodeBushMeshControlWire(
    command,
    activeRuntime.nextMessageId(),
  );
  await activeRuntime.sendWire(channelIndex, wireBytes, {
    allowFragmentation: false,
  });
  return command;
}

export async function acceptBushMeshMeshCoreFrame(
  bytes: number[],
  now = Date.now(),
): Promise<boolean> {
  inspectMeshCoreIdentity(bytes);
  inspectBushMeshConvoy(bytes, now);

  if (!activeRuntime) {
    return false;
  }

  return activeRuntime.acceptMeshCoreFrame(bytes, now);
}
