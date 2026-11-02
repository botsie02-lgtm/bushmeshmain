import {Buffer} from 'buffer';

import {
  assertBytes,
  assertIntegerInRange,
  decodeVarUint,
  encodeVarUint,
} from './codec';

/** Distinct from ordinary BushMesh wire magic [0xB5, 0x4D]. */
export const BUSHMESH_SECURITY_WIRE_MAGIC = [0xb5, 0x53] as const;
export const BUSHMESH_SECURITY_CONTAINER_VERSION = 1;
export const BUSHMESH_SECURITY_MAX_CONTAINER_BYTES = 4096;
export const BUSHMESH_SECURITY_MAX_AUTHENTICATED_HEADER_BYTES = 256;
export const BUSHMESH_SECURITY_MAX_CIPHERTEXT_BYTES = 3072;
export const BUSHMESH_SECURITY_MAX_IDENTIFIER_BYTES = 160;
export const BUSHMESH_SECURITY_MAX_CHALLENGE_BYTES = 64;
export const BUSHMESH_SECURITY_MAX_VERSION_COUNT = 8;

export const BushMeshSecurityContainerKind = {
  ProtectedDirect: 0x01,
  ProtectedGroup: 0x02,
  PairingProof: 0x10,
  SessionOffer: 0x11,
  SessionResponse: 0x12,
  WrappedGroupKeyDistribution: 0x13,
  IdentityRotationProof: 0x14,
  /** 0x15 is reserved for a future authority-defined revocation/retirement object. */
} as const;

export type BushMeshSecurityContainerKind =
  (typeof BushMeshSecurityContainerKind)[keyof typeof BushMeshSecurityContainerKind];

const ROUTING_SOURCE = 0x01;
const ROUTING_DESTINATION = 0x02;
const ROUTING_GROUP = 0x04;
const ROUTING_KNOWN_MASK = ROUTING_SOURCE | ROUTING_DESTINATION | ROUTING_GROUP;
const SECURITY_OBJECT_SCHEMA_VERSION = 1;

export type BushMeshSecurityRoutingContext = {
  sourceNodeId?: number;
  destinationNodeId?: number;
  groupId?: string;
};

/** Structural mirror of Security v1 DeviceIdentity. No private-key material is ever serialized. */
export type BushMeshSecurityDeviceIdentity = {
  identityVersion: 1;
  deviceId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
  fingerprint: string;
  keyEpoch: number;
  createdAt: number;
  rotatedAt?: number;
};

export type BushMeshPairingProof = {
  identity: BushMeshSecurityDeviceIdentity;
  challenge: string;
  supportedSecurityVersions: number[];
  supportedProtocolVersions: number[];
  issuedAt: number;
  signature: string;
};

export type BushMeshSessionOffer = {
  handshakeId: string;
  initiator: BushMeshSecurityDeviceIdentity;
  responderDeviceId: string;
  ephemeralAgreementPublicKey: string;
  nonce: string;
  sendNoncePrefix: string;
  supportedSecurityVersions: number[];
  supportedProtocolVersions: number[];
  issuedAt: number;
  signature: string;
};

export type BushMeshSessionResponse = {
  handshakeId: string;
  responder: BushMeshSecurityDeviceIdentity;
  initiatorDeviceId: string;
  ephemeralAgreementPublicKey: string;
  nonce: string;
  sendNoncePrefix: string;
  selectedSecurityVersion: number;
  selectedProtocolVersion: number;
  issuedAt: number;
  signature: string;
};

export type BushMeshEncryptedDirectMessage = {
  securityVersion: number;
  protocolVersion: number;
  sessionId: string;
  keyEpoch: number;
  counter: string;
  ciphertext: string;
};

export type BushMeshEncryptedGroupMessage = {
  securityVersion: number;
  protocolVersion: number;
  groupId: string;
  epoch: number;
  senderDeviceId: string;
  counter: string;
  ciphertext: string;
};

export type BushMeshWrappedGroupKeyDistribution = {
  distributionVersion: 1;
  groupId: string;
  epoch: number;
  senderDeviceId: string;
  senderFingerprint: string;
  recipientDeviceId: string;
  recipientFingerprint: string;
  securityVersion: number;
  protocolVersion: number;
  sessionId: string;
  encryptedPayload: BushMeshEncryptedDirectMessage;
};

export type BushMeshIdentityRotationProof = {
  previousFingerprint: string;
  nextIdentity: BushMeshSecurityDeviceIdentity;
  rotatedAt: number;
  signature: string;
};

export type BushMeshProtectedPayload =
  | {kind: 'direct'; message: BushMeshEncryptedDirectMessage}
  | {kind: 'group'; message: BushMeshEncryptedGroupMessage};

export type BushMeshDecodedProtectedSecurityContainer = {
  containerVersion: 1;
  kind: 'protected-direct' | 'protected-group';
  kindId:
    | typeof BushMeshSecurityContainerKind.ProtectedDirect
    | typeof BushMeshSecurityContainerKind.ProtectedGroup;
  routing: BushMeshSecurityRoutingContext;
  authenticatedHeader: Uint8Array;
  protectedPayload: BushMeshProtectedPayload;
};

export type BushMeshDecodedSecurityControlContainer =
  | {
      containerVersion: 1;
      kind: 'pairing-proof';
      kindId: typeof BushMeshSecurityContainerKind.PairingProof;
      value: BushMeshPairingProof;
    }
  | {
      containerVersion: 1;
      kind: 'session-offer';
      kindId: typeof BushMeshSecurityContainerKind.SessionOffer;
      value: BushMeshSessionOffer;
    }
  | {
      containerVersion: 1;
      kind: 'session-response';
      kindId: typeof BushMeshSecurityContainerKind.SessionResponse;
      value: BushMeshSessionResponse;
    }
  | {
      containerVersion: 1;
      kind: 'wrapped-group-key-distribution';
      kindId: typeof BushMeshSecurityContainerKind.WrappedGroupKeyDistribution;
      value: BushMeshWrappedGroupKeyDistribution;
    }
  | {
      containerVersion: 1;
      kind: 'identity-rotation-proof';
      kindId: typeof BushMeshSecurityContainerKind.IdentityRotationProof;
      value: BushMeshIdentityRotationProof;
    };

