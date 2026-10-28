import {BuddyTail} from '../convoy/buddyTails';
import {
  ConvoyFreshness,
  ConvoyVehicle,
  Coordinate,
  getConvoyFreshness,
} from '../convoy/convoy';
import {FieldNavigationTarget} from '../convoy/fieldTarget';
import {
  OperationalMarker,
  OperationalMarkerType,
  activeOperationalMarkers,
} from '../convoy/operationalMarkers';
import {BushMeshTrackPoint} from '../location/TrackRecorder';

export type OperationalPointKind = 'self' | 'vehicle' | 'marker' | 'target';
export type OperationalPointStatus =
  | 'self'
  | ConvoyFreshness
  | 'active'
  | 'expired';

export type OperationalPicturePoint = Coordinate & {
  id: string;
  kind: OperationalPointKind;
  label: string;
  status: OperationalPointStatus;
  targeted: boolean;
  sourceId: string | null;
  markerType: OperationalMarkerType | null;
  simulated: boolean;
};

export type OperationalPolylineKind = 'breadcrumb' | 'buddy-tail';

export type OperationalPicturePolyline = {
  id: string;
  kind: OperationalPolylineKind;
  vehicleId: string | null;
  targeted: boolean;
  points: Coordinate[];
};

export type OperationalPictureBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
  crossesAntimeridian: boolean;
  center: Coordinate;
};

export type OperationalPictureSummary = {
  liveVehicleCount: number;
  recentVehicleCount: number;
  staleVehicleCount: number;
  lostVehicleCount: number;
  activeMarkerCount: number;
  breadcrumbPointCount: number;
  buddyTailCount: number;
};

export type OperationalPicture = {
  points: OperationalPicturePoint[];
  polylines: OperationalPicturePolyline[];
  focusBounds: OperationalPictureBounds | null;
  summary: OperationalPictureSummary;
};

export type BuildOperationalPictureInput = {
  localPosition: Coordinate | null;
  vehicles: ConvoyVehicle[];
  buddyTails: BuddyTail[];
  operationalMarkers: OperationalMarker[];
  trackPoints: BushMeshTrackPoint[];
  navigationTargetVehicleId: string | null;
  navigationFieldTarget: FieldNavigationTarget | null;
  nowMs?: number;
};

function markerLabel(type: OperationalMarkerType): string {
  switch (type) {
    case 'stop':
      return 'Stop';
    case 'hazard':
      return 'Hazard';
    case 'regroup':
      return 'Regroup';
    case 'help':
      return 'Help';
  }
}

function normalizeLongitude360(longitude: number): number {
  return ((longitude % 360) + 360) % 360;
}

function normalizeLongitude180(longitude: number): number {
  const normalized = normalizeLongitude360(longitude);
  return normalized > 180 ? normalized - 360 : normalized;
}

/**
 * Finds the smallest longitude arc that contains all points. This avoids a
 * convoy near ±180° being framed as if it spans almost the entire planet.
 */
function longitudeEnvelope(longitudes: number[]): {
  west: number;
  east: number;
  center: number;
  crossesAntimeridian: boolean;
} {
  if (longitudes.length === 1) {
    const value = normalizeLongitude180(longitudes[0]);
    return {
      west: value,
      east: value,
      center: value,
      crossesAntimeridian: false,
    };
  }

  const sorted = longitudes
    .map(normalizeLongitude360)
    .sort((left, right) => left - right);

  let largestGap = -1;
  let largestGapIndex = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next =
      index === sorted.length - 1 ? sorted[0] + 360 : sorted[index + 1];
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = index;
    }
  }

  const start = sorted[(largestGapIndex + 1) % sorted.length];
  const end = sorted[largestGapIndex];
  const span = (end - start + 360) % 360;
  const west = normalizeLongitude180(start);
  const east = normalizeLongitude180(end);
  const center = normalizeLongitude180(start + span / 2);

  return {
    west,
    east,
    center,
    crossesAntimeridian: span > 0 && west > east,
  };
}

export function operationalBoundsForCoordinates(
  coordinates: Coordinate[],
): OperationalPictureBounds | null {
  if (coordinates.length === 0) {
    return null;
  }

  const latitudes = coordinates.map(point => point.latitude);
  const envelope = longitudeEnvelope(coordinates.map(point => point.longitude));
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);

  return {
    south,
    west: envelope.west,
    north,
    east: envelope.east,
    crossesAntimeridian: envelope.crossesAntimeridian,
    center: {
      latitude: (south + north) / 2,
      longitude: envelope.center,
    },
  };
}

