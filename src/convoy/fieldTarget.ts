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

export function getFieldTargetGuidance(
  localPosition: Coordinate | null,
  target: FieldNavigationTarget | null | undefined,
  nowMs = Date.now(),
): FieldTargetGuidance | null {
  if (!localPosition || !target) {
    return null;
  }

  const bearing = bearingDegrees(localPosition, target);
  const expired = target.expiresAtMs !== null && target.expiresAtMs <= nowMs;

  return {
    targetId: target.id,
    label: target.label,
    type: target.type,
    latitude: target.latitude,
    longitude: target.longitude,
    distanceMeters: distanceMeters(localPosition, target),
    bearingDegrees: bearing,
    compassDirection: compassDirection(bearing),
    expiresAtMs: target.expiresAtMs,
    expired,
  };
}
