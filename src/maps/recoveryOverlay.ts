import {BuddyTail} from '../convoy/buddyTails';
import {ConvoyVehicle} from '../convoy/convoy';
import {buildRecoverySearchArea} from '../convoy/recoverySearchArea';
import {
  RecoveryTrailState,
  assessRecoveryTrail,
} from '../convoy/recoveryTrail';
import {
  RecoveryCheckpointFeatureCollection,
  recoveryCheckpointsToGeoJson,
} from './recoveryCheckpointGeoJson';
import {
  RecoverySearchAreaFeature,
  recoverySearchAreaToGeoJson,
} from './recoverySearchAreaGeoJson';
import {
  RecoveryTrailFeatureCollection,
  recoveryTrailToGeoJson,
} from './recoveryTrailGeoJson';

export type RecoveryOverlay = {
  vehicleId: string;
  active: boolean;
  trail: RecoveryTrailFeatureCollection;
  checkpoints: RecoveryCheckpointFeatureCollection;
  searchArea: RecoverySearchAreaFeature | null;
  trailState: RecoveryTrailState | null;
  searchRadiusMeters: number | null;
  summary: string;
};

export function buildRecoveryOverlay(
  vehicle: ConvoyVehicle | null | undefined,
  tail: BuddyTail | null | undefined,
  nowMs = Date.now(),
): RecoveryOverlay | null {
  if (!vehicle) {
    return null;
  }

  const trailAssessment = assessRecoveryTrail(tail, nowMs);
  const searchArea = buildRecoverySearchArea(vehicle, nowMs);
  const trailGeoJson = recoveryTrailToGeoJson(tail, nowMs);
  const checkpointGeoJson = recoveryCheckpointsToGeoJson(tail, nowMs);
  const searchAreaFeature = recoverySearchAreaToGeoJson(searchArea);
  const active = searchArea !== null;

  let summary = 'Vehicle position is current; recovery overlay is not required.';
  if (searchArea) {
    const radius =
      searchArea.radiusMeters >= 1_000
        ? `${(searchArea.radiusMeters / 1_000).toFixed(1)} km`
        : `${Math.round(searchArea.radiusMeters)} m`;
    const trailSummary = trailAssessment
      ? `${trailAssessment.state} trail`
      : 'no retained trail';
    const checkpointSummary =
      checkpointGeoJson.features.length > 1
        ? ` · ${checkpointGeoJson.features.length} continuity checkpoints`
        : '';
    summary = `${searchArea.state} last-known position · uncertainty radius ${radius} · ${trailSummary}${checkpointSummary}`;
  }

  return {
    vehicleId: vehicle.id,
    active,
    trail: trailGeoJson,
    checkpoints: checkpointGeoJson,
    searchArea: searchAreaFeature,
    trailState: trailAssessment?.state ?? null,
    searchRadiusMeters: searchArea?.radiusMeters ?? null,
    summary,
  };
}
