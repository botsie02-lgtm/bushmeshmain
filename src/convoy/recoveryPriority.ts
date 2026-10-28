import {BuddyTail} from './buddyTails';
import {ConvoyFreshness, ConvoyVehicle, getConvoyFreshness, positionAgeSeconds} from './convoy';
import {RecoveryObservedMotion, getRecoveryObservedMotion} from './recoveryMotion';
import {RecoverySearchArea, buildRecoverySearchArea} from './recoverySearchArea';
import {RecoveryTrailAssessment, assessRecoveryTrail} from './recoveryTrail';

export type RecoveryPriorityLevel = 'critical' | 'high' | 'watch';

export type ConvoyRecoveryCase = {
  vehicle: ConvoyVehicle;
  freshness: Extract<ConvoyFreshness, 'stale' | 'lost'>;
  ageSeconds: number;
  level: RecoveryPriorityLevel;
  trail: RecoveryTrailAssessment | null;
  observedMotion: RecoveryObservedMotion | null;
  searchArea: RecoverySearchArea | null;
  reason: string;
  sortWeight: number;
};

function trailWeight(trail: RecoveryTrailAssessment | null): number {
  if (!trail) {
    return 16;
  }
  switch (trail.state) {
    case 'broken':
      return 24;
    case 'stale':
      return 16;
    case 'aging':
      return 8;
    case 'usable':
      return 0;
  }
}

function levelFor(
  freshness: Extract<ConvoyFreshness, 'stale' | 'lost'>,
  trail: RecoveryTrailAssessment | null,
  searchArea: RecoverySearchArea | null,
): RecoveryPriorityLevel {
  if (
    freshness === 'lost' &&
    (!trail || trail.state === 'broken' || (searchArea?.radiusMeters ?? 0) >= 1_500)
  ) {
    return 'critical';
  }
  if (freshness === 'lost' || trail?.state === 'broken') {
    return 'high';
  }
  return 'watch';
}

function reasonFor(
  freshness: Extract<ConvoyFreshness, 'stale' | 'lost'>,
  trail: RecoveryTrailAssessment | null,
  searchArea: RecoverySearchArea | null,
): string {
  if (freshness === 'lost' && !trail) {
    return 'Vehicle is lost and there is no retained buddy trail.';
  }
  if (trail?.state === 'broken') {
    return 'Vehicle is missing and the retained trail contains a discontinuity.';
  }
  if (searchArea && searchArea.radiusMeters >= 1_500) {
    return 'Last-known position has developed a broad uncertainty area.';
  }
  if (freshness === 'lost') {
    return 'Vehicle has exceeded the lost-position threshold.';
  }
  return 'Vehicle position is stale and the current convoy gap is unknown.';
}

export function prioritizeConvoyRecoveryCases(
  vehicles: ConvoyVehicle[],
  buddyTails: BuddyTail[],
  nowMs = Date.now(),
): ConvoyRecoveryCase[] {
  const tails = new Map(buddyTails.map(tail => [tail.vehicleId, tail]));

  return vehicles
    .flatMap(vehicle => {
      const freshness = getConvoyFreshness(vehicle.receivedAtMs, nowMs);
      if (freshness !== 'stale' && freshness !== 'lost') {
        return [];
      }

      const tail = tails.get(vehicle.id);
      const trail = assessRecoveryTrail(tail, nowMs);
      const observedMotion = getRecoveryObservedMotion(tail, nowMs);
      const searchArea = buildRecoverySearchArea(vehicle, nowMs);
      const ageSeconds = positionAgeSeconds(vehicle.receivedAtMs, nowMs);
      const uncertaintyWeight = Math.min(
        30,
        Math.floor((searchArea?.radiusMeters ?? 0) / 100),
      );
      const sortWeight =
        (freshness === 'lost' ? 100 : 50) +
        Math.min(30, Math.floor(ageSeconds / 60)) +
        trailWeight(trail) +
        uncertaintyWeight;

      return [
        {
          vehicle,
          freshness,
          ageSeconds,
          level: levelFor(freshness, trail, searchArea),
          trail,
          observedMotion,
          searchArea,
          reason: reasonFor(freshness, trail, searchArea),
          sortWeight,
        } satisfies ConvoyRecoveryCase,
      ];
    })
    .sort((left, right) => {
      if (right.sortWeight !== left.sortWeight) {
        return right.sortWeight - left.sortWeight;
      }
      return left.vehicle.receivedAtMs - right.vehicle.receivedAtMs;
    });
}
