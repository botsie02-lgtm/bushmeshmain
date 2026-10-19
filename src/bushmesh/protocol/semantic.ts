import {
  assertBytes,
  assertIntegerInRange,
  decodeVarUint,
  encodeVarUint,
} from './codec';

export enum SemanticIntent {
  Yes = 0x01,
  No = 0x02,
  Help = 0x03,
  Returning = 0x04,
  Arrived = 0x05,
  NeedWater = 0x06,
  VehicleProblem = 0x07,
  Medical = 0x08,
}

export enum SemanticDestination {
  Camp = 0x01,
  Home = 0x02,
  Vehicle = 0x03,
  Rendezvous = 0x04,
}

export type SemanticMessage = {
  intent: SemanticIntent | number;
  destination?: SemanticDestination | number;
  etaMinutes?: number;
  quantity?: number;
};

export function encodeSemanticMessage(message: SemanticMessage): number[] {
  assertIntegerInRange(message.intent, 0, 255, 'Semantic intent');

  let flags = 0;
  const payload: number[] = [message.intent, 0];

  if (message.destination !== undefined) {
    assertIntegerInRange(message.destination, 0, 255, 'Semantic destination');
    flags |= 0x01;
    payload.push(message.destination);
  }

  if (message.etaMinutes !== undefined) {
    assertIntegerInRange(message.etaMinutes, 0, 0xffffffff, 'ETA minutes');
    flags |= 0x02;
    payload.push(...encodeVarUint(message.etaMinutes));
  }

  if (message.quantity !== undefined) {
    assertIntegerInRange(message.quantity, 0, 0xffffffff, 'Semantic quantity');
    flags |= 0x04;
    payload.push(...encodeVarUint(message.quantity));
  }

  payload[1] = flags;
  return payload;
}

export function decodeSemanticMessage(bytes: number[]): SemanticMessage {
  assertBytes(bytes);

  if (bytes.length < 2) {
    throw new Error('Semantic payload is too short.');
  }

  const intent = bytes[0];
  const flags = bytes[1];
  let cursor = 2;
  let destination: number | undefined;
  let etaMinutes: number | undefined;
  let quantity: number | undefined;

  if ((flags & 0x01) !== 0) {
    destination = bytes[cursor];

    if (destination === undefined) {
      throw new Error('Semantic destination is missing.');
    }

    cursor += 1;
  }

  if ((flags & 0x02) !== 0) {
    const eta = decodeVarUint(bytes, cursor);
    etaMinutes = eta.value;
    cursor = eta.nextOffset;
  }

  if ((flags & 0x04) !== 0) {
    const decodedQuantity = decodeVarUint(bytes, cursor);
    quantity = decodedQuantity.value;
    cursor = decodedQuantity.nextOffset;
  }

  if (cursor !== bytes.length) {
    throw new Error('Unexpected bytes after semantic payload.');
  }

  return {intent, destination, etaMinutes, quantity};
}

function destinationLabel(destination: number | undefined): string | null {
  switch (destination) {
    case SemanticDestination.Camp:
      return 'camp';
    case SemanticDestination.Home:
      return 'home';
    case SemanticDestination.Vehicle:
      return 'the vehicle';
    case SemanticDestination.Rendezvous:
      return 'the rendezvous point';
    default:
      return null;
  }
}

export function renderSemanticMessage(message: SemanticMessage): string {
  const destination = destinationLabel(message.destination);
  const eta =
    message.etaMinutes !== undefined
      ? ` ETA approximately ${message.etaMinutes} minutes.`
      : '';

  switch (message.intent) {
    case SemanticIntent.Yes:
      return 'Yes.';
    case SemanticIntent.No:
      return 'No.';
    case SemanticIntent.Help:
      return destination
        ? `Help required at ${destination}.${eta}`
        : `Help required.${eta}`;
    case SemanticIntent.Returning:
      return destination
        ? `Returning to ${destination}.${eta}`
        : `Returning.${eta}`;
    case SemanticIntent.Arrived:
      return destination ? `Arrived at ${destination}.` : 'Arrived.';
    case SemanticIntent.NeedWater:
      return 'Need water.';
    case SemanticIntent.VehicleProblem:
      return 'Vehicle problem.';
    case SemanticIntent.Medical:
      return destination
        ? `Medical assistance required at ${destination}.`
        : 'Medical assistance required.';
    default:
      return `Unknown semantic intent ${message.intent}.`;
  }
}
