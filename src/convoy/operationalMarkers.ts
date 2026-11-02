import {BushMeshQuickActionCode} from '../bushmesh/protocol';

export type OperationalMarkerType = 'stop' | 'hazard' | 'regroup' | 'help';

export type OperationalMarkerInput = {
  id: string;
  senderId: string;
  action: BushMeshQuickActionCode;
  latitude: number | null;
  longitude: number | null;
  receivedAtMs: number;
  expiresAtMs: number | null;
};

export type OperationalMarker = {
  id: string;
  senderId: string;
  type: OperationalMarkerType;
  latitude: number;
  longitude: number;
  createdAtMs: number;
  expiresAtMs: number | null;
};

function markerTypeForAction(
  action: BushMeshQuickActionCode,
): OperationalMarkerType | null {
  switch (action) {
    case BushMeshQuickActionCode.Stop:
      return 'stop';
    case BushMeshQuickActionCode.Hazard:
      return 'hazard';
    case BushMeshQuickActionCode.Regroup:
      return 'regroup';
    case BushMeshQuickActionCode.Help:
      return 'help';
    default:
      return null;
  }
}

export function operationalMarkerFromQuickAction(
  input: OperationalMarkerInput,
): OperationalMarker | null {
  const type = markerTypeForAction(input.action);
  if (
    type === null ||
    input.latitude === null ||
    input.longitude === null
  ) {
    return null;
  }

  return {
    id: input.id,
    senderId: input.senderId,
    type,
    latitude: input.latitude,
    longitude: input.longitude,
    createdAtMs: input.receivedAtMs,
    expiresAtMs: input.expiresAtMs,
  };
}

export function isOperationalMarkerActive(
  marker: OperationalMarker,
  nowMs = Date.now(),
): boolean {
  return marker.expiresAtMs === null || marker.expiresAtMs > nowMs;
}

export function activeOperationalMarkers(
  markers: OperationalMarker[],
  nowMs = Date.now(),
): OperationalMarker[] {
  return markers.filter(marker => isOperationalMarkerActive(marker, nowMs));
}