export type BushMeshDecodedSecurityContainer =
  | BushMeshDecodedProtectedSecurityContainer
  | BushMeshDecodedSecurityControlContainer;

export type BushMeshDatagramPayloadClassification =
  | {kind: 'ordinary-bushmesh'}
  | {kind: 'security-container'; containerKind: BushMeshSecurityContainerKind}
  | {kind: 'unknown'};

function canonicalBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeBase64Url(
  value: string,
  label: string,
  expectedLength?: number,
  maxLength = BUSHMESH_SECURITY_MAX_CIPHERTEXT_BYTES,
): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error(`${label} must use unpadded base64url.`);
  }
  const padding = (4 - (value.length % 4)) % 4;
  const decoded = Uint8Array.from(
    Buffer.from(
      value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding),
      'base64',
    ),
  );
  if (canonicalBase64Url(decoded) !== value) {
    throw new Error(`${label} is not canonical base64url.`);
  }
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error(`${label} must contain exactly ${expectedLength} bytes.`);
  }
  if (decoded.length > maxLength) {
    throw new Error(`${label} exceeds the BushMesh v1 size limit.`);
  }
  return decoded;
}

function encodeU32Be(value: number, label: string): number[] {
  assertIntegerInRange(value, 0, 0xffffffff, label);
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function decodeU32Be(bytes: number[], offset: number, label: string): {value: number; nextOffset: number} {
  if (offset + 4 > bytes.length) {
    throw new Error(`Truncated ${label}.`);
  }
  return {
    value:
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0,
    nextOffset: offset + 4,
  };
}

function parseU64Decimal(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical unsigned decimal integer.`);
  }
  const parsed = BigInt(value);
  if (parsed > 0xffffffffffffffffn) {
    throw new Error(`${label} exceeds uint64.`);
  }
  return parsed;
}

function encodeU64BigInt(value: bigint, label: string): number[] {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`${label} exceeds uint64.`);
  }
  const bytes = new Array<number>(8);
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function encodeTimestamp(value: number, label: string): number[] {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return encodeU64BigInt(BigInt(value), label);
}

function decodeU64BigInt(bytes: number[], offset: number, label: string): {value: bigint; nextOffset: number} {
  if (offset + 8 > bytes.length) {
    throw new Error(`Truncated ${label}.`);
  }
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]);
  }
  return {value, nextOffset: offset + 8};
}

function decodeTimestamp(bytes: number[], offset: number, label: string): {value: number; nextOffset: number} {
  const decoded = decodeU64BigInt(bytes, offset, label);
  if (decoded.value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds JavaScript safe-integer range.`);
  }
  return {value: Number(decoded.value), nextOffset: decoded.nextOffset};
}

function encodeUtf8(value: string, label: string, maxBytes = BUSHMESH_SECURITY_MAX_IDENTIFIER_BYTES): number[] {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
  const bytes = Array.from(Buffer.from(value, 'utf8'));
  if (bytes.length > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} UTF-8 bytes.`);
  }
  return [...encodeVarUint(bytes.length), ...bytes];
}

function decodeUtf8(
  bytes: number[],
  offset: number,
  label: string,
  maxBytes = BUSHMESH_SECURITY_MAX_IDENTIFIER_BYTES,
): {value: string; nextOffset: number} {
  const length = decodeVarUint(bytes, offset);
  if (length.value < 1 || length.value > maxBytes) {
    throw new Error(`${label} length is outside the BushMesh v1 limit.`);
  }
  const end = length.nextOffset + length.value;
  if (end > bytes.length) {
    throw new Error(`Truncated ${label}.`);
  }
  const field = bytes.slice(length.nextOffset, end);
  const value = Buffer.from(field).toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(Buffer.from(field))) {
    throw new Error(`${label} is not valid canonical UTF-8.`);
  }
  return {value, nextOffset: end};
}

function encodeByteString(bytes: Uint8Array | number[], label: string, minLength: number, maxLength: number): number[] {
  const values = Array.from(bytes);
  assertBytes(values, label);
  if (values.length < minLength || values.length > maxLength) {
    throw new Error(`${label} length must be ${minLength}..${maxLength} bytes.`);
  }
  return [...encodeVarUint(values.length), ...values];
}

function decodeByteString(
  bytes: number[],
  offset: number,
  label: string,
  minLength: number,
  maxLength: number,
): {value: Uint8Array; nextOffset: number} {
  const length = decodeVarUint(bytes, offset);
  if (length.value < minLength || length.value > maxLength) {
    throw new Error(`${label} length is outside the BushMesh v1 limit.`);
  }
  const end = length.nextOffset + length.value;
  if (end > bytes.length) {
    throw new Error(`Truncated ${label}.`);
  }
  return {value: Uint8Array.from(bytes.slice(length.nextOffset, end)), nextOffset: end};
}

function encodeVersions(values: number[], label: string, protocol = false): number[] {
  if (
    values.length < 1 ||
    values.length > BUSHMESH_SECURITY_MAX_VERSION_COUNT ||
    new Set(values).size !== values.length
  ) {
    throw new Error(`${label} must contain 1..${BUSHMESH_SECURITY_MAX_VERSION_COUNT} unique versions.`);
  }
  values.forEach(value =>
    assertIntegerInRange(value, 1, protocol ? 3 : 255, `${label} entry`),
  );
  return [values.length, ...values];
}

function decodeVersions(
  bytes: number[],
  offset: number,
  label: string,
  protocol = false,
): {value: number[]; nextOffset: number} {
  const count = bytes[offset];
  if (count === undefined || count < 1 || count > BUSHMESH_SECURITY_MAX_VERSION_COUNT) {
    throw new Error(`${label} count is outside the BushMesh v1 limit.`);
  }
  const end = offset + 1 + count;
  if (end > bytes.length) {
    throw new Error(`Truncated ${label}.`);
  }
  const value = bytes.slice(offset + 1, end);
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} contains duplicate versions.`);
  }
  value.forEach(version =>
    assertIntegerInRange(version, 1, protocol ? 3 : 255, `${label} entry`),
  );
  return {value, nextOffset: end};
}

