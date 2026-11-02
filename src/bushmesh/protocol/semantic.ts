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
  Wait = 0x09,
  Stop = 0x0a,
  Continue = 0x0b,
  Lost = 0x0c,
  Safe = 0x0d,
  Fire = 0x0e,
  Flood = 0x0f,
  Injury = 0x10,
  LowBattery = 0x11,
  NeedFuel = 0x12,
  MeetAt = 0x13,
  Departing = 0x14,
  Delayed = 0x15,
  NeedRecovery = 0x16,
  RoadBlocked = 0x17,
  TurnAround = 0x18,
  NeedFood = 0x19,
  NeedTools = 0x1a,
  CheckIn = 0x1b,
  HoldPosition = 0x1c,
  Moving = 0x1d,
}

export enum SemanticDestination {
  Camp = 0x01,
  Home = 0x02,
  Vehicle = 0x03,
  Rendezvous = 0x04,
  Checkpoint = 0x05,
  Base = 0x06,
  WaterSource = 0x07,
  Track = 0x08,
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
    case SemanticDestination.Checkpoint:
      return 'the checkpoint';
    case SemanticDestination.Base:
      return 'base';
    case SemanticDestination.WaterSource:
      return 'the water source';
    case SemanticDestination.Track:
      return 'the track';
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
    case SemanticIntent.Wait:
      return destination ? `Wait at ${destination}.` : 'Wait.';
    case SemanticIntent.Stop:
      return 'Stop.';
    case SemanticIntent.Continue:
      return 'Continue.';
    case SemanticIntent.Lost:
      return 'I am lost.';
    case SemanticIntent.Safe:
      return 'I am safe.';
    case SemanticIntent.Fire:
      return destination ? `Fire reported at ${destination}.` : 'Fire reported.';
    case SemanticIntent.Flood:
      return destination ? `Flooding reported at ${destination}.` : 'Flooding reported.';
    case SemanticIntent.Injury:
      return 'Injury reported.';
    case SemanticIntent.LowBattery:
      return 'Battery is low.';
    case SemanticIntent.NeedFuel:
      return 'Need fuel.';
    case SemanticIntent.MeetAt:
      return destination ? `Meet at ${destination}.${eta}` : `Meet up.${eta}`;
    case SemanticIntent.Departing:
      return destination ? `Departing for ${destination}.${eta}` : `Departing.${eta}`;
    case SemanticIntent.Delayed:
      return `Delayed.${eta}`;
    case SemanticIntent.NeedRecovery:
      return 'Vehicle recovery required.';
    case SemanticIntent.RoadBlocked:
      return destination ? `Route blocked at ${destination}.` : 'Route blocked.';
    case SemanticIntent.TurnAround:
      return 'Turn around.';
    case SemanticIntent.NeedFood:
      return 'Need food.';
    case SemanticIntent.NeedTools:
      return 'Need tools.';
    case SemanticIntent.CheckIn:
      return 'Check in.';
    case SemanticIntent.HoldPosition:
      return 'Hold position.';
    case SemanticIntent.Moving:
      return destination ? `Moving toward ${destination}.${eta}` : `Moving.${eta}`;
    default:
      return `Unknown semantic intent ${message.intent}.`;
  }
}
