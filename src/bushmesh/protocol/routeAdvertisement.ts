import {
  assertBytes,
  assertIntegerInRange,
  decodeVarUint,
  encodeVarUint,
} from './codec';
import {BushMeshRoutingTable} from './routing';

export type BushMeshRouteAdvertisement = {
  destinationNodeId: number;
  sequence: number;
  hopCount: number;
  pathQuality: number;
};

export function encodeRouteAdvertisement(
  advertisement: BushMeshRouteAdvertisement,
): number[] {
  assertIntegerInRange(
    advertisement.destinationNodeId,
    0,
    0xffffffff,
    'Route destination node ID',
  );
  assertIntegerInRange(advertisement.sequence, 0, 0xffffffff, 'Route sequence');
  assertIntegerInRange(advertisement.hopCount, 0, 254, 'Route hop count');

  if (
    !Number.isFinite(advertisement.pathQuality) ||
    advertisement.pathQuality < 0 ||
    advertisement.pathQuality > 100
  ) {
    throw new Error('Route path quality must be from 0 to 100.');
  }

  return [
    Math.round(advertisement.pathQuality),
    ...encodeVarUint(advertisement.destinationNodeId),
    ...encodeVarUint(advertisement.sequence),
    ...encodeVarUint(advertisement.hopCount),
  ];
}

export function decodeRouteAdvertisement(
  bytes: number[],
): BushMeshRouteAdvertisement {
  assertBytes(bytes);

  const pathQuality = bytes[0];

  if (pathQuality === undefined || pathQuality > 100) {
    throw new Error('Route advertisement path quality is invalid.');
  }

  const destination = decodeVarUint(bytes, 1);
  const sequence = decodeVarUint(bytes, destination.nextOffset);
  const hopCount = decodeVarUint(bytes, sequence.nextOffset);

  if (hopCount.value > 254 || hopCount.nextOffset !== bytes.length) {
    throw new Error('Route advertisement hop count or length is invalid.');
  }

  return {
    destinationNodeId: destination.value,
    sequence: sequence.value,
    hopCount: hopCount.value,
    pathQuality,
  };
}

export function learnRouteAdvertisement(
  table: BushMeshRoutingTable,
  advertisement: BushMeshRouteAdvertisement,
  previousHopNodeId: number,
  previousHopLinkScore: number,
  options?: {now?: number; ttlMs?: number},
): void {
  const combinedScore =
    previousHopLinkScore * 0.7 + advertisement.pathQuality * 0.3;

  table.learn({
    destinationNodeId: advertisement.destinationNodeId,
    nextHopNodeId: previousHopNodeId,
    hopCount: advertisement.hopCount + 1,
    linkScore: combinedScore,
    now: options?.now,
    ttlMs: options?.ttlMs,
  });
}
