import {
  Coordinate,
  bearingDegrees,
  compassDirection,
  distanceMeters,
} from './convoy';
import {OperationalMarkerType} from './operationalMarkers';

export type FieldNavigationTarget = {
  id: string;
  label: string;
  type: OperationalMarkerType;
  latitude: number;
  longitude: number;
  senderId: string;
  createdAtMs: number;
  expiresAtMs: number | null;
};

export type FieldTargetGuidance = {
  targetId: string;
  label: string;
  type: OperationalMarkerType;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  bearingDegrees: number;
  compassDirection: string;
  expiresAtMs: number | null;
  expired: boolean;
  arrivalRadiusMeters: number;
  arrived: boolean;
};

export function fieldTargetLabel(type: OperationalMarkerType): string {
  switch (type) {
    case 'regroup':
      return 'Regroup point';
    case 'help':
      return 'Help location';
    case 'hazard':
      return 'Hazard location';
    case 'stop':
      return 'Stop point';
  }
}

export function fieldTargetArrivalRadiusMeters(
  type: OperationalMarkerType,
): number {
  switch (type) {
    case 'help':
      return 75;
    case 'regroup':
      return 50;
    case 'hazard':
      return 150;
    case 'stop':
      return 50;
  }
}

export function getFieldTargetGuidance(
  localPosition: Coordinate | null,
  target: FieldNavigationTarget | null | undefined,
  nowMs = Date.now(),
): FieldTargetGuidance | null {
  if (!localPosition || !target) {
    return null;
  }

  const bearing = bearingDegrees(localPosition, target);
  const distance = distanceMeters(localPosition, target);
  const expired = target.expiresAtMs !== null && target.expiresAtMs <= nowMs;
  const arrivalRadiusMeters = fieldTargetArrivalRadiusMeters(target.type);

  return {
    targetId: target.id,
    label: target.label,
    type: target.type,
    latitude: target.latitude,
    longitude: target.longitude,
    distanceMeters: distance,
    bearingDegrees: bearing,
    compassDirection: compassDirection(bearing),
    expiresAtMs: target.expiresAtMs,
    expired,
    arrivalRadiusMeters,
    arrived: !expired && distance <= arrivalRadiusMeters,
  };
}