function requireSchemaVersion(bytes: number[], offset = 0): number {
  const version = bytes[offset];
  if (version !== SECURITY_OBJECT_SCHEMA_VERSION) {
    throw new Error(`Unsupported BushMesh Security object schema version ${version ?? 'missing'}.`);
  }
  return offset + 1;
}

function ensureConsumed(bytes: number[], offset: number, label: string): void {
  if (offset !== bytes.length) {
    throw new Error(`${label} contains trailing or unknown v1 fields.`);
  }
}

function encodeIdentity(identity: BushMeshSecurityDeviceIdentity): number[] {
  if (identity.identityVersion !== 1) {
    throw new Error('BushMesh Security v1 only transports DeviceIdentity version 1.');
  }
  const signing = decodeBase64Url(identity.signingPublicKey, 'Signing public key', 32);
  const agreement = decodeBase64Url(identity.agreementPublicKey, 'Agreement public key', 32);
  const fingerprint = decodeBase64Url(identity.fingerprint, 'Identity fingerprint', 32);
  return [
    0x01,
    ...encodeUtf8(identity.deviceId, 'Device ID', 64),
    ...signing,
    ...agreement,
    ...fingerprint,
    ...encodeU32Be(identity.keyEpoch, 'Identity key epoch'),
    ...encodeTimestamp(identity.createdAt, 'Identity creation timestamp'),
    identity.rotatedAt === undefined ? 0x00 : 0x01,
    ...(identity.rotatedAt === undefined
      ? []
      : encodeTimestamp(identity.rotatedAt, 'Identity rotation timestamp')),
  ];
}

function decodeIdentity(bytes: number[], offset: number): {value: BushMeshSecurityDeviceIdentity; nextOffset: number} {
  if (bytes[offset] !== 0x01) {
    throw new Error(`Unsupported DeviceIdentity wire version ${bytes[offset] ?? 'missing'}.`);
  }
  let cursor = offset + 1;
  const deviceId = decodeUtf8(bytes, cursor, 'Device ID', 64);
  cursor = deviceId.nextOffset;
  if (cursor + 96 > bytes.length) {
    throw new Error('Truncated DeviceIdentity public key/fingerprint fields.');
  }
  const signingPublicKey = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 32)));
  cursor += 32;
  const agreementPublicKey = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 32)));
  cursor += 32;
  const fingerprint = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 32)));
  cursor += 32;
  const keyEpoch = decodeU32Be(bytes, cursor, 'Identity key epoch');
  cursor = keyEpoch.nextOffset;
  const createdAt = decodeTimestamp(bytes, cursor, 'Identity creation timestamp');
  cursor = createdAt.nextOffset;
  const rotatedPresent = bytes[cursor];
  if (rotatedPresent !== 0 && rotatedPresent !== 1) {
    throw new Error('DeviceIdentity rotatedAt presence marker must be 0 or 1.');
  }
  cursor += 1;
  let rotatedAt: number | undefined;
  if (rotatedPresent === 1) {
    const decodedRotated = decodeTimestamp(bytes, cursor, 'Identity rotation timestamp');
    rotatedAt = decodedRotated.value;
    cursor = decodedRotated.nextOffset;
  }
  return {
    value: {
      identityVersion: 1,
      deviceId: deviceId.value,
      signingPublicKey,
      agreementPublicKey,
      fingerprint,
      keyEpoch: keyEpoch.value,
      createdAt: createdAt.value,
      rotatedAt,
    },
    nextOffset: cursor,
  };
}

function encodeEncryptedDirectBody(message: BushMeshEncryptedDirectMessage): number[] {
  const ciphertext = decodeBase64Url(
    message.ciphertext,
    'Direct ciphertext',
    undefined,
    BUSHMESH_SECURITY_MAX_CIPHERTEXT_BYTES,
  );
  return [
    SECURITY_OBJECT_SCHEMA_VERSION,
    ...encodeVersions([message.securityVersion], 'Security version').slice(1),
    ...encodeVersions([message.protocolVersion], 'Protocol version', true).slice(1),
    ...encodeUtf8(message.sessionId, 'Session ID', 64),
    ...encodeU32Be(message.keyEpoch, 'Session key epoch'),
    ...encodeU64BigInt(parseU64Decimal(message.counter, 'Direct counter'), 'Direct counter'),
    ...encodeByteString(ciphertext, 'Direct ciphertext', 16, BUSHMESH_SECURITY_MAX_CIPHERTEXT_BYTES),
  ];
}

function decodeEncryptedDirectBody(bytes: number[]): BushMeshEncryptedDirectMessage {
  let cursor = requireSchemaVersion(bytes);
  const securityVersion = bytes[cursor++];
  const protocolVersion = bytes[cursor++];
  assertIntegerInRange(securityVersion, 1, 255, 'Security version');
  assertIntegerInRange(protocolVersion, 1, 3, 'Protocol version');
  const sessionId = decodeUtf8(bytes, cursor, 'Session ID', 64);
  cursor = sessionId.nextOffset;
  const keyEpoch = decodeU32Be(bytes, cursor, 'Session key epoch');
  cursor = keyEpoch.nextOffset;
  const counter = decodeU64BigInt(bytes, cursor, 'Direct counter');
  cursor = counter.nextOffset;
  const ciphertext = decodeByteString(
    bytes,
    cursor,
    'Direct ciphertext',
    16,
    BUSHMESH_SECURITY_MAX_CIPHERTEXT_BYTES,
  );
  cursor = ciphertext.nextOffset;
  ensureConsumed(bytes, cursor, 'EncryptedDirectMessage');
  return {
    securityVersion,
    protocolVersion,
    sessionId: sessionId.value,
    keyEpoch: keyEpoch.value,
    counter: counter.value.toString(),
    ciphertext: canonicalBase64Url(ciphertext.value),
  };
}

