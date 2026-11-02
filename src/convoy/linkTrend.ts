import {BuddyTail, BuddyTailPoint} from './buddyTails';

export type ConvoyLinkTrendState =
  | 'unknown'
  | 'stable'
  | 'degrading'
  | 'fragile'
  | 'recovering';

export type ConvoyLinkTrend = {
  vehicleId: string;
  state: ConvoyLinkTrendState;
  sampleCount: number;
  latestSampleAgeSeconds: number | null;
  latestSnrDb: number | null;
  snrDeltaDb: number | null;
  latestPathLength: number | null;
  pathDelta: number | null;
  shouldWarn: boolean;
  detail: string;
};

const MAX_SAMPLE_AGE_MS = 10 * 60 * 1000;
const MAX_LATEST_SAMPLE_AGE_MS = 120 * 1000;
const MAX_SAMPLES = 8;

function finiteSnr(point: BuddyTailPoint): number | null {
  return typeof point.snrDb === 'number' && Number.isFinite(point.snrDb)
    ? point.snrDb
    : null;
}

function finitePath(point: BuddyTailPoint): number | null {
  return typeof point.pathLength === 'number' &&
    Number.isFinite(point.pathLength) &&
    point.pathLength >= 0
    ? point.pathLength
    : null;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getConvoyLinkTrend(
  tail: BuddyTail | null | undefined,
  nowMs = Date.now(),
): ConvoyLinkTrend | null {
  if (!tail) {
    return null;
  }

  const recent = tail.points
    .filter(point => point.receivedAtMs >= nowMs - MAX_SAMPLE_AGE_MS)
    .slice(-MAX_SAMPLES);

  if (recent.length === 0) {
    return {
      vehicleId: tail.vehicleId,
      state: 'unknown',
      sampleCount: 0,
      latestSampleAgeSeconds: null,
      latestSnrDb: null,
      snrDeltaDb: null,
      latestPathLength: null,
      pathDelta: null,
      shouldWarn: false,
      detail: 'No recent link observations are retained.',
    };
  }

  const latest = recent[recent.length - 1];
  const latestSampleAgeSeconds = Math.max(
    0,
    Math.floor((nowMs - latest.receivedAtMs) / 1000),
  );
  const latestSnrDb = finiteSnr(latest);
  const latestPathLength = finitePath(latest);

  if (nowMs - latest.receivedAtMs > MAX_LATEST_SAMPLE_AGE_MS) {
    return {
      vehicleId: tail.vehicleId,
      state: 'unknown',
      sampleCount: recent.length,
      latestSampleAgeSeconds,
      latestSnrDb,
      snrDeltaDb: null,
      latestPathLength,
      pathDelta: null,
      shouldWarn: false,
      detail:
        'The newest link observation is too old for a current radio trend; convoy freshness rules should be used instead.',
    };
  }

  const snrSamples = recent
    .map(point => finiteSnr(point))
    .filter((value): value is number => value !== null);
  const pathSamples = recent
    .map(point => finitePath(point))
    .filter((value): value is number => value !== null);

  if (snrSamples.length < 3) {
    return {
      vehicleId: tail.vehicleId,
      state: 'unknown',
      sampleCount: snrSamples.length,
      latestSampleAgeSeconds,
      latestSnrDb,
      snrDeltaDb: null,
      latestPathLength,
      pathDelta:
        pathSamples.length >= 2
          ? pathSamples[pathSamples.length - 1] - pathSamples[0]
          : null,
      shouldWarn: false,
      detail: 'More recent SNR observations are required before showing a link trend.',
    };
  }

  const splitIndex = Math.max(1, Math.floor(snrSamples.length / 2));
  const earlyAverage = average(snrSamples.slice(0, splitIndex));
  const lateAverage = average(snrSamples.slice(splitIndex));
  const snrDeltaDb = lateAverage - earlyAverage;
  const pathDelta =
    pathSamples.length >= 2
      ? pathSamples[pathSamples.length - 1] - pathSamples[0]
      : null;

  if (
    snrDeltaDb <= -8 &&
    ((latestSnrDb ?? Number.POSITIVE_INFINITY) <= 0 || (pathDelta ?? 0) >= 2)
  ) {
    return {
      vehicleId: tail.vehicleId,
      state: 'fragile',
      sampleCount: snrSamples.length,
      latestSampleAgeSeconds,
      latestSnrDb,
      snrDeltaDb,
      latestPathLength,
      pathDelta,
      shouldWarn: true,
      detail:
        'Recent link evidence has deteriorated sharply. Position is still current, but convoy separation should be treated conservatively.',
    };
  }

  if (snrDeltaDb <= -4 || (pathDelta ?? 0) >= 2) {
    return {
      vehicleId: tail.vehicleId,
      state: 'degrading',
      sampleCount: snrSamples.length,
      latestSampleAgeSeconds,
      latestSnrDb,
      snrDeltaDb,
      latestPathLength,
      pathDelta,
      shouldWarn: true,
      detail:
        'Recent link evidence is worsening. This is an observed trend, not a prediction of imminent loss.',
    };
  }

  if (snrDeltaDb >= 5 && (pathDelta ?? 0) <= 0) {
    return {
      vehicleId: tail.vehicleId,
      state: 'recovering',
      sampleCount: snrSamples.length,
      latestSampleAgeSeconds,
      latestSnrDb,
      snrDeltaDb,
      latestPathLength,
      pathDelta,
      shouldWarn: false,
      detail: 'Recent SNR has improved without an increase in mesh path length.',
    };
  }

  return {
    vehicleId: tail.vehicleId,
    state: 'stable',
    sampleCount: snrSamples.length,
    latestSampleAgeSeconds,
    latestSnrDb,
    snrDeltaDb,
    latestPathLength,
    pathDelta,
    shouldWarn: false,
    detail: 'Recent link evidence is not showing a material deterioration trend.',
  };
}
