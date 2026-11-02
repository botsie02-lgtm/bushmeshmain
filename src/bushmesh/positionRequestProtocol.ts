import {
  BUSHMESH_PROTOCOL_VERSION,
  BushMeshIdentityRef,
} from './protocol';

/** Formation share owns 0x03. Recovery position requests use the next v1 type. */
export const BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE = 0x04;
export const BUSHMESH_POSITION_REQUEST_DEFAULT_TTL_SECONDS = 60;
export const BUSHMESH_POSITION_RESPONSE_FLAG = 0x01;

const IDENTITY_BYTES = 6;
const POSITION_REQUEST_BYTES = 23;

export type BushMeshPositionRequest = {
  senderId: BushMeshIdentityRef;
  targetId: BushMeshIdentityRef;
  sequence: number;
  timestampSeconds: number;
  ttlSeconds?: number;
  flags?: number;
};

export type DecodedBushMeshPositionRequest = BushMeshPositionRequest & {
  version: number;
  type: typeof BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE;
  ttlSeconds: number;
};

function identityToBytes(identity: BushMeshIdentityRef): number[] {
  const normalized = identity.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(normalized)) {
    throw new Error(
      'Bushmesh position-request identities must contain exactly 12 hexadecimal characters.',
    );
  }

  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

function identityFromBytes(bytes: Uint8Array, offset: number): string {
  return Array.from(bytes.slice(offset, offset + IDENTITY_BYTES))
    .map(value => value.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

function pushUInt16(bytes: number[], value: number): void {
  const safe = value & 0xffff;
  bytes.push(safe & 0xff, (safe >>> 8) & 0xff);
}

function pushUInt32(bytes: number[], value: number): void {
  const safe = value >>> 0;
  bytes.push(
    safe & 0xff,
    (safe >>> 8) & 0xff,
    (safe >>> 16) & 0xff,
    (safe >>> 24) & 0xff,
  );
}

function readUInt16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function validateRequest(request: BushMeshPositionRequest): void {
  identityToBytes(request.senderId);
  identityToBytes(request.targetId);

  if (request.senderId.toUpperCase() === request.targetId.toUpperCase()) {
    throw new Error('Bushmesh position request cannot target the sender itself.');
  }
  if (!Number.isInteger(request.sequence) || request.sequence < 0 || request.sequence > 0xffff) {
    throw new Error('Position-request sequence must be a uint16.');
  }
  if (
    !Number.isInteger(request.timestampSeconds) ||
    request.timestampSeconds < 0 ||
    request.timestampSeconds > 0xffffffff
  ) {
    throw new Error('Position-request timestamp must be a uint32.');
  }

  const ttlSeconds =
    request.ttlSeconds ?? BUSHMESH_POSITION_REQUEST_DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 300) {
    throw new Error('Position-request TTL must be between 1 and 300 seconds.');
  }
}

export function encodeBushMeshPositionRequest(
  request: BushMeshPositionRequest,
): Uint8Array {
  validateRequest(request);
  const ttlSeconds =
    request.ttlSeconds ?? BUSHMESH_POSITION_REQUEST_DEFAULT_TTL_SECONDS;

  const bytes: number[] = [
    BUSHMESH_PROTOCOL_VERSION,
    BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE,
    request.flags ?? 0,
    ...identityToBytes(request.senderId),
    ...identityToBytes(request.targetId),
  ];
  pushUInt16(bytes, request.sequence);
  pushUInt32(bytes, request.timestampSeconds);
  pushUInt16(bytes, ttlSeconds);
  return Uint8Array.from(bytes);
}

export function decodeBushMeshPositionRequest(
  payload: Uint8Array,
): DecodedBushMeshPositionRequest {
  if (payload.length !== POSITION_REQUEST_BYTES) {
    throw new Error(
      `Invalid Bushmesh position-request packet length ${payload.length}; expected ${POSITION_REQUEST_BYTES}.`,
    );
  }
  if (payload[0] !== BUSHMESH_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Bushmesh protocol version ${payload[0]}.`);
  }
  if (payload[1] !== BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE) {
    throw new Error(`Packet is not a Bushmesh position request: ${payload[1]}.`);
  }

  const decoded: DecodedBushMeshPositionRequest = {
    version: payload[0],
    type: BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE,
    flags: payload[2],
    senderId: identityFromBytes(payload, 3),
    targetId: identityFromBytes(payload, 9),
    sequence: readUInt16(payload, 15),
    timestampSeconds: readUInt32(payload, 17),
    ttlSeconds: readUInt16(payload, 21),
  };
  validateRequest(decoded);
  return decoded;
}

export type PositionRequestTemporalDecision = {
  active: boolean;
  expiresAtMs: number;
  reason: 'active' | 'expired' | 'future-clock-skew';
};

export function getPositionRequestTemporalDecision(
  request: Pick<DecodedBushMeshPositionRequest, 'timestampSeconds' | 'ttlSeconds'>,
  nowMs = Date.now(),
): PositionRequestTemporalDecision {
  const createdAtMs = request.timestampSeconds * 1000;
  const expiresAtMs = createdAtMs + request.ttlSeconds * 1000;

  if (createdAtMs - nowMs > 60_000) {
    return {active: false, expiresAtMs, reason: 'future-clock-skew'};
  }
  if (expiresAtMs <= nowMs) {
    return {active: false, expiresAtMs, reason: 'expired'};
  }
  return {active: true, expiresAtMs, reason: 'active'};
}
