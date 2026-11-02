import {
  BUSHMESH_PROTOCOL_VERSION,
  BushMeshPacketType,
} from './codec';
import {
  BUSHMESH_WIRE_MAGIC,
  DecodedBushMeshWireMessage,
  decodeBushMeshWire,
} from './transport';

export type BushMeshFrameSafetyOptions = {
  maxWireBytes?: number;
  maxPayloadBytes?: number;
  maxTtlHops?: number;
  acceptedProtocolVersions?: number[];
};

export type BushMeshFrameInspection =
  | {ok: true; decoded: DecodedBushMeshWireMessage}
  | {ok: false; reason: string};

export function inspectBushMeshWireFrame(
  bytes: number[],
  options?: BushMeshFrameSafetyOptions,
): BushMeshFrameInspection {
  const maxWireBytes = options?.maxWireBytes ?? 512;
  const maxPayloadBytes = options?.maxPayloadBytes ?? 448;
  const maxTtlHops = options?.maxTtlHops ?? 16;
  const acceptedProtocolVersions =
    options?.acceptedProtocolVersions ?? [BUSHMESH_PROTOCOL_VERSION];

  if (bytes.length > maxWireBytes) {
    return {ok: false, reason: 'wire-frame-too-large'};
  }

  if (
    bytes.length < 5 ||
    bytes[0] !== BUSHMESH_WIRE_MAGIC[0] ||
    bytes[1] !== BUSHMESH_WIRE_MAGIC[1]
  ) {
    return {ok: false, reason: 'invalid-magic-or-short-frame'};
  }

  let decoded: DecodedBushMeshWireMessage;

  try {
    decoded = decodeBushMeshWire(bytes);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'decode-failed',
    };
  }

  if (!acceptedProtocolVersions.includes(decoded.envelope.version)) {
    return {ok: false, reason: 'unsupported-protocol-version'};
  }

  if (
    decoded.envelope.type < BushMeshPacketType.Message ||
    decoded.envelope.type > BushMeshPacketType.Sync
  ) {
    return {ok: false, reason: 'unsupported-packet-type'};
  }

  if (decoded.envelope.payload.length > maxPayloadBytes) {
    return {ok: false, reason: 'payload-too-large'};
  }

  if (
    decoded.envelope.ttlHops !== null &&
    decoded.envelope.ttlHops > maxTtlHops
  ) {
    return {ok: false, reason: 'ttl-too-large'};
  }

  return {ok: true, decoded};
}

export function safelyDecodeBushMeshWire(
  bytes: number[],
  options?: BushMeshFrameSafetyOptions,
): DecodedBushMeshWireMessage | null {
  const inspected = inspectBushMeshWireFrame(bytes, options);
  return inspected.ok ? inspected.decoded : null;
}
