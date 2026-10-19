import {assertBytes, assertIntegerInRange, decodeVarUint, encodeVarUint} from './codec';
import {LocationPrecision} from './location';

export enum BushMeshControlCommand {
  RequestLocation = 1,
  RequestNodeHello = 2,
  RequestSync = 3,
  RequestAbsoluteLocation = 4,
}

export type BushMeshLocationRequest = {
  command: BushMeshControlCommand.RequestLocation;
  precision: LocationPrecision | number;
  maxAgeSeconds?: number;
};

export type BushMeshSimpleControl = {
  command:
    | BushMeshControlCommand.RequestNodeHello
    | BushMeshControlCommand.RequestAbsoluteLocation;
};

export type BushMeshSyncControl = {
  command: BushMeshControlCommand.RequestSync;
  namespace: number;
};

export type BushMeshControlPacket =
  | BushMeshLocationRequest
  | BushMeshSimpleControl
  | BushMeshSyncControl;

export function encodeControlPacket(packet: BushMeshControlPacket): number[] {
  if (packet.command === BushMeshControlCommand.RequestLocation) {
    assertIntegerInRange(packet.precision, 0, 3, 'Requested location precision');
    const hasMaxAge = packet.maxAgeSeconds !== undefined;
    if (hasMaxAge) {
      assertIntegerInRange(packet.maxAgeSeconds!, 0, 0xffffffff, 'Location max age');
    }
    return [
      packet.command,
      (packet.precision & 0x03) | (hasMaxAge ? 0x80 : 0),
      ...(hasMaxAge ? encodeVarUint(packet.maxAgeSeconds!) : []),
    ];
  }

  if (packet.command === BushMeshControlCommand.RequestSync) {
    assertIntegerInRange(packet.namespace, 0, 255, 'Sync namespace');
    return [packet.command, packet.namespace];
  }

  if (
    packet.command === BushMeshControlCommand.RequestNodeHello ||
    packet.command === BushMeshControlCommand.RequestAbsoluteLocation
  ) {
    return [packet.command];
  }

  throw new Error('Unsupported Bushmesh control command.');
}

export function decodeControlPacket(bytes: number[]): BushMeshControlPacket {
  assertBytes(bytes, 'control packet');
  const command = bytes[0];

  if (command === BushMeshControlCommand.RequestLocation) {
    const flags = bytes[1];
    if (flags === undefined) {
      throw new Error('Location request is missing precision flags.');
    }
    const precision = flags & 0x03;
    const hasMaxAge = (flags & 0x80) !== 0;
    let cursor = 2;
    let maxAgeSeconds: number | undefined;
    if (hasMaxAge) {
      const decoded = decodeVarUint(bytes, cursor);
      maxAgeSeconds = decoded.value;
      cursor = decoded.nextOffset;
    }
    if (cursor !== bytes.length) {
      throw new Error('Unexpected bytes after location request.');
    }
    return {
      command: BushMeshControlCommand.RequestLocation,
      precision,
      maxAgeSeconds,
    };
  }

  if (command === BushMeshControlCommand.RequestSync) {
    if (bytes.length !== 2 || bytes[1] === undefined) {
      throw new Error('Sync request must contain exactly one namespace byte.');
    }
    return {command: BushMeshControlCommand.RequestSync, namespace: bytes[1]};
  }

  if (
    command === BushMeshControlCommand.RequestNodeHello ||
    command === BushMeshControlCommand.RequestAbsoluteLocation
  ) {
    if (bytes.length !== 1) {
      throw new Error('Simple control request contains unexpected bytes.');
    }
    return {command};
  }

  throw new Error(`Unknown Bushmesh control command ${command}.`);
}
