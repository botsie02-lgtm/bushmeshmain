export enum BushMeshPacketType {
  Control = 0x00,
  Location = 0x01,
  Text = 0x02,
  Semantic = 0x03,
  Fragment = 0x04,
  FragmentAck = 0x05,
}

export enum BushMeshPriority {
  Routine = 0x00,
  High = 0x01,
  Emergency = 0x02,
}

export enum BushMeshCompressionProfile {
  None = 0x00,
  Gps = 0x01,
  Semantic = 0x02,
}

export enum LocationPrecision {
  Approx10M = 0x00,
  Approx3M = 0x01,
  Approx1M = 0x02,
}

export enum SemanticIntent {
  Status = 0x00,
  Returning = 0x01,
  Stopping = 0x02,
  Delayed = 0x03,
  NeedHelp = 0x04,
}

export enum SemanticDestination {
  Unknown = 0x00,
  Camp = 0x01,
  Convoy = 0x02,
  Fuel = 0x03,
  Home = 0x04,
}

export type DecodedVarUint = {
  value: number;
  nextOffset: number;
};

export type BushMeshEnvelope = {
  type: BushMeshPacketType;
  priority: BushMeshPriority;
  compression: BushMeshCompressionProfile;
  messageId: number;
  ackRequested?: boolean;
  storeAndForward?: boolean;
  ttlHops?: number;
  payload: number[];
};

export type DecodedBushMeshEnvelope = BushMeshEnvelope & {
  version: number;
  ackRequested: boolean;
  storeAndForward: boolean;
  ttlHops: number;
};

export type LocationPayload = {
  latitude: number;
  longitude: number;
  precision: LocationPrecision;
  batteryPercent?: number | null;
};

export type DecodedLocationPayload = LocationPayload & {
  batteryPercent: number | null;
};

export type LocationDelta = {
  northMetres: number;
  eastMetres: number;
};

export type SemanticMessage = {
  intent: SemanticIntent;
  destination?: SemanticDestination | null;
  etaMinutes?: number | null;
};

export type DecodedSemanticMessage = {
  intent: SemanticIntent;
  destination: SemanticDestination | null;
  etaMinutes: number | null;
};

export type BushMeshFragment = {
  messageId: number;
  index: number;
  totalFragments: number;
  bytes: number[];
};

export type FragmentAcceptResult = {
  messageId: number;
  complete: boolean;
  data: number[] | null;
  receivedFragments: number[];
  missingFragments: number[];
};

export type DecodedFragmentAck = {
  messageId: number;
  totalFragments: number;
  receivedFragments: number[];
  missingFragments: number[];
};

const WIRE_PROTOCOL_VERSION = 1;
const MAX_U24 = 0xffffff;
const UNKNOWN_BATTERY = 0x7f;

