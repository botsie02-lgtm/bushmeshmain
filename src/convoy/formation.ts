import {
  ConvoyFreshness,
  ConvoyVehicle,
  Coordinate,
  distanceMeters,
  getConvoyFreshness,
} from './convoy';
import {ConvoyGapDecision, getConvoyGapDecision} from './gapMonitor';

export type ConvoyFormationRole = 'lead' | 'member' | 'tail';

export type ConvoyFormationMember = {
  id: string;
  label: string;
  kind: 'self' | 'vehicle';
};

export type ConvoyFormationPlan = {
  members: ConvoyFormationMember[];
  cautionGapMeters?: number;
  criticalGapMeters?: number;
};

export type ConvoyFormationMemberState = {
  id: string;
  label: string;
  kind: ConvoyFormationMember['kind'];
  role: ConvoyFormationRole;
  orderIndex: number;
  freshness: ConvoyFreshness | 'self' | 'unavailable';
  position: Coordinate | null;
  aheadId: string | null;
  behindId: string | null;
  gapToAhead: ConvoyGapDecision | null;
  gapToBehind: ConvoyGapDecision | null;
};

export type ConvoyFormationSnapshot = {
  members: ConvoyFormationMemberState[];
  worstGapState: ConvoyGapDecision['state'] | 'none';
  alertCount: number;
  unknownGapCount: number;
  complete: boolean;
};

function roleFor(index: number, count: number): ConvoyFormationRole {
  if (index === 0) {
    return 'lead';
  }
  if (index === count - 1) {
    return 'tail';
  }
  return 'member';
}

function gapSeverity(state: ConvoyGapDecision['state']): number {
  switch (state) {
    case 'good':
      return 0;
    case 'caution':
      return 1;
    case 'unknown':
      return 2;
    case 'critical':
      return 3;
    case 'lost':
      return 4;
  }
}

export function normalizeConvoyFormationPlan(
  plan: ConvoyFormationPlan,
): ConvoyFormationPlan {
  const seen = new Set<string>();
  const members = plan.members.filter(member => {
    const id = member.id.trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });

  return {
    members,
    cautionGapMeters: plan.cautionGapMeters,
    criticalGapMeters: plan.criticalGapMeters,
  };
}

export function evaluateConvoyFormation(
  plan: ConvoyFormationPlan,
  localPosition: Coordinate | null,
  vehicles: ConvoyVehicle[],
  nowMs = Date.now(),
): ConvoyFormationSnapshot {
  const normalized = normalizeConvoyFormationPlan(plan);
  const vehicleById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const resolved = normalized.members.map((member, index) => {
    if (member.kind === 'self') {
      return {
        member,
        index,
        position: localPosition,
        freshness: localPosition ? ('self' as const) : ('unavailable' as const),
      };
    }

    const vehicle = vehicleById.get(member.id) ?? null;
    return {
      member,
      index,
      position: vehicle
        ? {latitude: vehicle.latitude, longitude: vehicle.longitude}
        : null,
      freshness: vehicle
        ? getConvoyFreshness(vehicle.receivedAtMs, nowMs)
        : ('unavailable' as const),
    };
  });

  const pairGaps = new Map<string, ConvoyGapDecision>();
  for (let index = 1; index < resolved.length; index += 1) {
    const ahead = resolved[index - 1];
    const behind = resolved[index];
    const key = `${ahead.member.id}->${behind.member.id}`;

    const eitherUnavailable =
      ahead.freshness === 'unavailable' || behind.freshness === 'unavailable';
    const eitherLost = ahead.freshness === 'lost' || behind.freshness === 'lost';
    const eitherStale = ahead.freshness === 'stale' || behind.freshness === 'stale';
    const eitherRecent = ahead.freshness === 'recent' || behind.freshness === 'recent';

    // Missing coordinates are different from stale coordinates. Passing a null
    // distance with otherwise-current freshness produces a quiet UNKNOWN gap,
    // while genuinely stale/lost radio fixes retain their driver-alert semantics.
    const freshness: ConvoyFreshness = eitherLost
      ? 'lost'
      : eitherStale
        ? 'stale'
        : eitherRecent
          ? 'recent'
          : 'live';
    const directGap =
      !eitherUnavailable &&
      !eitherLost &&
      !eitherStale &&
      ahead.position &&
      behind.position
        ? distanceMeters(ahead.position, behind.position)
        : null;

    pairGaps.set(
      key,
      getConvoyGapDecision({
        distanceMeters: directGap,
        freshness,
        cautionMeters: normalized.cautionGapMeters,
        criticalMeters: normalized.criticalGapMeters,
      }),
    );
  }

  const states: ConvoyFormationMemberState[] = resolved.map((item, index) => {
    const ahead = index > 0 ? resolved[index - 1] : null;
    const behind = index < resolved.length - 1 ? resolved[index + 1] : null;
    const gapToAhead = ahead
      ? pairGaps.get(`${ahead.member.id}->${item.member.id}`) ?? null
      : null;
    const gapToBehind = behind
      ? pairGaps.get(`${item.member.id}->${behind.member.id}`) ?? null
      : null;

    return {
      id: item.member.id,
      label: item.member.label,
      kind: item.member.kind,
      role: roleFor(index, resolved.length),
      orderIndex: index,
      freshness: item.freshness,
      position: item.position,
      aheadId: ahead?.member.id ?? null,
      behindId: behind?.member.id ?? null,
      gapToAhead,
      gapToBehind,
    };
  });

  const gaps = Array.from(pairGaps.values());
  const worst = gaps.reduce<ConvoyGapDecision | null>((current, gap) => {
    if (!current || gapSeverity(gap.state) > gapSeverity(current.state)) {
      return gap;
    }
    return current;
  }, null);

  return {
    members: states,
    worstGapState: worst?.state ?? 'none',
    alertCount: gaps.filter(gap => gap.shouldAlertDriver).length,
    unknownGapCount: gaps.filter(
      gap => gap.state === 'unknown' || gap.state === 'lost',
    ).length,
    complete: states.every(state => state.position !== null),
  };
}
