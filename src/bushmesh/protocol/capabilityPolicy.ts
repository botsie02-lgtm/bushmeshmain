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
import {
  BUSHMESH_TEXT_DICTIONARY_VERSION,
  compareDictionaryCompression,
} from './textDictionary';
import {encodeBushMeshWire} from './transport';
import {negotiateBushMeshProtocolRanges} from './versioning';

export type BushMeshPeerPolicy = {
  compatible: boolean;
  protocolVersion: number | null;
  capabilities: number;
  transport: 'text-safe' | 'binary';
  allowSemantic: boolean;
  allowDictionary: boolean;
  dictionaryVersion: number | null;
  allowFragmentation: boolean;
  allowSelectiveAck: boolean;
  allowStoreAndForward: boolean;
  allowLocationDelta: boolean;
  allowSensorDelta: boolean;
  allowCompressedBinary: boolean;
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
  const compatibility = negotiateBushMeshProtocolRanges(
    local.protocolMinVersion,
    local.protocolMaxVersion,
    remote.protocolMinVersion,
    remote.protocolMaxVersion,
  );
  const protocolVersion = compatibility.negotiatedVersion;
  const capabilities = compatibility.compatible
    ? negotiateBushMeshCapabilities(local.capabilities, remote.capabilities)
    : 0;
  const canUseBinary =
    compatibility.compatible &&
    options?.allowExperimentalBinary === true &&
    hasBushMeshCapability(capabilities, BushMeshCapability.BinaryTransport);
  const localDictionaryVersion =
    local.dictionaryVersion ?? BUSHMESH_TEXT_DICTIONARY_VERSION;
  const remoteDictionaryVersion = remote.dictionaryVersion;
  const dictionaryVersionMatches =
    compatibility.compatible &&
    remoteDictionaryVersion !== undefined &&
    remoteDictionaryVersion === localDictionaryVersion;

  return {
    compatible: compatibility.compatible,
    protocolVersion,
    capabilities,
    transport: canUseBinary ? 'binary' : 'text-safe',
    allowSemantic: hasBushMeshCapability(
      capabilities,
      BushMeshCapability.SemanticMessages,
    ),
    allowDictionary:
      dictionaryVersionMatches &&
      hasBushMeshCapability(capabilities, BushMeshCapability.DictionaryText),
    dictionaryVersion: dictionaryVersionMatches ? localDictionaryVersion : null,
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
    allowSensorDelta: hasBushMeshCapability(
      capabilities,
      BushMeshCapability.SensorDelta,
    ),
    allowCompressedBinary: hasBushMeshCapability(
      capabilities,
      BushMeshCapability.CompressedBinary,
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
  if (!policy.compatible || policy.protocolVersion === null) {
    throw new Error('Remote node does not support a compatible BushMesh protocol version.');
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
