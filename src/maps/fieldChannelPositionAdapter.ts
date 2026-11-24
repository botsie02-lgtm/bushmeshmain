import type {ConvoyVehicle} from '../convoy/convoy';
import {isValidMapCoordinate} from './convoyMapModel';

export type FieldChannelPosition = {
  id: string;
  label: string;
  coordinate: {latitude: number; longitude: number};
  receivedAtMs: number;
  accuracyMeters: number | null;
  simulated: boolean;
  /** Diagnostic carrier data; NEVER evidence of active convoy membership. */
  trust: 'unverified-channel';
};
const MAX_FIELD_POSITIONS = 24;
const MAX_FIELD_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Adapter for field-test radio-heard data. Caller explicitly opts into
 * rendering; do not pass this list as authorisedMembers, route waypoints,
 * or GPS. No packet/transport handling belongs in this map module.
 */
export function projectFieldChannelPositions(
  vehicles: readonly Pick<ConvoyVehicle,
    'id' | 'name' | 'latitude' | 'longitude' | 'receivedAtMs' | 'accuracyMeters' | 'simulated'>[],
  nowMs: number,
): FieldChannelPosition[] {
  if (!Number.isFinite(nowMs) || nowMs < 0) return [];
  const seen = new Set<string>();
  return [...vehicles]
    .sort((a, b) => b.receivedAtMs - a.receivedAtMs)
    .filter(vehicle => {
      if (!vehicle.id || seen.has(vehicle.id) ||
          !isValidMapCoordinate(vehicle) ||
          !Number.isFinite(vehicle.receivedAtMs) ||
          vehicle.receivedAtMs > nowMs + 30_000 ||
          nowMs - vehicle.receivedAtMs > MAX_FIELD_AGE_MS) return false;
      seen.add(vehicle.id);
      return true;
    })
    .slice(0, MAX_FIELD_POSITIONS)
    .map(vehicle => ({
      id: vehicle.id,
      label: (vehicle.name || vehicle.id).slice(0, 64),
      coordinate: {latitude: vehicle.latitude, longitude: vehicle.longitude},
      receivedAtMs: vehicle.receivedAtMs,
      accuracyMeters:
        vehicle.accuracyMeters !== null &&
        Number.isFinite(vehicle.accuracyMeters) &&
        vehicle.accuracyMeters >= 0
          ? vehicle.accuracyMeters : null,
      simulated: vehicle.simulated === true,
      trust: 'unverified-channel' as const,
    }));
}
