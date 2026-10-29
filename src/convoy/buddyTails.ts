import {compareBushMeshPacketClock} from '../bushmesh/replayGuard';
import {ConvoyVehicle, distanceMeters} from './convoy';

export type BuddyTailPoint = {
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  receivedAtMs: number;
  packetTimestampSeconds: number;
  sequence: number;
  /** Link/GPS evidence is optional for backward-compatible restored/manual tails. */
  snrDb?: number | null;
  pathLength?: number | null;
  accuracyMeters?: number | null;
};

export type BuddyTail = {
  vehicleId: string;
  points: BuddyTailPoint[];
};

const MAX_TAIL_POINTS = 80;
const MIN_TAIL_DISTANCE_METERS = 4;
const MAX_TAIL_AGE_MS = 6 * 60 * 60 * 1000;

export function appendBuddyTailPoint(
  current: BuddyTail | undefined,
  vehicle: ConvoyVehicle,
  nowMs = Date.now(),
): BuddyTail {
  const cutoff = nowMs - MAX_TAIL_AGE_MS;
  const retained = (current?.points ?? []).filter(
    point => point.receivedAtMs >= cutoff,
  );
  const last = retained[retained.length - 1];

  const point: BuddyTailPoint = {
    latitude: vehicle.latitude,
    longitude: vehicle.longitude,
    altitudeMeters: vehicle.altitudeMeters,
    receivedAtMs: vehicle.receivedAtMs,
    packetTimestampSeconds: vehicle.packetTimestampSeconds,
    sequence: vehicle.sequence,
    snrDb: vehicle.snrDb,
    pathLength: vehicle.pathLength,
    accuracyMeters: vehicle.accuracyMeters,
  };

  if (last) {
    const order = compareBushMeshPacketClock(
      {
        timestampSeconds: last.packetTimestampSeconds,
        sequence: last.sequence,
      },
      {
        timestampSeconds: point.packetTimestampSeconds,
        sequence: point.sequence,
      },
    );

    if (order !== 'newer') {
      return {vehicleId: vehicle.id, points: retained};
    }

    const movement = distanceMeters(last, point);
    if (
      movement < MIN_TAIL_DISTANCE_METERS &&
      point.receivedAtMs - last.receivedAtMs < 30_000
    ) {
      const replaced = retained.slice(0, -1);
      replaced.push(point);
      return {
        vehicleId: vehicle.id,
        points: replaced.slice(-MAX_TAIL_POINTS),
      };
    }
  }

  return {
    vehicleId: vehicle.id,
    points: [...retained, point].slice(-MAX_TAIL_POINTS),
  };
}

export function buddyTailDistanceMeters(tail: BuddyTail): number {
  let total = 0;
  for (let index = 1; index < tail.points.length; index += 1) {
    total += distanceMeters(tail.points[index - 1], tail.points[index]);
  }
  return total;
}
