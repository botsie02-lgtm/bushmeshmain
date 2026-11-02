import {Buffer} from 'buffer';

import {
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
import {classifyBushMeshDatagramPayload} from './securityWire';
import {tryParseSemanticText} from './semanticText';
import {
  compareDictionaryCompression,
  decodeDictionaryText,
} from './textDictionary';
import {assertBushMeshEnvelopeCompatibility} from './versioning';

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
    throw new Error('Not a BushMesh wire message.');
  }

  const envelope = decodeEnvelope(bytes.slice(2));
  assertBushMeshEnvelopeCompatibility(envelope);

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
    semantic?: boolean;
  },
): EncodedBushMeshTextMessage {
  const compared = compareDictionaryCompression(text);
  let compression = compared.useDictionary
    ? BushMeshCompressionProfile.TextDictionary
    : BushMeshCompressionProfile.Raw;
  let payload = compared.useDictionary
    ? compared.dictionaryBytes
    : compared.rawBytes;

  if (options?.semantic !== false) {
    const semantic = tryParseSemanticText(text);

    if (semantic) {
      const semanticPayload = encodeSemanticMessage(semantic);

      if (semanticPayload.length < payload.length) {
        compression = BushMeshCompressionProfile.Semantic;
        payload = semanticPayload;
      }
    }
  }

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
    throw new Error('Not a BushMesh text carrier.');
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

/**
 * Fragment a complete final BushMesh datagram payload. For protected traffic the
 * caller MUST first serialize the B5 53 Security container, then fragment those
 * bytes. Fragment wrappers are ordinary B5 4D packets and are not end-to-end
 * Security AAD. Their CRC/ACK semantics cover fragment receipt/corruption only.
 */
export function fragmentBushMeshDatagramPayload(
  datagramPayload: number[],
  messageId: number,
  maxFragmentDataBytes = 40,
  priority = BushMeshPriority.DirectMessage,
): number[][] {
  const classification = classifyBushMeshDatagramPayload(datagramPayload);
  if (classification.kind === 'unknown') {
    throw new Error(
      'BushMesh fragmentation requires a complete ordinary or Security-container datagram.',
    );
  }
  return fragmentPayload(messageId, datagramPayload, maxFragmentDataBytes).map(
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

/** @deprecated Name retained for source compatibility; use fragmentBushMeshDatagramPayload. */
export function fragmentBushMeshWireMessage(
  wireBytes: number[],
  messageId: number,
  maxFragmentDataBytes = 40,
  priority = BushMeshPriority.DirectMessage,
): number[][] {
  return fragmentBushMeshDatagramPayload(
    wireBytes,
    messageId,
    maxFragmentDataBytes,
    priority,
  );
}

export type BushMeshDatagramFragmentAcceptResult = {
  complete: boolean;
  datagramPayload?: number[];
  reassembly?: ReassemblyProgress;
};

/**
 * Canonical byte-level fragment reassembler. It deliberately does not decrypt
 * or decode the completed logical datagram. Reassembly finishes before Security
 * replay/authentication checks for B5 53 protected traffic.
 */
export class BushMeshDatagramFragmentReassembler {
  private readonly fragments: BushMeshFragmentReassembler;

  constructor(timeoutMs = 120000) {
    this.fragments = new BushMeshFragmentReassembler(timeoutMs);
  }

  accept(fragmentWireBytes: number[], now = Date.now()): BushMeshDatagramFragmentAcceptResult {
    const decoded = decodeBushMeshWire(fragmentWireBytes);
    if (decoded.envelope.type !== BushMeshPacketType.Fragment) {
      return {complete: true, datagramPayload: [...fragmentWireBytes]};
    }

    const reassembly = this.fragments.accept(decoded.envelope.payload, now);
    if (!reassembly.complete || !reassembly.data) {
      return {complete: false, reassembly};
    }

    const classification = classifyBushMeshDatagramPayload(reassembly.data);
    if (classification.kind === 'unknown') {
      throw new Error('Reassembled fragments do not contain a valid BushMesh datagram.');
    }
    return {
      complete: true,
      datagramPayload: [...reassembly.data],
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

export type BushMeshFrameAcceptResult = {
  complete: boolean;
  decoded?: DecodedBushMeshWireMessage;
  /** Complete ordinary or protected datagram bytes after fragment reassembly. */
  datagramPayload?: number[];
  reassembly?: ReassemblyProgress;
};

/**
 * Compatibility reassembler. New integration code should use
 * BushMeshDatagramFragmentReassembler and pass completed bytes to
 * BushMeshDatagramRuntime.acceptInbound().
 */
export class BushMeshWireReassembler {
  private readonly datagrams: BushMeshDatagramFragmentReassembler;

  constructor(timeoutMs = 120000) {
    this.datagrams = new BushMeshDatagramFragmentReassembler(timeoutMs);
  }

  accept(wireBytes: number[], now = Date.now()): BushMeshFrameAcceptResult {
    const result = this.datagrams.accept(wireBytes, now);
    if (!result.complete || !result.datagramPayload) {
      return {complete: false, reassembly: result.reassembly};
    }

    const classification = classifyBushMeshDatagramPayload(result.datagramPayload);
    if (classification.kind === 'ordinary-bushmesh') {
      return {
        complete: true,
        decoded: decodeBushMeshWire(result.datagramPayload),
        datagramPayload: result.datagramPayload,
        reassembly: result.reassembly,
      };
    }

    return {
      complete: true,
      datagramPayload: result.datagramPayload,
      reassembly: result.reassembly,
    };
  }

  getMissing(messageId: number): number[] | null {
    return this.datagrams.getMissing(messageId);
  }

  pruneExpired(now = Date.now()): number[] {
    return this.datagrams.pruneExpired(now);
  }

  reset(messageId?: number): void {
    this.datagrams.reset(messageId);
  }
}
