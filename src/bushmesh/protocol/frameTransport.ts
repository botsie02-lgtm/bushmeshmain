import {Buffer} from 'buffer';

import {BushMeshPeerPolicy, encodeTextForBushMeshPeer} from './capabilityPolicy';
import {BushMeshPriority} from './codec';
import {
  DecodedBushMeshWireMessage,
  encodeBushMeshTextCarrier,
  encodeBushMeshTextMessage,
  fragmentBushMeshWireMessage,
  tryDecodeBushMeshChannelPayload,
} from './transport';

export type BushMeshCarrierMode = 'text-safe' | 'binary';

export type BushMeshPreparedTransportFrame = {
  carrier: BushMeshCarrierMode;
  payloadBytes: number[];
  text?: string;
  wireBytes: number[];
  fragmented: boolean;
};

export type BushMeshInboundTransportFrame = {
  channelIndex: number;
  payloadBytes: number[];
  text?: string;
  carrier?: BushMeshCarrierMode;
  decoded?: DecodedBushMeshWireMessage;
};

export type BushMeshDecodedInboundTransportFrame =
  BushMeshInboundTransportFrame & {
    decoded: DecodedBushMeshWireMessage;
  };

function wireToTransportFrame(
  wireBytes: number[],
  carrier: BushMeshCarrierMode,
  fragmented: boolean,
): BushMeshPreparedTransportFrame {
  if (carrier === 'binary') {
    return {
      carrier,
      payloadBytes: [...wireBytes],
      wireBytes: [...wireBytes],
      fragmented,
    };
  }

  const text = encodeBushMeshTextCarrier(wireBytes);
  return {
    carrier,
    payloadBytes: Array.from(Buffer.from(text, 'utf8')),
    text,
    wireBytes: [...wireBytes],
    fragmented,
  };
}

function fragmentToPayloadLimit(
  wireBytes: number[],
  messageId: number,
  priority: BushMeshPriority,
  carrier: BushMeshCarrierMode,
  maxPayloadBytes: number,
): BushMeshPreparedTransportFrame[] {
  const maxCandidate = Math.min(80, wireBytes.length);

  for (let dataBytes = maxCandidate; dataBytes >= 1; dataBytes -= 1) {
    const fragmentedWireFrames = fragmentBushMeshWireMessage(
      wireBytes,
      messageId,
      dataBytes,
      priority,
    );
    const prepared = fragmentedWireFrames.map(fragmentWireBytes =>
      wireToTransportFrame(fragmentWireBytes, carrier, true),
    );

    if (prepared.every(frame => frame.payloadBytes.length <= maxPayloadBytes)) {
      return prepared;
    }
  }

  throw new Error('Unable to fit BushMesh fragments into the transport payload limit.');
}

export function prepareBushMeshWireFrames(
  wireBytes: number[],
  messageId: number,
  options: {
    carrier?: BushMeshCarrierMode;
    priority?: BushMeshPriority;
    maxPayloadBytes: number;
    allowFragmentation?: boolean;
  },
): BushMeshPreparedTransportFrame[] {
  if (!Number.isInteger(options.maxPayloadBytes) || options.maxPayloadBytes < 1) {
    throw new Error('BushMesh transport payload limit must be a positive integer.');
  }

  const carrier = options.carrier ?? 'text-safe';
  const priority = options.priority ?? BushMeshPriority.DirectMessage;
  const single = wireToTransportFrame(wireBytes, carrier, false);

  if (single.payloadBytes.length <= options.maxPayloadBytes) {
    return [single];
  }

  if (options.allowFragmentation === false) {
    throw new Error(
      'BushMesh wire message exceeds the transport payload limit and fragmentation is disabled.',
    );
  }

  return fragmentToPayloadLimit(
    wireBytes,
    messageId,
    priority,
    carrier,
    options.maxPayloadBytes,
  );
}

export function prepareBushMeshTextFrames(
  text: string,
  messageId: number,
  options: {
    maxPayloadBytes: number;
    carrier?: BushMeshCarrierMode;
    priority?: BushMeshPriority;
    ackRequested?: boolean;
    storeAndForward?: boolean;
    ttlHops?: number;
    semantic?: boolean;
    allowFragmentation?: boolean;
  },
): BushMeshPreparedTransportFrame[] {
  const encoded = encodeBushMeshTextMessage(text, messageId, options);
  return prepareBushMeshWireFrames(encoded.wireBytes, messageId, {
    carrier: options.carrier,
    priority: options.priority,
    maxPayloadBytes: options.maxPayloadBytes,
    allowFragmentation: options.allowFragmentation,
  });
}

export function prepareBushMeshPeerTextFrames(
  text: string,
  messageId: number,
  policy: BushMeshPeerPolicy,
  options: {
    maxPayloadBytes: number;
    priority?: BushMeshPriority;
    ackRequested?: boolean;
    storeAndForward?: boolean;
    ttlHops?: number;
  },
): BushMeshPreparedTransportFrame[] {
  if (!policy.compatible) {
    throw new Error('Cannot prepare BushMesh frames for an incompatible peer.');
  }

  const encoded = encodeTextForBushMeshPeer(text, messageId, policy, options);
  return prepareBushMeshWireFrames(encoded.wireBytes, messageId, {
    carrier: policy.transport,
    priority: options.priority,
    maxPayloadBytes: options.maxPayloadBytes,
    allowFragmentation: policy.allowFragmentation,
  });
}

export function decodeBushMeshInboundTransportFrame(
  frame: BushMeshInboundTransportFrame,
): BushMeshDecodedInboundTransportFrame | null {
  const decoded =
    frame.decoded ??
    tryDecodeBushMeshChannelPayload(frame.payloadBytes, frame.text);

  if (!decoded) {
    return null;
  }

  return {
    ...frame,
    carrier:
      frame.carrier ??
      (frame.payloadBytes[0] === 0xb5 && frame.payloadBytes[1] === 0x4d
        ? 'binary'
        : 'text-safe'),
    decoded,
  };
}
