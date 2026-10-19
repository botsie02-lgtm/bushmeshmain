import {distanceMeters} from '../convoy/convoy';
import {BushMeshLocationFix} from './positionPlanner';

export type BushMeshTrackPoint = BushMeshLocationFix & {
  recordedAtMs: number;
};

export type BushMeshTrackSnapshot = {
  points: BushMeshTrackPoint[];
  totalDistanceMeters: number;
  startedAtMs: number | null;
  lastRecordedAtMs: number | null;
};

export type TrackRecorderOptions = {
  minDistanceMeters?: number;
  maxSampleIntervalMs?: number;
  maxPoints?: number;
};

const DEFAULT_MIN_DISTANCE_METERS = 5;
const DEFAULT_MAX_SAMPLE_INTERVAL_MS = 30_000;
const DEFAULT_MAX_POINTS = 2_000;

/**
 * Keeps a compact local breadcrumb trail from accepted GPS fixes. Dense GPS
 * jitter is suppressed, but a time-based sample is retained while stationary
 * so a long pause/restart remains visible in trip history.
 */
export class BushMeshTrackRecorder {
  private readonly minDistanceMeters: number;
  private readonly maxSampleIntervalMs: number;
  private readonly maxPoints: number;
  private points: BushMeshTrackPoint[] = [];
  private totalDistanceMeters = 0;
  private startedAtMs: number | null = null;
  private lastRecordedAtMs: number | null = null;
  private lastAcceptedFix: BushMeshLocationFix | null = null;
  private lastRecordedFix: BushMeshLocationFix | null = null;

  constructor(options?: TrackRecorderOptions) {
    this.minDistanceMeters = Math.max(
      0,
      options?.minDistanceMeters ?? DEFAULT_MIN_DISTANCE_METERS,
    );
    this.maxSampleIntervalMs = Math.max(
      1_000,
      options?.maxSampleIntervalMs ?? DEFAULT_MAX_SAMPLE_INTERVAL_MS,
    );
    this.maxPoints = Math.max(10, options?.maxPoints ?? DEFAULT_MAX_POINTS);
  }

  ingest(fix: BushMeshLocationFix): boolean {
    if (this.lastAcceptedFix && fix.timestampMs <= this.lastAcceptedFix.timestampMs) {
      return false;
    }

    this.lastAcceptedFix = {...fix};

    if (!this.lastRecordedFix) {
      this.append(fix);
      return true;
    }

    const travelled = distanceMeters(
      {
        latitude: this.lastRecordedFix.latitude,
        longitude: this.lastRecordedFix.longitude,
      },
      {latitude: fix.latitude, longitude: fix.longitude},
    );
    const elapsedMs =
      fix.timestampMs -
      (this.lastRecordedAtMs ?? this.lastRecordedFix.timestampMs);

    if (
      travelled < this.minDistanceMeters &&
      elapsedMs < this.maxSampleIntervalMs
    ) {
      return false;
    }

    this.totalDistanceMeters += travelled;
    this.append(fix);
    return true;
  }

  snapshot(): BushMeshTrackSnapshot {
    return {
      points: this.points.map(point => ({...point})),
      totalDistanceMeters: this.totalDistanceMeters,
      startedAtMs: this.startedAtMs,
      lastRecordedAtMs: this.lastRecordedAtMs,
    };
  }

  clear(): void {
    this.points = [];
    this.totalDistanceMeters = 0;
    this.startedAtMs = null;
    this.lastRecordedAtMs = null;
    this.lastAcceptedFix = null;
    this.lastRecordedFix = null;
  }

  private append(fix: BushMeshLocationFix): void {
    const point: BushMeshTrackPoint = {
      ...fix,
      recordedAtMs: fix.timestampMs,
    };

    if (this.startedAtMs === null) {
      this.startedAtMs = fix.timestampMs;
    }
    this.lastRecordedAtMs = fix.timestampMs;
    this.lastRecordedFix = {...fix};
    this.points.push(point);

    if (this.points.length > this.maxPoints) {
      this.points.splice(0, this.points.length - this.maxPoints);
    }
  }
}