function markerPoint(
  marker: OperationalMarker,
  targeted: boolean,
): OperationalPicturePoint {
  return {
    id: `marker:${marker.id}`,
    kind: 'marker',
    label: markerLabel(marker.type),
    latitude: marker.latitude,
    longitude: marker.longitude,
    status: 'active',
    targeted,
    sourceId: marker.senderId,
    markerType: marker.type,
    simulated: false,
  };
}

export function buildOperationalPicture(
  input: BuildOperationalPictureInput,
): OperationalPicture {
  const nowMs = input.nowMs ?? Date.now();
  const activeMarkers = activeOperationalMarkers(input.operationalMarkers, nowMs);
  const points: OperationalPicturePoint[] = [];
  const polylines: OperationalPicturePolyline[] = [];

  if (input.localPosition) {
    points.push({
      id: 'self',
      kind: 'self',
      label: 'You',
      latitude: input.localPosition.latitude,
      longitude: input.localPosition.longitude,
      status: 'self',
      targeted: false,
      sourceId: null,
      markerType: null,
      simulated: false,
    });
  }

  let liveVehicleCount = 0;
  let recentVehicleCount = 0;
  let staleVehicleCount = 0;
  let lostVehicleCount = 0;

  input.vehicles.forEach(vehicle => {
    const freshness = getConvoyFreshness(vehicle.receivedAtMs, nowMs);
    switch (freshness) {
      case 'live':
        liveVehicleCount += 1;
        break;
      case 'recent':
        recentVehicleCount += 1;
        break;
      case 'stale':
        staleVehicleCount += 1;
        break;
      case 'lost':
        lostVehicleCount += 1;
        break;
    }

    points.push({
      id: `vehicle:${vehicle.id}`,
      kind: 'vehicle',
      label: vehicle.name,
      latitude: vehicle.latitude,
      longitude: vehicle.longitude,
      status: freshness,
      targeted: input.navigationTargetVehicleId === vehicle.id,
      sourceId: vehicle.id,
      markerType: null,
      simulated: vehicle.simulated === true,
    });
  });

  activeMarkers.forEach(marker => {
    points.push(
      markerPoint(marker, input.navigationFieldTarget?.id === marker.id),
    );
  });

  if (input.navigationFieldTarget) {
    const target = input.navigationFieldTarget;
    const isRecoveryCheckpoint = target.type === 'recovery-checkpoint';
    const markerStillActive =
      !isRecoveryCheckpoint && activeMarkers.some(marker => marker.id === target.id);
    if (!markerStillActive) {
      points.push({
        id: `target:${target.id}`,
        kind: 'target',
        label: target.label,
        latitude: target.latitude,
        longitude: target.longitude,
        status:
          target.expiresAtMs !== null && target.expiresAtMs <= nowMs
            ? 'expired'
            : 'active',
        targeted: true,
        sourceId: target.senderId,
        // Recovery checkpoints are historical reference anchors, not field
        // command markers such as REGROUP/HELP/HAZARD/STOP.
        markerType: isRecoveryCheckpoint ? null : target.type,
        simulated: false,
      });
    }
  }

  if (input.trackPoints.length >= 2) {
    polylines.push({
      id: 'breadcrumb:self',
      kind: 'breadcrumb',
      vehicleId: null,
      targeted: false,
      points: input.trackPoints.map(point => ({
        latitude: point.latitude,
        longitude: point.longitude,
      })),
    });
  }

  input.buddyTails.forEach(tail => {
    if (tail.points.length < 2) {
      return;
    }

    polylines.push({
      id: `buddy-tail:${tail.vehicleId}`,
      kind: 'buddy-tail',
      vehicleId: tail.vehicleId,
      targeted: input.navigationTargetVehicleId === tail.vehicleId,
      points: tail.points.map(point => ({
        latitude: point.latitude,
        longitude: point.longitude,
      })),
    });
  });

  return {
    points,
    polylines,
    focusBounds: operationalBoundsForCoordinates(points),
    summary: {
      liveVehicleCount,
      recentVehicleCount,
      staleVehicleCount,
      lostVehicleCount,
      activeMarkerCount: activeMarkers.length,
      breadcrumbPointCount: input.trackPoints.length,
      buddyTailCount: polylines.filter(line => line.kind === 'buddy-tail').length,
    },
  };
}
