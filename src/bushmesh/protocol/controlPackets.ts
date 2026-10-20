import {assertBytes, assertIntegerInRange, decodeVarUint, encodeVarUint} from './codec';
import {LocationPrecision} from './location';

export enum BushMeshControlCommand {
  RequestLocation = 1,
  RequestNodeHello = 2,
  RequestSync = 3,
  RequestAbsoluteLocation = 4,
  ConvoyAction = 5,
}

export enum BushMeshConvoyAction {
  Hold = 1,
  Proceed = 2,
  Regroup = 3,
  TurnAround = 4,
  Obstacle = 5,
  Recovery = 6,
  FuelStop = 7,
  CheckIn = 8,
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

export type BushMeshConvoyActionControl = {
  command: BushMeshControlCommand.ConvoyAction;
  convoyId: number;
  originNodeId: number;
  sequence: number;
  action: BushMeshConvoyAction | number;
  targetOrderIndex?: number;
  etaMinutes?: number;
};

export type BushMeshControlPacket =
  | BushMeshLocationRequest
  | BushMeshSimpleControl
  | BushMeshSyncControl
  | BushMeshConvoyActionControl;

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

  if (packet.command === BushMeshControlCommand.ConvoyAction) {
    assertIntegerInRange(packet.convoyId, 0, 0xffffffff, 'Convoy ID');
    assertIntegerInRange(packet.originNodeId, 0, 0xffffffff, 'Convoy command origin');
    assertIntegerInRange(packet.sequence, 0, 0xffffffff, 'Convoy command sequence');
    assertIntegerInRange(packet.action, 1, 255, 'Convoy action');

    let flags = 0;
    const optional: number[] = [];

    if (packet.targetOrderIndex !== undefined) {
      assertIntegerInRange(
        packet.targetOrderIndex,
        0,
        0xffff,
        'Convoy target position',
      );
      flags |= 0x01;
      optional.push(...encodeVarUint(packet.targetOrderIndex));
    }

    if (packet.etaMinutes !== undefined) {
      assertIntegerInRange(packet.etaMinutes, 0, 0xffff, 'Convoy action ETA');
      flags |= 0x02;
      optional.push(...encodeVarUint(packet.etaMinutes));
    }

    return [
      packet.command,
      packet.action,
      flags,
      ...encodeVarUint(packet.convoyId),
      ...encodeVarUint(packet.originNodeId),
      ...encodeVarUint(packet.sequence),
      ...optional,
    ];
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

  if (command === BushMeshControlCommand.ConvoyAction) {
    const action = bytes[1];
    const flags = bytes[2];
    if (action === undefined || action === 0 || flags === undefined) {
      throw new Error('Convoy action header is truncated or invalid.');
    }

    const convoyId = decodeVarUint(bytes, 3);
    const originNodeId = decodeVarUint(bytes, convoyId.nextOffset);
    const sequence = decodeVarUint(bytes, originNodeId.nextOffset);
    let cursor = sequence.nextOffset;
    let targetOrderIndex: number | undefined;
    let etaMinutes: number | undefined;

    if ((flags & 0x01) !== 0) {
      const target = decodeVarUint(bytes, cursor);
      if (target.value > 0xffff) {
        throw new Error('Convoy target position exceeds uint16 range.');
      }
      targetOrderIndex = target.value;
      cursor = target.nextOffset;
    }

    if ((flags & 0x02) !== 0) {
      const eta = decodeVarUint(bytes, cursor);
      if (eta.value > 0xffff) {
        throw new Error('Convoy action ETA exceeds uint16 range.');
      }
      etaMinutes = eta.value;
      cursor = eta.nextOffset;
    }

    if (cursor !== bytes.length) {
      throw new Error('Unexpected bytes after convoy action command.');
    }

    return {
      command: BushMeshControlCommand.ConvoyAction,
      convoyId: convoyId.value,
      originNodeId: originNodeId.value,
      sequence: sequence.value,
      action,
      targetOrderIndex,
      etaMinutes,
    };
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
