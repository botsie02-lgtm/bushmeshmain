/** Non-sensitive GPS acquisition and display choices only. Never store a location fix. */
export type GpsAcquisitionMode = 'responsive' | 'balanced' | 'battery-saver';

export type GpsPreferencesV1 = {
  version: 1;
  acquisitionMode: GpsAcquisitionMode;
  staleAfterSeconds: 45 | 90 | 180;
  accuracyWarningMeters: 25 | 100 | 500;
  showCoordinates: boolean;
};

export const DEFAULT_GPS_PREFERENCES: GpsPreferencesV1 = {
  version: 1,
  acquisitionMode: 'responsive',
  staleAfterSeconds: 90,
  accuracyWarningMeters: 100,
  showCoordinates: false,
};

export type GpsAcquisitionHint = {
  minTimeMs: number;
  minDistanceMeters: number;
  description: string;
};

/** Android LocationManager requestLocationUpdates hints, not guaranteed fix rates. */
export function gpsAcquisitionHint(mode: GpsAcquisitionMode): GpsAcquisitionHint {
  switch (mode) {
    case 'responsive':
      return {
        minTimeMs: 1_000,
        minDistanceMeters: 0,
        description: '1 second / 0 metres, higher battery use',
      };
    case 'battery-saver':
      return {
        minTimeMs: 15_000,
        minDistanceMeters: 25,
        description: '15 seconds / 25 metres, may miss shorter movements',
      };
    case 'balanced':
      return {
        minTimeMs: 5_000,
        minDistanceMeters: 5,
        description: '5 seconds / 5 metres, balanced battery use',
      };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateGpsPreferences(value: unknown): GpsPreferencesV1 {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('Unsupported GPS preferences format or version.');
  }
  if (
    value.acquisitionMode !== 'responsive' &&
    value.acquisitionMode !== 'balanced' &&
    value.acquisitionMode !== 'battery-saver'
  ) {
    throw new Error('GPS acquisition mode is invalid.');
  }
  if (
    value.staleAfterSeconds !== 45 &&
    value.staleAfterSeconds !== 90 &&
    value.staleAfterSeconds !== 180
  ) {
    throw new Error('GPS stale-after threshold is invalid.');
  }
  if (
    value.accuracyWarningMeters !== 25 &&
    value.accuracyWarningMeters !== 100 &&
    value.accuracyWarningMeters !== 500
  ) {
    throw new Error('GPS accuracy-warning threshold is invalid.');
  }
  if (typeof value.showCoordinates !== 'boolean') {
    throw new Error('GPS coordinate visibility preference is invalid.');
  }
  return {
    version: 1,
    acquisitionMode: value.acquisitionMode,
    staleAfterSeconds: value.staleAfterSeconds,
    accuracyWarningMeters: value.accuracyWarningMeters,
    showCoordinates: value.showCoordinates,
  };
}

/** Whitelists all four fields: no positions, identifiers, PSKs or key material. */
export function encodeGpsPreferences(value: GpsPreferencesV1): string {
  return JSON.stringify(validateGpsPreferences(value));
}

export function decodeGpsPreferences(raw: string): GpsPreferencesV1 {
  if (raw.length > 4096) throw new Error('GPS preferences are unexpectedly large.');
  return validateGpsPreferences(JSON.parse(raw));
}