function encodeEncryptedGroupBody(message: BushMeshEncryptedGroupMessage): number[] {
  const ciphertext = decodeBase64Url(
    message.ciphertext,
    'Group ciphertext',
    undefined,
    BUSHMESH_SECURITY_MAX_CIPHERTEXT_BYTES,
  );
  assertIntegerInRange(message.securityVersion, 1, 255, 'Security version');
  assertIntegerInRange(message.protocolVersion, 1, 3, 'Protocol version');
  return [
    SECURITY_OBJECT_SCHEMA_VERSION,
    message.securityVersion,
    message.protocolVersion,
    ...encodeUtf8(message.groupId, 'Group ID'),
    ...encodeU32Be(message.epoch, 'Group epoch'),
    ...encodeUtf8(message.senderDeviceId, 'Sender device ID', 64),
    ...encodeU64BigInt(parseU64Decimal(message.counter, 'Group counter'), 'Group counter'),
    ...encodeByteString(ciphertext, 'Group ciphertext', 16, BUSHMESH_SECURITY_MAX_CIPHERTEXT_BYTES),
  ];
}

function decodeEncryptedGroupBody(bytes: number[]): BushMeshEncryptedGroupMessage {
  let cursor = requireSchemaVersion(bytes);
  const securityVersion = bytes[cursor++];
  const protocolVersion = bytes[cursor++];
  assertIntegerInRange(securityVersion, 1, 255, 'Security version');
  assertIntegerInRange(protocolVersion, 1, 3, 'Protocol version');
  const groupId = decodeUtf8(bytes, cursor, 'Group ID');
  cursor = groupId.nextOffset;
  const epoch = decodeU32Be(bytes, cursor, 'Group epoch');
  cursor = epoch.nextOffset;
  const senderDeviceId = decodeUtf8(bytes, cursor, 'Sender device ID', 64);
  cursor = senderDeviceId.nextOffset;
  const counter = decodeU64BigInt(bytes, cursor, 'Group counter');
  cursor = counter.nextOffset;
  const ciphertext = decodeByteString(
    bytes,
    cursor,
    'Group ciphertext',
    16,
    BUSHMESH_SECURITY_MAX_CIPHERTEXT_BYTES,
  );
  cursor = ciphertext.nextOffset;
  ensureConsumed(bytes, cursor, 'EncryptedGroupMessage');
  return {
    securityVersion,
    protocolVersion,
    groupId: groupId.value,
    epoch: epoch.value,
    senderDeviceId: senderDeviceId.value,
    counter: counter.value.toString(),
    ciphertext: canonicalBase64Url(ciphertext.value),
  };
}

function encodeRouting(routing: BushMeshSecurityRoutingContext): number[] {
  let flags = 0;
  if (routing.sourceNodeId !== undefined) {
    flags |= ROUTING_SOURCE;
    assertIntegerInRange(routing.sourceNodeId, 0, 0xffffffff, 'Routing source node ID');
  }
  if (routing.destinationNodeId !== undefined) {
    flags |= ROUTING_DESTINATION;
    assertIntegerInRange(routing.destinationNodeId, 0, 0xffffffff, 'Routing destination node ID');
  }
  if (routing.groupId !== undefined) {
    flags |= ROUTING_GROUP;
  }
  return [
    flags,
    ...(routing.sourceNodeId === undefined ? [] : encodeVarUint(routing.sourceNodeId)),
    ...(routing.destinationNodeId === undefined
      ? []
      : encodeVarUint(routing.destinationNodeId)),
    ...(routing.groupId === undefined ? [] : encodeUtf8(routing.groupId, 'Routing group ID')),
  ];
}

function decodeRouting(bytes: number[], offset: number): {value: BushMeshSecurityRoutingContext; nextOffset: number} {
  const flags = bytes[offset];
  if (flags === undefined) {
    throw new Error('Security container routing flags are missing.');
  }
  if ((flags & ~ROUTING_KNOWN_MASK) !== 0) {
    throw new Error('Security container contains unknown v1 routing flags.');
  }
  let cursor = offset + 1;
  const value: BushMeshSecurityRoutingContext = {};
  if ((flags & ROUTING_SOURCE) !== 0) {
    const decoded = decodeVarUint(bytes, cursor);
    value.sourceNodeId = decoded.value;
    cursor = decoded.nextOffset;
  }
  if ((flags & ROUTING_DESTINATION) !== 0) {
    const decoded = decodeVarUint(bytes, cursor);
    value.destinationNodeId = decoded.value;
    cursor = decoded.nextOffset;
  }
  if ((flags & ROUTING_GROUP) !== 0) {
    const decoded = decodeUtf8(bytes, cursor, 'Routing group ID');
    value.groupId = decoded.value;
    cursor = decoded.nextOffset;
  }
  return {value, nextOffset: cursor};
}

function securityContainer(
  kind: BushMeshSecurityContainerKind,
  routing: BushMeshSecurityRoutingContext,
  authenticatedHeader: Uint8Array | number[],
  body: number[],
): number[] {
  const headerBytes = Array.from(authenticatedHeader);
  assertBytes(headerBytes, 'authenticated header');
  if (headerBytes.length > BUSHMESH_SECURITY_MAX_AUTHENTICATED_HEADER_BYTES) {
    throw new Error('BushMesh authenticated header exceeds the v1 size limit.');
  }
  assertBytes(body, 'security container body');
  const bytes = [
    ...BUSHMESH_SECURITY_WIRE_MAGIC,
    BUSHMESH_SECURITY_CONTAINER_VERSION,
    kind,
    ...encodeRouting(routing),
    ...encodeVarUint(headerBytes.length),
    ...headerBytes,
    ...encodeVarUint(body.length),
    ...body,
  ];
  if (bytes.length > BUSHMESH_SECURITY_MAX_CONTAINER_BYTES) {
    throw new Error('BushMesh Security v1 container exceeds the 4096-byte maximum.');
  }
  return bytes;
}

function securityControlContainer(kind: BushMeshSecurityContainerKind, body: number[]): number[] {
  return securityContainer(kind, {}, [], body);
}

