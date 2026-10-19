import {Buffer} from 'buffer';

import {
  BushMeshPeerPolicy,
  BushMeshPriority,
  BushMeshWireReassembler,
  DecodedBushMeshWireMessage,
  encodeBushMeshTextCarrier,
  encodeBushMeshTextMessage,
  encodeTextForBushMeshPeer,
  fragmentBushMeshWireMessage,
  tryDecodeBushMeshChannelPayload,
} from '../bushmesh/protocol';
import {
  MESHCORE_CHANNEL_PAYLOAD_MAX_BYTES,
  buildSendChannelPayloadCommand,
} from './meshcoreCommands';

export type MeshCoreBushMeshChannelFrame = {
  channelIndex: number;
  pathLength: number;
  textType: number;
  timestamp: number | null;
  payloadBytes: number[];
  decoded: DecodedBushMeshWireMessage;
};

export type BushMeshChannelTransport = 'text-safe' | 'binary';

export type PreparedBushMeshChannelFrame = {
  transport: BushMeshChannelTransport;
  payloadBytes: number[];
  text?: string;
  wireBytes: number[];
  fragmented: boolean;
};

export type BushMeshChannelSendClient = {
  sendChannelMessage: (channelIndex: number, message: string) => Promise<unknown>;
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

function wireToTransportFrame(
  wireBytes: number[],
  transport: BushMeshChannelTransport,
  fragmented: boolean,
): PreparedBushMeshChannelFrame {
  if (transport === 'binary') {
    return {
      transport,
      payloadBytes: wireBytes,
      wireBytes,
      fragmented,
    };
  }

  const text = encodeBushMeshTextCarrier(wireBytes);
  return {
    transport,
    payloadBytes: Array.from(Buffer.from(text, 'utf8')),
    text,
    wireBytes,
    fragmented,
  };
}

function fragmentToPayloadLimit(
  wireBytes: number[],
  messageId: number,
  priority: BushMeshPriority,
  transport: BushMeshChannelTransport,
  maxPayloadBytes: number,
): PreparedBushMeshChannelFrame[] {
  const maxCandidate = Math.min(80, wireBytes.length);

  for (let dataBytes = maxCandidate; dataBytes >= 1; dataBytes -= 1) {
    const fragmentedWireFrames = fragmentBushMeshWireMessage(
      wireBytes,
      messageId,
      dataBytes,
      priority,
    );
    const prepared = fragmentedWireFrames.map(fragmentWireBytes =>
      wireToTransportFrame(fragmentWireBytes, transport, true),
    );

    if (prepared.every(frame => frame.payloadBytes.length <= maxPayloadBytes)) {
      return prepared;
    }
  }

  throw new Error('Unable to fit Bushmesh fragments into MeshCore payload limit.');
}

export function prepareBushMeshWireChannelFrames(
  wireBytes: number[],
  messageId: number,
  options?: {
    transport?: BushMeshChannelTransport;
    priority?: BushMeshPriority;
    maxPayloadBytes?: number;
    allowFragmentation?: boolean;
  },
): PreparedBushMeshChannelFrame[] {
  const transport = options?.transport ?? 'text-safe';
  const priority = options?.priority ?? BushMeshPriority.DirectMessage;
  const maxPayloadBytes =
    options?.maxPayloadBytes ?? MESHCORE_CHANNEL_PAYLOAD_MAX_BYTES;
  const single = wireToTransportFrame(wireBytes, transport, false);

  if (single.payloadBytes.length <= maxPayloadBytes) {
    return [single];
  }

  if (options?.allowFragmentation === false) {
    throw new Error(
      'Bushmesh wire message exceeds MeshCore payload limit and fragmentation is disabled.',
    );
  }

  return fragmentToPayloadLimit(
    wireBytes,
    messageId,
    priority,
    transport,
    maxPayloadBytes,
  );
}

export function prepareBushMeshTextChannelFrames(
  text: string,
  messageId: number,
  options?: {
    transport?: BushMeshChannelTransport;
    priority?: BushMeshPriority;
    ackRequested?: boolean;
    storeAndForward?: boolean;
    ttlHops?: number;
    maxPayloadBytes?: number;
    semantic?: boolean;
  },
): PreparedBushMeshChannelFrame[] {
  const encoded = encodeBushMeshTextMessage(text, messageId, options);
  return prepareBushMeshWireChannelFrames(encoded.wireBytes, messageId, {
    transport: options?.transport,
    priority: options?.priority,
    maxPayloadBytes: options?.maxPayloadBytes,
  });
}

export function prepareBushMeshPeerTextChannelFrames(
  text: string,
  messageId: number,
  policy: BushMeshPeerPolicy,
  options?: {
    priority?: BushMeshPriority;
    ackRequested?: boolean;
    storeAndForward?: boolean;
    ttlHops?: number;
    maxPayloadBytes?: number;
  },
): PreparedBushMeshChannelFrame[] {
  if (!policy.compatible) {
    throw new Error('Cannot prepare Bushmesh frames for an incompatible peer.');
  }

  const encoded = encodeTextForBushMeshPeer(text, messageId, policy, options);
  return prepareBushMeshWireChannelFrames(encoded.wireBytes, messageId, {
    transport: policy.transport,
    priority: options?.priority,
    maxPayloadBytes: options?.maxPayloadBytes,
    allowFragmentation: policy.allowFragmentation,
  });
}

export async function sendBushMeshTextSafeChannelMessage(
  client: BushMeshChannelSendClient,
  channelIndex: number,
  text: string,
  messageId: number,
  options?: {
    priority?: BushMeshPriority;
    ackRequested?: boolean;
    storeAndForward?: boolean;
    ttlHops?: number;
    maxPayloadBytes?: number;
    semantic?: boolean;
  },
): Promise<unknown[]> {
  const frames = prepareBushMeshTextChannelFrames(text, messageId, {
    ...options,
    transport: 'text-safe',
  });
  const results: unknown[] = [];

  for (const frame of frames) {
    if (!frame.text) {
      throw new Error('Text-safe Bushmesh frame is missing carrier text.');
    }

    results.push(await client.sendChannelMessage(channelIndex, frame.text));
  }

  return results;
}

export function buildBushMeshBinaryChannelCommands(
  channelIndex: number,
  text: string,
  messageId: number,
  options?: {
    priority?: BushMeshPriority;
    ackRequested?: boolean;
    storeAndForward?: boolean;
    ttlHops?: number;
    maxPayloadBytes?: number;
    timestampSeconds?: number;
    semantic?: boolean;
  },
): string[] {
  const frames = prepareBushMeshTextChannelFrames(text, messageId, {
    ...options,
    transport: 'binary',
  });
  const timestampSeconds = options?.timestampSeconds;

  return frames.map(frame =>
    buildSendChannelPayloadCommand(
      channelIndex,
      frame.payloadBytes,
      timestampSeconds,
    ),
  );
}

export function tryDecodeBushMeshChannelFrame(
  bytes: number[],
): MeshCoreBushMeshChannelFrame | null {
  const packetType = bytes[0];

  if (packetType !== 0x08 && packetType !== 0x11) {
    return null;
  }

  const isV3 = packetType === 0x11;
  const offset = isV3 ? 4 : 1;

  if (bytes.length < offset + 7) {
    return null;
  }

  const channelIndex = bytes[offset];
  const pathLength = bytes[offset + 1];
  const textType = bytes[offset + 2];
  const timestamp = readUInt32LE(bytes, offset + 3);
  const payloadBytes = bytes.slice(offset + 7);
  const text = Buffer.from(payloadBytes)
    .toString('utf8')
    .replace(/\0/g, '')
    .trim();
  const decoded = tryDecodeBushMeshChannelPayload(payloadBytes, text);

  if (!decoded) {
    return null;
  }

  return {
    channelIndex,
    pathLength,
    textType,
    timestamp,
    payloadBytes,
    decoded,
  };
}

export type MeshCoreBushMeshReassemblyResult = {
  channelFrame: MeshCoreBushMeshChannelFrame;
  complete: boolean;
  decoded?: DecodedBushMeshWireMessage;
  missingFragments?: number[];
};

export class MeshCoreBushMeshReassembler {
  private readonly reassembler: BushMeshWireReassembler;

  constructor(timeoutMs = 120000) {
    this.reassembler = new BushMeshWireReassembler(timeoutMs);
  }

  acceptMeshCoreFrame(
    bytes: number[],
    now = Date.now(),
  ): MeshCoreBushMeshReassemblyResult | null {
    const channelFrame = tryDecodeBushMeshChannelFrame(bytes);

    if (!channelFrame) {
      return null;
    }

    const result = this.reassembler.accept(channelFrame.decoded.wireBytes, now);

    return {
      channelFrame,
      complete: result.complete,
      decoded: result.decoded,
      missingFragments: result.reassembly?.missingFragments,
    };
  }

  getMissing(messageId: number): number[] | null {
    return this.reassembler.getMissing(messageId);
  }

  pruneExpired(now = Date.now()): number[] {
    return this.reassembler.pruneExpired(now);
  }

  reset(messageId?: number): void {
    this.reassembler.reset(messageId);
  }
}
