import {
  BushMeshControlCommand,
  BushMeshControlPacket,
  BushMeshPriority,
  BushMeshSyncNamespace,
  LocationPrecision,
  encodeBushMeshControlWire,
  encodeBushMeshRoutedWire,
} from '../protocol';
import {getActiveBushMeshRuntime} from './BushMeshRuntimeHub';

export type BushMeshPeerActionResult = {
  controlMessageId: number;
  routedMessageId: number;
  frameCount: number;
  fragmented: boolean;
  transport: 'text-safe' | 'binary';
};

async function sendPeerControl(
  channelIndex: number,
  sourceNodeId: number,
  destinationNodeId: number,
  control: BushMeshControlPacket,
  options?: {ttlHops?: number},
): Promise<BushMeshPeerActionResult> {
  if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 255) {
    throw new Error('BushMesh peer action channel must be from 0 to 255.');
  }
  if (!Number.isInteger(sourceNodeId) || sourceNodeId < 0 || sourceNodeId > 0xffffffff) {
    throw new Error('BushMesh source node ID is invalid.');
  }
  if (
    !Number.isInteger(destinationNodeId) ||
    destinationNodeId < 0 ||
    destinationNodeId > 0xffffffff
  ) {
    throw new Error('BushMesh destination node ID is invalid.');
  }
  if (sourceNodeId === destinationNodeId) {
    throw new Error('BushMesh peer action destination cannot be the local node.');
  }

  const network = getActiveBushMeshRuntime();
  if (!network || !network.isRunning()) {
    throw new Error('BushMesh networking runtime is not active.');
  }

  const controlMessageId = network.nextMessageId();
  const innerWireBytes = encodeBushMeshControlWire(control, controlMessageId);
  const routedMessageId = network.nextMessageId();
  const routedWireBytes = encodeBushMeshRoutedWire(
    {
      sourceNodeId,
      destinationNodeId,
      innerWireBytes,
    },
    routedMessageId,
    {
      ttlHops: options?.ttlHops ?? 4,
      priority: BushMeshPriority.DirectMessage,
    },
  );

  const sent = await network.sendWire(channelIndex, routedWireBytes);
  return {
    controlMessageId,
    routedMessageId,
    frameCount: sent.frameCount,
    fragmented: sent.fragmented,
    transport: sent.transport,
  };
}

export function requestBushMeshPeerNodeInfo(
  channelIndex: number,
  sourceNodeId: number,
  destinationNodeId: number,
): Promise<BushMeshPeerActionResult> {
  return sendPeerControl(channelIndex, sourceNodeId, destinationNodeId, {
    command: BushMeshControlCommand.RequestNodeHello,
  });
}

export function requestBushMeshPeerLocation(
  channelIndex: number,
  sourceNodeId: number,
  destinationNodeId: number,
  options?: {
    precision?: LocationPrecision;
    maxAgeSeconds?: number;
    forceAbsolute?: boolean;
  },
): Promise<BushMeshPeerActionResult> {
  const control: BushMeshControlPacket = options?.forceAbsolute
    ? {command: BushMeshControlCommand.RequestAbsoluteLocation}
    : {
        command: BushMeshControlCommand.RequestLocation,
        precision: options?.precision ?? LocationPrecision.Approx10M,
        maxAgeSeconds: options?.maxAgeSeconds ?? 300,
      };

  return sendPeerControl(
    channelIndex,
    sourceNodeId,
    destinationNodeId,
    control,
  );
}

export function requestBushMeshPeerSync(
  channelIndex: number,
  sourceNodeId: number,
  destinationNodeId: number,
  namespace: BushMeshSyncNamespace = BushMeshSyncNamespace.Messages,
): Promise<BushMeshPeerActionResult> {
  return sendPeerControl(channelIndex, sourceNodeId, destinationNodeId, {
    command: BushMeshControlCommand.RequestSync,
    namespace,
  });
}