function assertByteArray(bytes: number[]): void {
  if (bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) {
    throw new Error('Bushmesh wire data must contain bytes between 0 and 255.');
  }
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer.`);
  }
}

export function encodeVarUint(value: number): number[] {
  assertSafeInteger(value, 'VarUint value');
  if (value < 0) {
    throw new Error('VarUint value cannot be negative.');
  }

  const bytes: number[] = [];
  let remaining = value;

  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining > 0);

  return bytes;
}

export function decodeVarUint(
  bytes: number[] | Uint8Array,
  offset = 0,
): DecodedVarUint {
  const data = Array.from(bytes);
  let value = 0;
  let multiplier = 1;
  let index = offset;

  for (; index < data.length; index += 1) {
    const byte = data[index];
    value += (byte & 0x7f) * multiplier;

    if (!Number.isSafeInteger(value)) {
      throw new Error('VarUint exceeds JavaScript safe integer range.');
    }

    if ((byte & 0x80) === 0) {
      return {value, nextOffset: index + 1};
    }

    multiplier *= 128;
    if (!Number.isSafeInteger(multiplier)) {
      throw new Error('VarUint is too long.');
    }
  }

  throw new Error('Truncated VarUint.');
}

export function encodeSignedVarInt(value: number): number[] {
  assertSafeInteger(value, 'Signed varint value');
  const zigZag = value >= 0 ? value * 2 : -value * 2 - 1;
  if (!Number.isSafeInteger(zigZag)) {
    throw new Error('Signed varint exceeds JavaScript safe integer range.');
  }
  return encodeVarUint(zigZag);
}

export function decodeSignedVarInt(
  bytes: number[] | Uint8Array,
  offset = 0,
): DecodedVarUint {
  const decoded = decodeVarUint(bytes, offset);
  const value =
    decoded.value % 2 === 0
      ? decoded.value / 2
      : -((decoded.value + 1) / 2);
  return {value, nextOffset: decoded.nextOffset};
}

export function encodeEnvelope(envelope: BushMeshEnvelope): number[] {
  if (envelope.type < 0 || envelope.type > 0x3f) {
    throw new Error('Bushmesh packet type must fit in 6 bits.');
  }

  const ttlHops = envelope.ttlHops ?? 0;
  if (!Number.isInteger(ttlHops) || ttlHops < 0 || ttlHops > 0xff) {
    throw new Error('Bushmesh TTL hops must be between 0 and 255.');
  }

  assertByteArray(envelope.payload);

  const header0 =
    ((WIRE_PROTOCOL_VERSION & 0x03) << 6) | (envelope.type & 0x3f);
  const header1 =
    ((envelope.priority & 0x03) << 6) |
    ((envelope.compression & 0x03) << 4) |
    (envelope.ackRequested ? 0x08 : 0) |
    (envelope.storeAndForward ? 0x04 : 0);

  return [
    header0,
    header1,
    ttlHops,
    ...encodeVarUint(envelope.messageId),
    ...envelope.payload,
  ];
}

export function decodeEnvelope(
  bytes: number[] | Uint8Array,
): DecodedBushMeshEnvelope {
  const data = Array.from(bytes);
  if (data.length < 4) {
    throw new Error('Bushmesh envelope is too short.');
  }

  const version = (data[0] >>> 6) & 0x03;
  if (version !== WIRE_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Bushmesh wire version ${version}.`);
  }

  const messageId = decodeVarUint(data, 3);

  return {
    version,
    type: (data[0] & 0x3f) as BushMeshPacketType,
    priority: ((data[1] >>> 6) & 0x03) as BushMeshPriority,
    compression: ((data[1] >>> 4) & 0x03) as BushMeshCompressionProfile,
    ackRequested: (data[1] & 0x08) !== 0,
    storeAndForward: (data[1] & 0x04) !== 0,
    ttlHops: data[2],
    messageId: messageId.value,
    payload: data.slice(messageId.nextOffset),
  };
}