export function encodeBushMeshProtectedDirectContainer(input: {
  routing: Required<Pick<BushMeshSecurityRoutingContext, 'sourceNodeId' | 'destinationNodeId'>>;
  authenticatedHeader: Uint8Array | number[];
  message: BushMeshEncryptedDirectMessage;
}): number[] {
  if (input.routing.sourceNodeId === input.routing.destinationNodeId) {
    throw new Error('Protected direct source and destination node IDs must differ.');
  }
  return securityContainer(
    BushMeshSecurityContainerKind.ProtectedDirect,
    input.routing,
    input.authenticatedHeader,
    encodeEncryptedDirectBody(input.message),
  );
}

export function encodeBushMeshProtectedGroupContainer(input: {
  routing: Required<Pick<BushMeshSecurityRoutingContext, 'sourceNodeId' | 'groupId'>>;
  authenticatedHeader: Uint8Array | number[];
  message: BushMeshEncryptedGroupMessage;
}): number[] {
  if (input.routing.groupId !== input.message.groupId) {
    throw new Error('Protected group routing group ID must match the Security v1 group ID.');
  }
  return securityContainer(
    BushMeshSecurityContainerKind.ProtectedGroup,
    input.routing,
    input.authenticatedHeader,
    encodeEncryptedGroupBody(input.message),
  );
}

function encodePairingProofBody(proof: BushMeshPairingProof): number[] {
  const challenge = decodeBase64Url(
    proof.challenge,
    'Pairing challenge',
    undefined,
    BUSHMESH_SECURITY_MAX_CHALLENGE_BYTES,
  );
  if (challenge.length < 16) {
    throw new Error('Pairing challenge must contain at least 16 bytes.');
  }
  const signature = decodeBase64Url(proof.signature, 'Pairing signature', 64);
  return [
    SECURITY_OBJECT_SCHEMA_VERSION,
    ...encodeIdentity(proof.identity),
    ...encodeByteString(challenge, 'Pairing challenge', 16, BUSHMESH_SECURITY_MAX_CHALLENGE_BYTES),
    ...encodeVersions(proof.supportedSecurityVersions, 'Supported Security versions'),
    ...encodeVersions(proof.supportedProtocolVersions, 'Supported protocol versions', true),
    ...encodeTimestamp(proof.issuedAt, 'Pairing issuedAt'),
    ...signature,
  ];
}

function decodePairingProofBody(bytes: number[]): BushMeshPairingProof {
  let cursor = requireSchemaVersion(bytes);
  const identity = decodeIdentity(bytes, cursor);
  cursor = identity.nextOffset;
  const challenge = decodeByteString(
    bytes,
    cursor,
    'Pairing challenge',
    16,
    BUSHMESH_SECURITY_MAX_CHALLENGE_BYTES,
  );
  cursor = challenge.nextOffset;
  const securityVersions = decodeVersions(bytes, cursor, 'Supported Security versions');
  cursor = securityVersions.nextOffset;
  const protocolVersions = decodeVersions(bytes, cursor, 'Supported protocol versions', true);
  cursor = protocolVersions.nextOffset;
  const issuedAt = decodeTimestamp(bytes, cursor, 'Pairing issuedAt');
  cursor = issuedAt.nextOffset;
  if (cursor + 64 > bytes.length) {
    throw new Error('Truncated pairing signature.');
  }
  const signature = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 64)));
  cursor += 64;
  ensureConsumed(bytes, cursor, 'PairingProof');
  return {
    identity: identity.value,
    challenge: canonicalBase64Url(challenge.value),
    supportedSecurityVersions: securityVersions.value,
    supportedProtocolVersions: protocolVersions.value,
    issuedAt: issuedAt.value,
    signature,
  };
}

function encodeSessionOfferBody(offer: BushMeshSessionOffer): number[] {
  return [
    SECURITY_OBJECT_SCHEMA_VERSION,
    ...encodeUtf8(offer.handshakeId, 'Handshake ID', 64),
    ...encodeIdentity(offer.initiator),
    ...encodeUtf8(offer.responderDeviceId, 'Responder device ID', 64),
    ...decodeBase64Url(offer.ephemeralAgreementPublicKey, 'Offer ephemeral public key', 32),
    ...decodeBase64Url(offer.nonce, 'Offer nonce', 32),
    ...decodeBase64Url(offer.sendNoncePrefix, 'Offer nonce prefix', 4),
    ...encodeVersions(offer.supportedSecurityVersions, 'Supported Security versions'),
    ...encodeVersions(offer.supportedProtocolVersions, 'Supported protocol versions', true),
    ...encodeTimestamp(offer.issuedAt, 'Session offer issuedAt'),
    ...decodeBase64Url(offer.signature, 'Session offer signature', 64),
  ];
}

function decodeSessionOfferBody(bytes: number[]): BushMeshSessionOffer {
  let cursor = requireSchemaVersion(bytes);
  const handshakeId = decodeUtf8(bytes, cursor, 'Handshake ID', 64);
  cursor = handshakeId.nextOffset;
  const initiator = decodeIdentity(bytes, cursor);
  cursor = initiator.nextOffset;
  const responderDeviceId = decodeUtf8(bytes, cursor, 'Responder device ID', 64);
  cursor = responderDeviceId.nextOffset;
  if (cursor + 68 > bytes.length) {
    throw new Error('Truncated SessionOffer key/nonce fields.');
  }
  const ephemeralAgreementPublicKey = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 32)));
  cursor += 32;
  const nonce = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 32)));
  cursor += 32;
  const sendNoncePrefix = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 4)));
  cursor += 4;
  const securityVersions = decodeVersions(bytes, cursor, 'Supported Security versions');
  cursor = securityVersions.nextOffset;
  const protocolVersions = decodeVersions(bytes, cursor, 'Supported protocol versions', true);
  cursor = protocolVersions.nextOffset;
  const issuedAt = decodeTimestamp(bytes, cursor, 'Session offer issuedAt');
  cursor = issuedAt.nextOffset;
  if (cursor + 64 > bytes.length) {
    throw new Error('Truncated SessionOffer signature.');
  }
  const signature = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 64)));
  cursor += 64;
  ensureConsumed(bytes, cursor, 'SessionOffer');
  return {
    handshakeId: handshakeId.value,
    initiator: initiator.value,
    responderDeviceId: responderDeviceId.value,
    ephemeralAgreementPublicKey,
    nonce,
    sendNoncePrefix,
    supportedSecurityVersions: securityVersions.value,
    supportedProtocolVersions: protocolVersions.value,
    issuedAt: issuedAt.value,
    signature,
  };
}

