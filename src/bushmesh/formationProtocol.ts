import {
  BUSHMESH_PROTOCOL_VERSION,
  BushMeshIdentityRef,
} from './protocol';

/**
 * Reserved inside Bushmesh protocol v1 for explicit convoy formation sharing.
 * This remains inside the development MeshCore application data type until
 * Bushmesh receives a production application-data allocation.
 */
export const BUSHMESH_FORMATION_MESSAGE_TYPE = 0x03;
export const BUSHMESH_MAX_FORMATION_MEMBERS = 23;

const IDENTITY_BYTES = 6;
const FIXED_BYTES = 22;

export type BushMeshFormationShare = {
  senderId: BushMeshIdentityRef;
  sequence: number;
  timestampSeconds: number;
  revision: number;
  cautionGapMeters: number;
  criticalGapMeters: number;
  memberIds: BushMeshIdentityRef[];
  flags?: number;
};

export type DecodedBushMeshFormationShare = BushMeshFormationShare & {
  version: number;
  type: typeof BUSHMESH_FORMATION_MESSAGE_TYPE;
};

function identityToBytes(identity: BushMeshIdentityRef): number[] {
  const normalized = identity.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(normalized)) {
    throw new Error(
      'Bushmesh formation identities must contain exactly 12 hexadecimal characters.',
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

function validateShare(share: BushMeshFormationShare): void {
  if (!Number.isInteger(share.sequence) || share.sequence < 0 || share.sequence > 0xffff) {
    throw new Error('Formation sequence must be a uint16.');
  }
  if (
    !Number.isInteger(share.timestampSeconds) ||
    share.timestampSeconds < 0 ||
    share.timestampSeconds > 0xffffffff
  ) {
    throw new Error('Formation timestamp must be a uint32.');
  }
  if (!Number.isInteger(share.revision) || share.revision < 0 || share.revision > 0xffff) {
    throw new Error('Formation revision must be a uint16.');
  }
  if (
    !Number.isInteger(share.cautionGapMeters) ||
    share.cautionGapMeters <= 0 ||
    share.cautionGapMeters > 0xffff
  ) {
    throw new Error('Formation caution gap must fit a positive uint16.');
  }
  if (
    !Number.isInteger(share.criticalGapMeters) ||
    share.criticalGapMeters <= share.cautionGapMeters ||
    share.criticalGapMeters > 0xffff
  ) {
    throw new Error(
      'Formation critical gap must fit a uint16 and exceed the caution gap.',
    );
  }
  if (
    share.memberIds.length === 0 ||
    share.memberIds.length > BUSHMESH_MAX_FORMATION_MEMBERS
  ) {
    throw new Error(
      `Formation share must contain 1-${BUSHMESH_MAX_FORMATION_MEMBERS} members.`,
    );
  }

  identityToBytes(share.senderId);
  const seen = new Set<string>();
  share.memberIds.forEach(memberId => {
    const normalized = identityFromBytes(
      Uint8Array.from(identityToBytes(memberId)),
      0,
    );
    if (seen.has(normalized)) {
      throw new Error('Formation share contains a duplicate member identity.');
    }
    seen.add(normalized);
  });
}

export function encodeBushMeshFormationShare(
  share: BushMeshFormationShare,
): Uint8Array {
  validateShare(share);

  const bytes: number[] = [
    BUSHMESH_PROTOCOL_VERSION,
    BUSHMESH_FORMATION_MESSAGE_TYPE,
    share.flags ?? 0,
    ...identityToBytes(share.senderId),
  ];
  pushUInt16(bytes, share.sequence);
  pushUInt32(bytes, share.timestampSeconds);
  pushUInt16(bytes, share.revision);
  pushUInt16(bytes, share.cautionGapMeters);
  pushUInt16(bytes, share.criticalGapMeters);
  bytes.push(share.memberIds.length);
  share.memberIds.forEach(memberId => bytes.push(...identityToBytes(memberId)));

  return Uint8Array.from(bytes);
}

export function decodeBushMeshFormationShare(
  payload: Uint8Array,
): DecodedBushMeshFormationShare {
  if (payload.length < FIXED_BYTES) {
    throw new Error('Bushmesh formation-share packet is truncated.');
  }
  if (payload[0] !== BUSHMESH_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Bushmesh protocol version ${payload[0]}.`);
  }
  if (payload[1] !== BUSHMESH_FORMATION_MESSAGE_TYPE) {
    throw new Error(`Packet is not a Bushmesh formation share: ${payload[1]}.`);
  }

  const memberCount = payload[21];
  if (memberCount < 1 || memberCount > BUSHMESH_MAX_FORMATION_MEMBERS) {
    throw new Error('Bushmesh formation-share member count is invalid.');
  }
  const expectedLength = FIXED_BYTES + memberCount * IDENTITY_BYTES;
  if (payload.length !== expectedLength) {
    throw new Error(
      `Bushmesh formation-share packet length ${payload.length} does not match ${memberCount} members.`,
    );
  }

  const memberIds: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < memberCount; index += 1) {
    const identity = identityFromBytes(
      payload,
      FIXED_BYTES + index * IDENTITY_BYTES,
    );
    if (seen.has(identity)) {
      throw new Error('Bushmesh formation-share packet repeats a member identity.');
    }
    seen.add(identity);
    memberIds.push(identity);
  }

  const decoded: DecodedBushMeshFormationShare = {
    version: payload[0],
    type: BUSHMESH_FORMATION_MESSAGE_TYPE,
    flags: payload[2],
    senderId: identityFromBytes(payload, 3),
    sequence: readUInt16(payload, 9),
    timestampSeconds: readUInt32(payload, 11),
    revision: readUInt16(payload, 15),
    cautionGapMeters: readUInt16(payload, 17),
    criticalGapMeters: readUInt16(payload, 19),
    memberIds,
  };
  validateShare(decoded);
  return decoded;
}
