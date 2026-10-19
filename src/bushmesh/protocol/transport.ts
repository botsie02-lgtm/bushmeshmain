import {Buffer} from 'buffer';

import {
  BUSHMESH_PROTOCOL_VERSION,
  BushMeshCompressionProfile,
  BushMeshEnvelope,
  BushMeshPacketType,
  BushMeshPriority,
  DecodedBushMeshEnvelope,
  decodeEnvelope,
  encodeEnvelope,
} from './codec';
import {
  BushMeshFragmentReassembler,
  ReassemblyProgress,
  fragmentPayload,
} from './fragmentation';
import {
  SemanticMessage,
  decodeSemanticMessage,
  encodeSemanticMessage,
  renderSemanticMessage,
} from './semantic';
import {
  compareDictionaryCompression,
  decodeDictionaryText,
} from './textDictionary';

export const BUSHMESH_WIRE_MAGIC = [0xb5, 0x4d] as const;
export const BUSHMESH_TEXT_CARRIER_PREFIX = '~BM1:';

export type DecodedBushMeshWireMessage = {
  envelope: DecodedBushMeshEnvelope;
  wireBytes: number[];
  renderedText?: string;
  semantic?: SemanticMessage;
};

export type EncodedBushMeshTextMessage = {
  wireBytes: number[];
  textSafeCarrier: string;
  compression: BushMeshCompressionProfile;
  originalByteLength: number;
  payloadByteLength: number;
};

export function encodeBushMeshWire(envelope: BushMeshEnvelope): number[] {
  return [...BUSHMESH_WIRE_MAGIC, ...encodeEnvelope(envelope)];
}

export function decodeBushMeshWire(bytes: number[]): DecodedBushMeshWireMessage {
  if (
    bytes.length < 5 ||
    bytes[0] !== BUSHMESH_WIRE_MAGIC[0] ||
    bytes[1] !== BUSHMESH_WIRE_MAGIC[1]
  ) {
    throw new Error('Not a Bushmesh wire message.');
  }

  const envelope = decodeEnvelope(bytes.slice(2));

  if (envelope.version !== BUSHMESH_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Bushmesh protocol version ${envelope.version}.`);
  }

  const decoded: DecodedBushMeshWireMessage = {
    envelope,
    wireBytes: [...bytes],
  };

  if (envelope.type === BushMeshPacketType.Message) {
    if (envelope.compression === BushMeshCompressionProfile.Raw) {
      decoded.renderedText = Buffer.from(envelope.payload).toString('utf8');
    } else if (
      envelope.compression === BushMeshCompressionProfile.TextDictionary
    ) {
      decoded.renderedText = decodeDictionaryText(envelope.payload);
    } else if (envelope.compression === BushMeshCompressionProfile.Semantic) {
      decoded.semantic = decodeSemanticMessage(envelope.payload);
      decoded.renderedText = renderSemanticMessage(decoded.semantic);
    }
  }

  return decoded;
}

export function encodeBushMeshTextMessage(
  text: string,
  messageId: number,
  options?: {
    priority?: BushMeshPriority;
    ackRequested?: boolean;
    storeAndForward?: boolean;
    ttlHops?: number;
  },
): EncodedBushMeshTextMessage {
  const compared = compareDictionaryCompression(text);
  const compression = compared.useDictionary
    ? BushMeshCompressionProfile.TextDictionary
    : BushMeshCompressionProfile.Raw;
  const payload = compared.useDictionary
    ? compared.dictionaryBytes
    : compared.rawBytes;

  const wireBytes = encodeBushMeshWire({
    type: BushMeshPacketType.Message,
    priority: options?.priority ?? BushMeshPriority.DirectMessage,
    compression,
    messageId,
    ackRequested: options?.ackRequested ?? true,
    storeAndForward: options?.storeAndForward ?? false,
    ttlHops: options?.ttlHops,
    payload,
  });

  return {
    wireBytes,
    textSafeCarrier: encodeBushMeshTextCarrier(wireBytes),
    compression,
    originalByteLength: compared.rawBytes.length,
    payloadByteLength: payload.length,
  };
}

export function encodeBushMeshSemanticMessage(
  semantic: SemanticMessage,
  messageId: number,
  options?: {
    priority?: BushMeshPriority;
    ackRequested?: boolean;
    storeAndForward?: boolean;
    ttlHops?: number;
  },
): DecodedBushMeshWireMessage {
  const wireBytes = encodeBushMeshWire({
    type: BushMeshPacketType.Message,
    priority: options?.priority ?? BushMeshPriority.DirectMessage,
    compression: BushMeshCompressionProfile.Semantic,
    messageId,
    ackRequested: options?.ackRequested ?? true,
    storeAndForward: options?.storeAndForward ?? false,
    ttlHops: options?.ttlHops,
    payload: encodeSemanticMessage(semantic),
  });

  return decodeBushMeshWire(wireBytes);
}

export function encodeBushMeshTextCarrier(wireBytes: number[]): string {
  const base64 = Buffer.from(wireBytes).toString('base64');
  const base64Url = base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${BUSHMESH_TEXT_CARRIER_PREFIX}${base64Url}`;
}

export function decodeBushMeshTextCarrier(text: string): number[] {
  if (!text.startsWith(BUSHMESH_TEXT_CARRIER_PREFIX)) {
    throw new Error('Not a Bushmesh text carrier.');
  }

  const base64Url = text.slice(BUSHMESH_TEXT_CARRIER_PREFIX.length);
  const padded = base64Url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64Url.length / 4) * 4, '=');

  return Array.from(Buffer.from(padded, 'base64'));
}