function encodeSessionResponseBody(response: BushMeshSessionResponse): number[] {
  assertIntegerInRange(response.selectedSecurityVersion, 1, 255, 'Selected Security version');
  assertIntegerInRange(response.selectedProtocolVersion, 1, 3, 'Selected protocol version');
  return [
    SECURITY_OBJECT_SCHEMA_VERSION,
    ...encodeUtf8(response.handshakeId, 'Handshake ID', 64),
    ...encodeIdentity(response.responder),
    ...encodeUtf8(response.initiatorDeviceId, 'Initiator device ID', 64),
    ...decodeBase64Url(response.ephemeralAgreementPublicKey, 'Response ephemeral public key', 32),
    ...decodeBase64Url(response.nonce, 'Response nonce', 32),
    ...decodeBase64Url(response.sendNoncePrefix, 'Response nonce prefix', 4),
    response.selectedSecurityVersion,
    response.selectedProtocolVersion,
    ...encodeTimestamp(response.issuedAt, 'Session response issuedAt'),
    ...decodeBase64Url(response.signature, 'Session response signature', 64),
  ];
}

function decodeSessionResponseBody(bytes: number[]): BushMeshSessionResponse {
  let cursor = requireSchemaVersion(bytes);
  const handshakeId = decodeUtf8(bytes, cursor, 'Handshake ID', 64);
  cursor = handshakeId.nextOffset;
  const responder = decodeIdentity(bytes, cursor);
  cursor = responder.nextOffset;
  const initiatorDeviceId = decodeUtf8(bytes, cursor, 'Initiator device ID', 64);
  cursor = initiatorDeviceId.nextOffset;
  if (cursor + 70 > bytes.length) {
    throw new Error('Truncated SessionResponse key/nonce/version fields.');
  }
  const ephemeralAgreementPublicKey = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 32)));
  cursor += 32;
  const nonce = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 32)));
  cursor += 32;
  const sendNoncePrefix = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 4)));
  cursor += 4;
  const selectedSecurityVersion = bytes[cursor++];
  const selectedProtocolVersion = bytes[cursor++];
  assertIntegerInRange(selectedSecurityVersion, 1, 255, 'Selected Security version');
  assertIntegerInRange(selectedProtocolVersion, 1, 3, 'Selected protocol version');
  const issuedAt = decodeTimestamp(bytes, cursor, 'Session response issuedAt');
  cursor = issuedAt.nextOffset;
  if (cursor + 64 > bytes.length) {
    throw new Error('Truncated SessionResponse signature.');
  }
  const signature = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 64)));
  cursor += 64;
  ensureConsumed(bytes, cursor, 'SessionResponse');
  return {
    handshakeId: handshakeId.value,
    responder: responder.value,
    initiatorDeviceId: initiatorDeviceId.value,
    ephemeralAgreementPublicKey,
    nonce,
    sendNoncePrefix,
    selectedSecurityVersion,
    selectedProtocolVersion,
    issuedAt: issuedAt.value,
    signature,
  };
}

function encodeWrappedGroupKeyDistributionBody(distribution: BushMeshWrappedGroupKeyDistribution): number[] {
  if (distribution.distributionVersion !== 1) {
    throw new Error('BushMesh v1 only transports group-key distribution version 1.');
  }
  assertIntegerInRange(distribution.securityVersion, 1, 255, 'Security version');
  assertIntegerInRange(distribution.protocolVersion, 1, 3, 'Protocol version');
  if (distribution.encryptedPayload.sessionId !== distribution.sessionId) {
    throw new Error('Wrapped group-key session ID must match its encrypted direct payload.');
  }
  const encrypted = encodeEncryptedDirectBody(distribution.encryptedPayload);
  return [
    0x01,
    ...encodeUtf8(distribution.groupId, 'Group ID'),
    ...encodeU32Be(distribution.epoch, 'Group epoch'),
    ...encodeUtf8(distribution.senderDeviceId, 'Sender device ID', 64),
    ...decodeBase64Url(distribution.senderFingerprint, 'Sender fingerprint', 32),
    ...encodeUtf8(distribution.recipientDeviceId, 'Recipient device ID', 64),
    ...decodeBase64Url(distribution.recipientFingerprint, 'Recipient fingerprint', 32),
    distribution.securityVersion,
    distribution.protocolVersion,
    ...encodeUtf8(distribution.sessionId, 'Session ID', 64),
    ...encodeByteString(encrypted, 'Encrypted group-key payload', 1, BUSHMESH_SECURITY_MAX_CIPHERTEXT_BYTES + 256),
  ];
}

