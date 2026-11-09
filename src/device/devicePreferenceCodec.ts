import {RadioProfileWithTx, validateProposedProfile} from './regionProfiles';

export type PreviousVerifiedProfile = {
  nodeIdentityRef: string;
  profile: RadioProfileWithTx;
  verifiedAt: string;
};

export type DevicePreferences = {
  version: 1;
  selectedPresetId: string | null;
  distanceUnit: 'metric' | 'imperial';
  previousVerified: PreviousVerifiedProfile | null;
};

export const DEFAULT_DEVICE_PREFERENCES: DevicePreferences = {
  version: 1,
  selectedPresetId: null,
  distanceUnit: 'metric',
  previousVerified: null,
};

function maybeVerified(value: unknown): PreviousVerifiedProfile | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.nodeIdentityRef !== 'string' ||
      !/^[0-9A-F]{12}$/.test(v.nodeIdentityRef) ||
      typeof v.verifiedAt !== 'string' ||
      !Number.isFinite(Date.parse(v.verifiedAt)) ||
      !v.profile || typeof v.profile !== 'object') return null;
  const p = v.profile as RadioProfileWithTx;
  try {
    // Structural/physical validation with no invented device capability limit.
    return {
      nodeIdentityRef: v.nodeIdentityRef,
      profile: validateProposedProfile(p, null),
      verifiedAt: v.verifiedAt,
    };
  } catch {
    return null;
  }
}

/** Whitelist-only serialization. Never accepts PSKs, key material or extra fields. */
export function encodeDevicePreferences(value: DevicePreferences): string {
  const safe = {
    version: 1,
    selectedPresetId: value.selectedPresetId !== null &&
      /^[a-z0-9-]{1,100}$/.test(value.selectedPresetId)
        ? value.selectedPresetId : null,
    distanceUnit: value.distanceUnit === 'imperial' ? 'imperial' : 'metric',
    previousVerified: maybeVerified(value.previousVerified),
  };
  return JSON.stringify(safe);
}

export function decodeDevicePreferences(serialized: string): DevicePreferences {
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid device settings snapshot.');
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error('Unsupported device settings snapshot version.');
  }
  return {
    version: 1,
    selectedPresetId: typeof record.selectedPresetId === 'string' &&
      /^[a-z0-9-]{1,100}$/.test(record.selectedPresetId)
      ? record.selectedPresetId : null,
    distanceUnit: record.distanceUnit === 'imperial' ? 'imperial' : 'metric',
    previousVerified: maybeVerified(record.previousVerified),
  };
}
