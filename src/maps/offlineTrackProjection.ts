import {MapCoordinate} from './offlineMapPacks';

/** Read-only visual projection, NEVER an alternative GPS recorder. */
export type OfflineTrackSample = MapCoordinate & {recordedAtMs: number};
export type OfflineTrackProjection = {
  vertices: MapCoordinate[];
  originalCount: number;
  displayCount: number;
  startedAtMs: number | null;
  endedAtMs: number | null;
};

export const MAX_VISIBLE_TRACK_POINTS = 128;

/**
 * All recorded samples remain in the existing encrypted TrackRecorder and
 * GPX export. This view only reduces the number of React Native line
 * segments. Exact travelled distance comes from TrackRecorder, not this
 * simplified visual trace.
 */
export function projectOfflineTrack(
  samples: readonly OfflineTrackSample[],
  maxVisible = MAX_VISIBLE_TRACK_POINTS,
): OfflineTrackProjection {
  if (!Number.isInteger(maxVisible) || maxVisible < 2 || maxVisible > 512) {
    throw new Error('Map trail vertex budget must be between 2 and 512.');
  }
  const accepted: OfflineTrackSample[] = [];
  let lastTime = -1;
  for (const sample of samples) {
    if (
      !Number.isFinite(sample.latitude) || sample.latitude < -90 || sample.latitude > 90 ||
      !Number.isFinite(sample.longitude) || sample.longitude < -180 || sample.longitude > 180 ||
      !Number.isFinite(sample.recordedAtMs) || sample.recordedAtMs < 0 ||
      sample.recordedAtMs <= lastTime
    ) continue;
    accepted.push(sample);
    lastTime = sample.recordedAtMs;
  }
  const count = accepted.length;
  const reduced = count <= maxVisible
    ? accepted
    : Array.from({length: maxVisible}, (_, index) =>
        accepted[Math.round(index * (count - 1) / (maxVisible - 1))]);
  return {
    vertices: reduced.map(({latitude, longitude}) => ({latitude, longitude})),
    originalCount: count,
    displayCount: reduced.length,
    startedAtMs: count ? accepted[0].recordedAtMs : null,
    endedAtMs: count ? accepted[count - 1].recordedAtMs : null,
  };
}

/** Render-only simplification of externally supplied, already available geometry.
 * Does not create an offline routing graph or make route progress claims.
 */
export function projectOfflinePolyline(
  points: readonly MapCoordinate[],
  maxVisible = MAX_VISIBLE_TRACK_POINTS,
): MapCoordinate[] {
  if (!Number.isInteger(maxVisible) || maxVisible < 2 || maxVisible > 512) {
    throw new Error('Map polyline budget must be between 2 and 512.');
  }
  const valid = points.filter(point => Number.isFinite(point.latitude) &&
    point.latitude >= -90 && point.latitude <= 90 &&
    Number.isFinite(point.longitude) && point.longitude >= -180 &&
    point.longitude <= 180);
  if (valid.length <= maxVisible) return valid.map(point => ({...point}));
  return Array.from({length: maxVisible}, (_, index) => ({
    ...valid[Math.round(index * (valid.length - 1) / (maxVisible - 1))],
  }));
}
