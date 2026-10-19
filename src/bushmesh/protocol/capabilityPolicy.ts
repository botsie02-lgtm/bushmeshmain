import {Buffer} from 'buffer';

import {
  BUSHMESH_PROTOCOL_VERSION,
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
} from './codec';
import {
  BushMeshCapability,
  BushMeshNodeHello,
  hasBushMeshCapability,
  negotiateBushMeshCapabilities,
} from './discovery';
import {encodeSemanticMessage} from './semantic';
import {tryParseSemanticText} from './semanticText';
import {compareDictionaryCompression} from './textDictionary';
import {encodeBushMeshWire} from './transport';

export type BushMeshPeerPolicy = {
  compatible: boolean;
  protocolVersion: number | null;
  capabilities: number;
  transport: 'text-safe' | 'binary';
  allowSemantic: boolean;
  allowDictionary: boolean;
  allowFragmentation: boolean;
  allowSelectiveAck: boolean;
  allowStoreAndForward: boolean;
  allowLocationDelta: boolean;
  allowFileTransfer: boolean;
  allowRouting: boolean;
};

export type BushMeshPeerPolicyOptions = {
  allowExperimentalBinary?: boolean;
};

export function negotiateBushMeshPeerPolicy(
  local: BushMeshNodeHello,
  remote: BushMeshNodeHello,
  options?: BushMeshPeerPolicyOptions,
): BushMeshPeerPolicy {
  const minimum = Math.max(local.protocolMinVersion, remote.protocolMinVersion);
  const maximum = Math.min(local.protocolMaxVersion, remote.protocolMaxVersion);
  const protocolVersion = minimum <= maximum ? maximum : null;
  const capabilities = negotiateBushMeshCapabilities(
    local.capabilities,
    remote.capabilities,
  );
  const supportsCurrentVersion =
    protocolVersion !== null &&
    BUSHMESH_PROTOCOL_VERSION >= minimum &&
    BUSHMESH_PROTOCOL_VERSION <= maximum;
  const canUseBinary =
    options?.allowExperimentalBinary === true &&
    hasBushMeshCapability(capabilities, BushMeshCapability.BinaryTransport);

  return {
    compatible: supportsCurrentVersion,
    protocolVersion: supportsCurrentVersion ? BUSHMESH_PROTOCOL_VERSION : null,
    capabilities,
    transport: canUseBinary ? 'binary' : 'text-safe',
    allowSemantic: hasBushMeshCapability(
      capabilities,
      BushMeshCapability.SemanticMessages,
    ),
    allowDictionary: hasBushMeshCapability(
      capabilities,
      BushMeshCapability.DictionaryText,
    ),
    allowFragmentation: hasBushMeshCapability(
      capabilities,
      BushMeshCapability.Fragmentation,
    ),
    allowSelectiveAck: hasBushMeshCapability(
      capabilities,
      BushMeshCapability.SelectiveAck,
    ),
    allowStoreAndForward: hasBushMeshCapability(
      capabilities,
      BushMeshCapability.StoreAndForward,
    ),
    allowLocationDelta: hasBushMeshCapability(
      capabilities,
      BushMeshCapability.LocationDelta,
    ),
    allowFileTransfer: hasBushMeshCapability(
      capabilities,
      BushMeshCapability.FileTransfer,
    ),
    allowRouting: hasBushMeshCapability(
      capabilities,
      BushMeshCapability.LinkRouting,
    ),
  };
}

export type BushMeshPeerEncodedText = {
  wireBytes: number[];
  compression: BushMeshCompressionProfile;
  originalByteLength: number;
  payloadByteLength: number;
};

export function encodeTextForBushMeshPeer(
  text: string,
  messageId: number,
  policy: BushMeshPeerPolicy,
  options?: {
    priority?: BushMeshPriority;
    ackRequested?: boolean;
    storeAndForward?: boolean;
    ttlHops?: number;
  },
): BushMeshPeerEncodedText {
  if (!policy.compatible) {
    throw new Error('Remote node does not support the current Bushmesh protocol version.');
  }

  const rawBytes = Array.from(Buffer.from(text, 'utf8'));
  let payload = rawBytes;
  let compression = BushMeshCompressionProfile.Raw;

  if (policy.allowDictionary) {
    const compared = compareDictionaryCompression(text);
    if (compared.useDictionary) {
      payload = compared.dictionaryBytes;
      compression = BushMeshCompressionProfile.TextDictionary;
    }
  }

  if (policy.allowSemantic) {
    const semantic = tryParseSemanticText(text);
    if (semantic) {
      const semanticPayload = encodeSemanticMessage(semantic);
      if (semanticPayload.length < payload.length) {
        payload = semanticPayload;
        compression = BushMeshCompressionProfile.Semantic;
      }
    }
  }

  const requestedStoreAndForward = options?.storeAndForward ?? false;
  const storeAndForward =
    requestedStoreAndForward && policy.allowStoreAndForward;

  const wireBytes = encodeBushMeshWire({
    version: policy.protocolVersion ?? BUSHMESH_PROTOCOL_VERSION,
    type: BushMeshPacketType.Message,
    priority: options?.priority ?? BushMeshPriority.DirectMessage,
    compression,
    messageId,
    ackRequested: options?.ackRequested ?? true,
    storeAndForward,
    ttlHops: storeAndForward ? options?.ttlHops : undefined,
    payload,
  });

  return {
    wireBytes,
    compression,
    originalByteLength: rawBytes.length,
    payloadByteLength: payload.length,
  };
}