export function tryDecodeBushMeshChannelPayload(
  payloadBytes: number[],
  text?: string,
): DecodedBushMeshWireMessage | null {
  try {
    if (
      payloadBytes[0] === BUSHMESH_WIRE_MAGIC[0] &&
      payloadBytes[1] === BUSHMESH_WIRE_MAGIC[1]
    ) {
      return decodeBushMeshWire(payloadBytes);
    }

    const candidateText = text ?? Buffer.from(payloadBytes).toString('utf8');

    if (candidateText.startsWith(BUSHMESH_TEXT_CARRIER_PREFIX)) {
      return decodeBushMeshWire(decodeBushMeshTextCarrier(candidateText));
    }
  } catch {
    return null;
  }

  return null;
}

export function fragmentBushMeshWireMessage(
  wireBytes: number[],
  messageId: number,
  maxFragmentDataBytes = 40,
  priority = BushMeshPriority.DirectMessage,
): number[][] {
  return fragmentPayload(messageId, wireBytes, maxFragmentDataBytes).map(
    fragment =>
      encodeBushMeshWire({
        type: BushMeshPacketType.Fragment,
        priority,
        compression: BushMeshCompressionProfile.CompressedBinary,
        messageId,
        ackRequested: true,
        payload: fragment.bytes,
      }),
  );
}

export type BushMeshFrameAcceptResult = {
  complete: boolean;
  decoded?: DecodedBushMeshWireMessage;
  reassembly?: ReassemblyProgress;
};

export class BushMeshWireReassembler {
  private readonly fragments: BushMeshFragmentReassembler;

  constructor(timeoutMs = 120000) {
    this.fragments = new BushMeshFragmentReassembler(timeoutMs);
  }

  accept(wireBytes: number[], now = Date.now()): BushMeshFrameAcceptResult {
    const decoded = decodeBushMeshWire(wireBytes);

    if (decoded.envelope.type !== BushMeshPacketType.Fragment) {
      return {complete: true, decoded};
    }

    const reassembly = this.fragments.accept(decoded.envelope.payload, now);

    if (!reassembly.complete || !reassembly.data) {
      return {complete: false, reassembly};
    }

    return {
      complete: true,
      decoded: decodeBushMeshWire(reassembly.data),
      reassembly,
    };
  }

  getMissing(messageId: number): number[] | null {
    return this.fragments.getMissing(messageId);
  }

  pruneExpired(now = Date.now()): number[] {
    return this.fragments.pruneExpired(now);
  }

  reset(messageId?: number): void {
    this.fragments.reset(messageId);
  }
}
