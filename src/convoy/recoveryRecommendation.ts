import {ConvoyRecoveryCase} from './recoveryPriority';

export type RecoveryRecommendationKind =
  | 'monitor'
  | 'trail-context'
  | 'last-known-only'
  | 'regroup-first';

export type RecoveryRecommendation = {
  kind: RecoveryRecommendationKind;
  label: string;
  detail: string;
};

export function getRecoveryRecommendation(
  recoveryCase: ConvoyRecoveryCase,
): RecoveryRecommendation {
  const {freshness, trail, searchArea} = recoveryCase;
  const uncertaintyRadius = searchArea?.radiusMeters ?? 0;

  if (
    freshness === 'lost' &&
    (uncertaintyRadius >= 3_000 || (!trail && recoveryCase.ageSeconds >= 900))
  ) {
    return {
      kind: 'regroup-first',
      label: 'REGROUP BEFORE PUSHING ON',
      detail:
        'The last-known position is too uncertain for precise recovery guidance. Hold the convoy together and treat the search area as broad context only.',
    };
  }

  if (trail?.state === 'broken') {
    return {
      kind: 'last-known-only',
      label: 'USE LAST KNOWN ONLY',
      detail:
        'The buddy trail contains a discontinuity. Do not follow the broken segment as a continuous route; use the last fix and uncertainty area as reference only.',
    };
  }

  if (
    freshness === 'lost' &&
    trail &&
    trail.pointCount >= 2 &&
    (trail.state === 'usable' || trail.state === 'aging')
  ) {
    return {
      kind: 'trail-context',
      label: 'USE BUDDY TRAIL AS CONTEXT',
      detail:
        'Retained fixes are contiguous enough to help orient recovery, but they are not a road route and do not prove where the vehicle is now.',
    };
  }

  if (freshness === 'lost') {
    return {
      kind: 'last-known-only',
      label: 'FOCUS LAST KNOWN',
      detail:
        'No trustworthy continuous trail is available. Navigate only to the last-known area and keep the uncertainty radius visible.',
    };
  }

  return {
    kind: 'monitor',
    label: 'MONITOR FOR A FRESH FIX',
    detail:
      'The position is stale but has not yet crossed the lost threshold. Keep the gap conservative and wait for a trustworthy update before treating the coordinate as current.',
  };
}
