import {BushMeshCompressionProfile, BushMeshPriority} from './codec';
import {encodeBushMeshTextMessage} from './transport';

export type BushMeshEncodedTextWire = {
  wireBytes: number[];
  compression: BushMeshCompressionProfile;
  originalByteLength: number;
  payloadByteLength: number;
};

/**
 * Carrier-neutral text-message encoder for the stable protocol facade.
 *
 * Compatibility carriers such as `~BM1:` are deliberately omitted from this
 * result. Adapters may use the broader transport helpers internally.
 */
export function encodeBushMeshTextWire(
  text: string,
  messageId: number,
  options?: {
    priority?: BushMeshPriority;
    ackRequested?: boolean;
    storeAndForward?: boolean;
    ttlHops?: number;
    semantic?: boolean;
  },
): BushMeshEncodedTextWire {
  const encoded = encodeBushMeshTextMessage(text, messageId, options);
  return {
    wireBytes: [...encoded.wireBytes],
    compression: encoded.compression,
    originalByteLength: encoded.originalByteLength,
    payloadByteLength: encoded.payloadByteLength,
  };
}