function decodeWrappedGroupKeyDistributionBody(bytes: number[]): BushMeshWrappedGroupKeyDistribution {
  let cursor = requireSchemaVersion(bytes);
  const groupId = decodeUtf8(bytes, cursor, 'Group ID');
  cursor = groupId.nextOffset;
  const epoch = decodeU32Be(bytes, cursor, 'Group epoch');
  cursor = epoch.nextOffset;
  const senderDeviceId = decodeUtf8(bytes, cursor, 'Sender device ID', 64);
  cursor = senderDeviceId.nextOffset;
  if (cursor + 32 > bytes.length) {
    throw new Error('Truncated sender fingerprint.');
  }
  const senderFingerprint = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 32)));
  cursor += 32;
  const recipientDeviceId = decodeUtf8(bytes, cursor, 'Recipient device ID', 64);
  cursor = recipientDeviceId.nextOffset;
  if (cursor + 34 > bytes.length) {
    throw new Error('Truncated recipient fingerprint/version fields.');
  }
  const recipientFingerprint = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 32)));
  cursor += 32;
  const securityVersion = bytes[cursor++];
  const protocolVersion = bytes[cursor++];
  assertIntegerInRange(securityVersion, 1, 255, 'Security version');
  assertIntegerInRange(protocolVersion, 1, 3, 'Protocol version');
  const sessionId = decodeUtf8(bytes, cursor, 'Session ID', 64);
  cursor = sessionId.nextOffset;
  const encrypted = decodeByteString(
    bytes,
    cursor,
    'Encrypted group-key payload',
    1,
    BUSHMESH_SECURITY_MAX_CIPHERTEXT_BYTES + 256,
  );
  cursor = encrypted.nextOffset;
  ensureConsumed(bytes, cursor, 'WrappedGroupKeyDistribution');
  const encryptedPayload = decodeEncryptedDirectBody(Array.from(encrypted.value));
  if (encryptedPayload.sessionId !== sessionId.value) {
    throw new Error('Wrapped group-key session ID does not match encrypted payload.');
  }
  return {
    distributionVersion: 1,
    groupId: groupId.value,
    epoch: epoch.value,
    senderDeviceId: senderDeviceId.value,
    senderFingerprint,
    recipientDeviceId: recipientDeviceId.value,
    recipientFingerprint,
    securityVersion,
    protocolVersion,
    sessionId: sessionId.value,
    encryptedPayload,
  };
}

function encodeIdentityRotationProofBody(proof: BushMeshIdentityRotationProof): number[] {
  if (proof.nextIdentity.rotatedAt !== proof.rotatedAt) {
    throw new Error('Identity rotation proof timestamp must match next identity rotatedAt.');
  }
  return [
    SECURITY_OBJECT_SCHEMA_VERSION,
    ...decodeBase64Url(proof.previousFingerprint, 'Previous fingerprint', 32),
    ...encodeIdentity(proof.nextIdentity),
    ...encodeTimestamp(proof.rotatedAt, 'Identity rotatedAt'),
    ...decodeBase64Url(proof.signature, 'Identity rotation signature', 64),
  ];
}

function decodeIdentityRotationProofBody(bytes: number[]): BushMeshIdentityRotationProof {
  let cursor = requireSchemaVersion(bytes);
  if (cursor + 32 > bytes.length) {
    throw new Error('Truncated previous fingerprint.');
  }
  const previousFingerprint = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 32)));
  cursor += 32;
  const nextIdentity = decodeIdentity(bytes, cursor);
  cursor = nextIdentity.nextOffset;
  const rotatedAt = decodeTimestamp(bytes, cursor, 'Identity rotatedAt');
  cursor = rotatedAt.nextOffset;
  if (cursor + 64 > bytes.length) {
    throw new Error('Truncated identity rotation signature.');
  }
  const signature = canonicalBase64Url(Uint8Array.from(bytes.slice(cursor, cursor + 64)));
  cursor += 64;
  ensureConsumed(bytes, cursor, 'IdentityRotationProof');
  if (nextIdentity.value.rotatedAt !== rotatedAt.value) {
    throw new Error('Identity rotation proof timestamp does not match next identity rotatedAt.');
  }
  return {
    previousFingerprint,
    nextIdentity: nextIdentity.value,
    rotatedAt: rotatedAt.value,
    signature,
  };
}

export function encodeBushMeshPairingProofContainer(proof: BushMeshPairingProof): number[] {
  return securityControlContainer(
    BushMeshSecurityContainerKind.PairingProof,
    encodePairingProofBody(proof),
  );
}

export function encodeBushMeshSessionOfferContainer(offer: BushMeshSessionOffer): number[] {
  return securityControlContainer(
    BushMeshSecurityContainerKind.SessionOffer,
    encodeSessionOfferBody(offer),
  );
}

export function encodeBushMeshSessionResponseContainer(response: BushMeshSessionResponse): number[] {
  return securityControlContainer(
    BushMeshSecurityContainerKind.SessionResponse,
    encodeSessionResponseBody(response),
  );
}

export function encodeBushMeshWrappedGroupKeyDistributionContainer(
  distribution: BushMeshWrappedGroupKeyDistribution,
): number[] {
  return securityControlContainer(
    BushMeshSecurityContainerKind.WrappedGroupKeyDistribution,
    encodeWrappedGroupKeyDistributionBody(distribution),
  );
}

export function encodeBushMeshIdentityRotationProofContainer(
  proof: BushMeshIdentityRotationProof,
): number[] {
  return securityControlContainer(
    BushMeshSecurityContainerKind.IdentityRotationProof,
    encodeIdentityRotationProofBody(proof),
  );
}

function parseContainer(bytes: number[]): {
  version: number;
  kind: number;
  routing: BushMeshSecurityRoutingContext;
  authenticatedHeader: Uint8Array;
  body: number[];
} {
  assertBytes(bytes, 'security container');
  if (bytes.length > BUSHMESH_SECURITY_MAX_CONTAINER_BYTES) {
    throw new Error('BushMesh Security container exceeds the v1 maximum size.');
  }
  if (
    bytes[0] !== BUSHMESH_SECURITY_WIRE_MAGIC[0] ||
    bytes[1] !== BUSHMESH_SECURITY_WIRE_MAGIC[1]
  ) {
    throw new Error('BushMesh Security wire magic mismatch.');
  }
  const version = bytes[2];
  if (version !== BUSHMESH_SECURITY_CONTAINER_VERSION) {
    throw new Error(`Unsupported BushMesh Security container version ${version ?? 'missing'}.`);
  }
  const kind = bytes[3];
  if (kind === undefined) {
    throw new Error('BushMesh Security container kind is missing.');
  }
  const routing = decodeRouting(bytes, 4);
  let cursor = routing.nextOffset;
  const aad = decodeByteString(
    bytes,
    cursor,
    'Authenticated header',
    0,
    BUSHMESH_SECURITY_MAX_AUTHENTICATED_HEADER_BYTES,
  );
  cursor = aad.nextOffset;
  const body = decodeByteString(
    bytes,
    cursor,
    'Security container body',
    1,
    BUSHMESH_SECURITY_MAX_CONTAINER_BYTES,
  );
  cursor = body.nextOffset;
  ensureConsumed(bytes, cursor, 'BushMesh Security container');
  return {
    version,
    kind,
    routing: routing.value,
    authenticatedHeader: aad.value,
    body: Array.from(body.value),
  };
}