function precisionStepDegrees(precision: LocationPrecision): number {
  switch (precision) {
    case LocationPrecision.Approx10M:
      return 0.0001;
    case LocationPrecision.Approx3M:
      return 0.00003;
    case LocationPrecision.Approx1M:
    default:
      return 0.00001;
  }
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function encodeNormalizedU24(value: number, min: number, max: number): number[] {
  const normalized = Math.round(((value - min) / (max - min)) * MAX_U24);
  const safe = Math.max(0, Math.min(MAX_U24, normalized));
  return [safe & 0xff, (safe >>> 8) & 0xff, (safe >>> 16) & 0xff];
}

function decodeNormalizedU24(
  bytes: number[],
  offset: number,
  min: number,
  max: number,
): number {
  const raw = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  return min + (raw / MAX_U24) * (max - min);
}

export function encodeLocationPayload(location: LocationPayload): number[] {
  if (
    !Number.isFinite(location.latitude) ||
    location.latitude < -90 ||
    location.latitude > 90
  ) {
    throw new Error('Latitude must be between -90 and 90 degrees.');
  }
  if (
    !Number.isFinite(location.longitude) ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    throw new Error('Longitude must be between -180 and 180 degrees.');
  }

  const step = precisionStepDegrees(location.precision);
  const latitude = quantize(location.latitude, step);
  const longitude = quantize(location.longitude, step);
  const battery =
    location.batteryPercent == null
      ? UNKNOWN_BATTERY
      : Math.max(0, Math.min(100, Math.round(location.batteryPercent)));

  return [
    ...encodeNormalizedU24(latitude, -90, 90),
    ...encodeNormalizedU24(longitude, -180, 180),
    location.precision & 0x03,
    battery & 0x7f,
  ];
}

export function decodeLocationPayload(
  bytes: number[] | Uint8Array,
): DecodedLocationPayload {
  const data = Array.from(bytes);
  if (data.length !== 8) {
    throw new Error(`Bushmesh location payload must be 8 bytes; got ${data.length}.`);
  }

  const precision = (data[6] & 0x03) as LocationPrecision;
  const step = precisionStepDegrees(precision);
  const latitude = quantize(
    decodeNormalizedU24(data, 0, -90, 90),
    step,
  );
  const longitude = quantize(
    decodeNormalizedU24(data, 3, -180, 180),
    step,
  );
  const batteryRaw = data[7] & 0x7f;

  return {
    latitude,
    longitude,
    precision,
    batteryPercent: batteryRaw === UNKNOWN_BATTERY ? null : Math.min(100, batteryRaw),
  };
}

export function encodeLocationDelta(delta: LocationDelta): number[] {
  return [
    ...encodeSignedVarInt(delta.northMetres),
    ...encodeSignedVarInt(delta.eastMetres),
  ];
}

export function decodeLocationDelta(
  bytes: number[] | Uint8Array,
): LocationDelta {
  const north = decodeSignedVarInt(bytes, 0);
  const east = decodeSignedVarInt(bytes, north.nextOffset);
  if (east.nextOffset !== bytes.length) {
    throw new Error('Bushmesh location delta has trailing bytes.');
  }
  return {northMetres: north.value, eastMetres: east.value};
}

export function encodeSemanticMessage(message: SemanticMessage): number[] {
  let flags = 0;
  const fields: number[] = [];

  if (message.destination != null) {
    flags |= 0x01;
    fields.push(message.destination);
  }

  if (message.etaMinutes != null) {
    assertSafeInteger(message.etaMinutes, 'ETA minutes');
    if (message.etaMinutes < 0) {
      throw new Error('ETA minutes cannot be negative.');
    }
    flags |= 0x02;
    fields.push(...encodeVarUint(message.etaMinutes));
  }

  return [message.intent, flags, ...fields];
}

export function decodeSemanticMessage(
  bytes: number[] | Uint8Array,
): DecodedSemanticMessage {
  const data = Array.from(bytes);
  if (data.length < 2) {
    throw new Error('Bushmesh semantic message is too short.');
  }

  const intent = data[0] as SemanticIntent;
  const flags = data[1];
  let offset = 2;
  let destination: SemanticDestination | null = null;
  let etaMinutes: number | null = null;

  if ((flags & 0x01) !== 0) {
    if (offset >= data.length) {
      throw new Error('Semantic destination is missing.');
    }
    destination = data[offset] as SemanticDestination;
    offset += 1;
  }

  if ((flags & 0x02) !== 0) {
    const eta = decodeVarUint(data, offset);
    etaMinutes = eta.value;
    offset = eta.nextOffset;
  }

  if (offset !== data.length) {
    throw new Error('Bushmesh semantic message has trailing bytes.');
  }

  return {intent, destination, etaMinutes};
}

function intentPhrase(intent: SemanticIntent): string {
  switch (intent) {
    case SemanticIntent.Returning:
      return 'Returning';
    case SemanticIntent.Stopping:
      return 'Stopping';
    case SemanticIntent.Delayed:
      return 'Delayed';
    case SemanticIntent.NeedHelp:
      return 'Need help';
    case SemanticIntent.Status:
    default:
      return 'Status';
  }
}

function destinationPhrase(destination: SemanticDestination | null): string | null {
  switch (destination) {
    case SemanticDestination.Camp:
      return 'camp';
    case SemanticDestination.Convoy:
      return 'the convoy';
    case SemanticDestination.Fuel:
      return 'fuel';
    case SemanticDestination.Home:
      return 'home';
    case SemanticDestination.Unknown:
    case null:
    default:
      return null;
  }
}

export function renderSemanticMessage(message: DecodedSemanticMessage): string {
  const intent = intentPhrase(message.intent);
  const destination = destinationPhrase(message.destination);
  let sentence = destination ? `${intent} to ${destination}.` : `${intent}.`;

  if (message.etaMinutes != null) {
    sentence += ` ETA approximately ${message.etaMinutes} minutes.`;
  }

  return sentence;
}

function decodeFragment(bytes: number[] | Uint8Array): BushMeshFragment & {data: number[]} {
  const data = Array.from(bytes);
  const message = decodeVarUint(data, 0);
  if (message.nextOffset + 2 > data.length) {
    throw new Error('Bushmesh fragment header is truncated.');
  }

  const index = data[message.nextOffset];
  const totalFragments = data[message.nextOffset + 1];
  if (totalFragments < 1 || index >= totalFragments) {
    throw new Error('Bushmesh fragment index/count is invalid.');
  }

  return {
    messageId: message.value,
    index,
    totalFragments,
    bytes: data,
    data: data.slice(message.nextOffset + 2),
  };
}

export function fragmentPayload(
  messageId: number,
  payload: number[] | Uint8Array,
  maxFragmentPayloadBytes: number,
): BushMeshFragment[] {
  const data = Array.from(payload);
  assertByteArray(data);
  if (!Number.isInteger(maxFragmentPayloadBytes) || maxFragmentPayloadBytes < 1) {
    throw new Error('Maximum fragment payload must be at least 1 byte.');
  }

  const totalFragments = Math.max(1, Math.ceil(data.length / maxFragmentPayloadBytes));
  if (totalFragments > 0xff) {
    throw new Error('Bushmesh fragment count cannot exceed 255.');
  }

  const messageIdBytes = encodeVarUint(messageId);
  const fragments: BushMeshFragment[] = [];

  for (let index = 0; index < totalFragments; index += 1) {
    const chunk = data.slice(
      index * maxFragmentPayloadBytes,
      (index + 1) * maxFragmentPayloadBytes,
    );
    fragments.push({
      messageId,
      index,
      totalFragments,
      bytes: [...messageIdBytes, index, totalFragments, ...chunk],
    });
  }

  return fragments;
}

type ReassemblyState = {
  totalFragments: number;
  fragments: Map<number, number[]>;
};

export class BushMeshFragmentReassembler {
  private readonly states = new Map<number, ReassemblyState>();

  accept(bytes: number[] | Uint8Array): FragmentAcceptResult {
    const fragment = decodeFragment(bytes);
    let state = this.states.get(fragment.messageId);

    if (!state) {
      state = {
        totalFragments: fragment.totalFragments,
        fragments: new Map<number, number[]>(),
      };
      this.states.set(fragment.messageId, state);
    }

    if (state.totalFragments !== fragment.totalFragments) {
      throw new Error('Fragment count changed during reassembly.');
    }

    if (!state.fragments.has(fragment.index)) {
      state.fragments.set(fragment.index, fragment.data);
    }

    const receivedFragments = Array.from(state.fragments.keys()).sort((a, b) => a - b);
    const missingFragments = this.missingForState(state);

    if (missingFragments.length > 0) {
      return {
        messageId: fragment.messageId,
        complete: false,
        data: null,
        receivedFragments,
        missingFragments,
      };
    }

    const completeData: number[] = [];
    for (let index = 0; index < state.totalFragments; index += 1) {
      completeData.push(...(state.fragments.get(index) ?? []));
    }
    this.states.delete(fragment.messageId);

    return {
      messageId: fragment.messageId,
      complete: true,
      data: completeData,
      receivedFragments,
      missingFragments: [],
    };
  }

  getMissing(messageId: number): number[] | null {
    const state = this.states.get(messageId);
    return state ? this.missingForState(state) : null;
  }

  reset(messageId?: number): void {
    if (messageId == null) {
      this.states.clear();
    } else {
      this.states.delete(messageId);
    }
  }

  private missingForState(state: ReassemblyState): number[] {
    const missing: number[] = [];
    for (let index = 0; index < state.totalFragments; index += 1) {
      if (!state.fragments.has(index)) {
        missing.push(index);
      }
    }
    return missing;
  }
}

export function encodeFragmentAck(
  messageId: number,
  totalFragments: number,
  receivedFragments: number[],
): number[] {
  if (!Number.isInteger(totalFragments) || totalFragments < 1 || totalFragments > 0xff) {
    throw new Error('ACK fragment count must be between 1 and 255.');
  }

  const bitmap = new Array<number>(Math.ceil(totalFragments / 8)).fill(0);
  for (const index of receivedFragments) {
    if (!Number.isInteger(index) || index < 0 || index >= totalFragments) {
      throw new Error(`ACK fragment index ${index} is out of range.`);
    }
    bitmap[Math.floor(index / 8)] |= 1 << (index % 8);
  }

  return [...encodeVarUint(messageId), totalFragments, ...bitmap];
}

export function decodeFragmentAck(
  bytes: number[] | Uint8Array,
): DecodedFragmentAck {
  const data = Array.from(bytes);
  const message = decodeVarUint(data, 0);
  if (message.nextOffset >= data.length) {
    throw new Error('Fragment ACK is missing a fragment count.');
  }

  const totalFragments = data[message.nextOffset];
  if (totalFragments < 1) {
    throw new Error('Fragment ACK count must be at least 1.');
  }

  const bitmap = data.slice(message.nextOffset + 1);
  const requiredBytes = Math.ceil(totalFragments / 8);
  if (bitmap.length !== requiredBytes) {
    throw new Error('Fragment ACK bitmap length is invalid.');
  }

  const receivedFragments: number[] = [];
  const missingFragments: number[] = [];
  for (let index = 0; index < totalFragments; index += 1) {
    const received = (bitmap[Math.floor(index / 8)] & (1 << (index % 8))) !== 0;
    (received ? receivedFragments : missingFragments).push(index);
  }

  return {
    messageId: message.value,
    totalFragments,
    receivedFragments,
    missingFragments,
  };
}
