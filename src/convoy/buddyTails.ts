import {ConvoyVehicle, distanceMeters} from './convoy';

export type BuddyTailPoint = {
  latitude: number;
  longitude: number;
  altitudeMeters: number | null;
  receivedAtMs: number;
  packetTimestampSeconds: number;
  sequence: number;
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
  };

  if (last) {
    const samePacket =
      last.sequence === point.sequence &&
      last.packetTimestampSeconds === point.packetTimestampSeconds;
    if (samePacket) {
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