export function decodeBushMeshSecurityContainer(bytes: number[] | Uint8Array): BushMeshDecodedSecurityContainer {
  const parsed = parseContainer(Array.from(bytes));
  const controlMustHaveNoOuterMetadata = (): void => {
    if (
      parsed.authenticatedHeader.length !== 0 ||
      parsed.routing.sourceNodeId !== undefined ||
      parsed.routing.destinationNodeId !== undefined ||
      parsed.routing.groupId !== undefined
    ) {
      throw new Error('Security v1 control containers must not carry outer routing/AAD metadata.');
    }
  };

  switch (parsed.kind) {
    case BushMeshSecurityContainerKind.ProtectedDirect: {
      if (
        parsed.routing.sourceNodeId === undefined ||
        parsed.routing.destinationNodeId === undefined ||
        parsed.routing.groupId !== undefined ||
        parsed.authenticatedHeader.length === 0
      ) {
        throw new Error('Protected direct container requires source, destination and AAD, with no group ID.');
      }
      return {
        containerVersion: 1,
        kind: 'protected-direct',
        kindId: BushMeshSecurityContainerKind.ProtectedDirect,
        routing: parsed.routing,
        authenticatedHeader: parsed.authenticatedHeader,
        protectedPayload: {kind: 'direct', message: decodeEncryptedDirectBody(parsed.body)},
      };
    }
    case BushMeshSecurityContainerKind.ProtectedGroup: {
      if (
        parsed.routing.sourceNodeId === undefined ||
        parsed.routing.destinationNodeId !== undefined ||
        parsed.routing.groupId === undefined ||
        parsed.authenticatedHeader.length === 0
      ) {
        throw new Error('Protected group container requires source, group ID and AAD, with no destination node ID.');
      }
      const message = decodeEncryptedGroupBody(parsed.body);
      if (message.groupId !== parsed.routing.groupId) {
        throw new Error('Protected group routing group ID does not match Security v1 group ID.');
      }
      return {
        containerVersion: 1,
        kind: 'protected-group',
        kindId: BushMeshSecurityContainerKind.ProtectedGroup,
        routing: parsed.routing,
        authenticatedHeader: parsed.authenticatedHeader,
        protectedPayload: {kind: 'group', message},
      };
    }
    case BushMeshSecurityContainerKind.PairingProof:
      controlMustHaveNoOuterMetadata();
      return {
        containerVersion: 1,
        kind: 'pairing-proof',
        kindId: BushMeshSecurityContainerKind.PairingProof,
        value: decodePairingProofBody(parsed.body),
      };
    case BushMeshSecurityContainerKind.SessionOffer:
      controlMustHaveNoOuterMetadata();
      return {
        containerVersion: 1,
        kind: 'session-offer',
        kindId: BushMeshSecurityContainerKind.SessionOffer,
        value: decodeSessionOfferBody(parsed.body),
      };
    case BushMeshSecurityContainerKind.SessionResponse:
      controlMustHaveNoOuterMetadata();
      return {
        containerVersion: 1,
        kind: 'session-response',
        kindId: BushMeshSecurityContainerKind.SessionResponse,
        value: decodeSessionResponseBody(parsed.body),
      };
    case BushMeshSecurityContainerKind.WrappedGroupKeyDistribution:
      controlMustHaveNoOuterMetadata();
      return {
        containerVersion: 1,
        kind: 'wrapped-group-key-distribution',
        kindId: BushMeshSecurityContainerKind.WrappedGroupKeyDistribution,
        value: decodeWrappedGroupKeyDistributionBody(parsed.body),
      };
    case BushMeshSecurityContainerKind.IdentityRotationProof:
      controlMustHaveNoOuterMetadata();
      return {
        containerVersion: 1,
        kind: 'identity-rotation-proof',
        kindId: BushMeshSecurityContainerKind.IdentityRotationProof,
        value: decodeIdentityRotationProofBody(parsed.body),
      };
    default:
      throw new Error(`Unsupported BushMesh Security container kind ${parsed.kind}.`);
  }
}

export function classifyBushMeshDatagramPayload(
  bytes: number[] | Uint8Array,
): BushMeshDatagramPayloadClassification {
  const values = Array.from(bytes);
  if (values[0] === 0xb5 && values[1] === 0x4d) {
    return {kind: 'ordinary-bushmesh'};
  }
  if (
    values[0] === BUSHMESH_SECURITY_WIRE_MAGIC[0] &&
    values[1] === BUSHMESH_SECURITY_WIRE_MAGIC[1]
  ) {
    const version = values[2];
    if (version !== BUSHMESH_SECURITY_CONTAINER_VERSION) {
      throw new Error(`Unsupported BushMesh Security container version ${version ?? 'missing'}.`);
    }
    const containerKind = values[3];
    if (
      containerKind !== BushMeshSecurityContainerKind.ProtectedDirect &&
      containerKind !== BushMeshSecurityContainerKind.ProtectedGroup &&
      containerKind !== BushMeshSecurityContainerKind.PairingProof &&
      containerKind !== BushMeshSecurityContainerKind.SessionOffer &&
      containerKind !== BushMeshSecurityContainerKind.SessionResponse &&
      containerKind !== BushMeshSecurityContainerKind.WrappedGroupKeyDistribution &&
      containerKind !== BushMeshSecurityContainerKind.IdentityRotationProof
    ) {
      throw new Error(`Unsupported BushMesh Security container kind ${containerKind ?? 'missing'}.`);
    }
    return {kind: 'security-container', containerKind};
  }
  return {kind: 'unknown'};
}
