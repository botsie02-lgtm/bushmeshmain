import {MeshCoreDeviceInfo} from './meshcoreDeviceInfo';
import {MeshCoreSelfInfo} from './meshcoreSelfInfo';

export const MESHCORE_RADIO_MIN_FREQUENCY_MHZ = 150;
export const MESHCORE_RADIO_MAX_FREQUENCY_MHZ = 2500;
export const MESHCORE_RADIO_MIN_BANDWIDTH_KHZ = 7;
export const MESHCORE_RADIO_MAX_BANDWIDTH_KHZ = 500;
export const MESHCORE_RADIO_MIN_SF = 5;
export const MESHCORE_RADIO_MAX_SF = 12;
export const MESHCORE_RADIO_MIN_CR = 5;
export const MESHCORE_RADIO_MAX_CR = 8;
export const MESHCORE_RADIO_MIN_TX_POWER_DBM = -9;

export type MeshCoreRadioParams = {
  frequencyMhz: number;
  bandwidthKhz: number;
  spreadingFactor: number;
  codingRate: number;
};

export type MeshCoreRadioParamsWire = MeshCoreRadioParams & {
  frequencyMilliMhz: number;
  bandwidthMilliKhz: number;
};

export type MeshCoreRepeatMode = 0 | 1;

export type MeshCoreRecommendedRegionProfile = {
  id: string;
  label: string;
  region: string;
  version: string;
  frequencyMhz: number;
  bandwidthKhz: number;
  spreadingFactor: number;
  codingRate: number;
  txPowerDbm: number | null;
  notes: string;
};

/**
 * Presets intentionally remain empty during hardware validation. Region support
 * is modeled as complete, versioned profiles rather than country-to-frequency
 * lookups so future policy can include BW/SF/CR/TX behavior together.
 */
export const MESHCORE_RECOMMENDED_REGION_PROFILES: readonly MeshCoreRecommendedRegionProfile[] = [];

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  if (value < 0) {
    throw new Error(`${label} cannot be negative.`);
  }
  return value;
}

function exactScaledUint32(
  value: number,
  scale: number,
  label: string,
): number {
  const scaled = value * scale;
  const nearest = Math.round(scaled);
  if (Math.abs(scaled - nearest) > 1e-7) {
    throw new Error(`${label} supports at most three decimal places.`);
  }
  if (nearest < 0 || nearest > 0xffffffff) {
    throw new Error(`${label} exceeds the MeshCore uint32 wire range.`);
  }
  return nearest;
}

export function validateMeshCoreRadioParams(
  input: MeshCoreRadioParams,
): MeshCoreRadioParamsWire {
  const frequencyMhz = finiteNumber(input.frequencyMhz, 'Radio frequency');
  if (
    frequencyMhz < MESHCORE_RADIO_MIN_FREQUENCY_MHZ ||
    frequencyMhz > MESHCORE_RADIO_MAX_FREQUENCY_MHZ
  ) {
    throw new Error(
      `Radio frequency must be between ${MESHCORE_RADIO_MIN_FREQUENCY_MHZ} and ${MESHCORE_RADIO_MAX_FREQUENCY_MHZ} MHz.`,
    );
  }

  const bandwidthKhz = finiteNumber(input.bandwidthKhz, 'Radio bandwidth');
  if (
    bandwidthKhz < MESHCORE_RADIO_MIN_BANDWIDTH_KHZ ||
    bandwidthKhz > MESHCORE_RADIO_MAX_BANDWIDTH_KHZ
  ) {
    throw new Error(
      `Radio bandwidth must be between ${MESHCORE_RADIO_MIN_BANDWIDTH_KHZ} and ${MESHCORE_RADIO_MAX_BANDWIDTH_KHZ} kHz.`,
    );
  }

  if (
    !Number.isInteger(input.spreadingFactor) ||
    input.spreadingFactor < MESHCORE_RADIO_MIN_SF ||
    input.spreadingFactor > MESHCORE_RADIO_MAX_SF
  ) {
    throw new Error(
      `Spreading factor must be a whole number from ${MESHCORE_RADIO_MIN_SF} through ${MESHCORE_RADIO_MAX_SF}.`,
    );
  }

  if (
    !Number.isInteger(input.codingRate) ||
    input.codingRate < MESHCORE_RADIO_MIN_CR ||
    input.codingRate > MESHCORE_RADIO_MAX_CR
  ) {
    throw new Error(
      `Coding rate must be a whole number from ${MESHCORE_RADIO_MIN_CR} through ${MESHCORE_RADIO_MAX_CR}.`,
    );
  }

  return {
    ...input,
    frequencyMhz,
    bandwidthKhz,
    frequencyMilliMhz: exactScaledUint32(
      frequencyMhz,
      1000,
      'Radio frequency',
    ),
    bandwidthMilliKhz: exactScaledUint32(
      bandwidthKhz,
      1000,
      'Radio bandwidth',
    ),
  };
}

export function repeatModeForRadioWrite(
  deviceInfo: MeshCoreDeviceInfo,
): MeshCoreRepeatMode | null {
  if (deviceInfo.firmwareVersion < 9) {
    return null;
  }
  if (deviceInfo.clientRepeat !== 0 && deviceInfo.clientRepeat !== 1) {
    throw new Error(
      'MeshCore protocol v9+ requires the current client-repeat mode when changing radio parameters, but this node did not report it. Refresh Device Info before applying the profile.',
    );
  }
  return deviceInfo.clientRepeat;
}

export function validateMeshCoreTxPower(
  txPowerDbm: number,
  advertisedMaxTxPower: number | null | undefined,
): number {
  if (!Number.isFinite(txPowerDbm) || !Number.isInteger(txPowerDbm)) {
    throw new Error('TX power must be a whole number of dBm.');
  }
  if (txPowerDbm < MESHCORE_RADIO_MIN_TX_POWER_DBM || txPowerDbm > 127) {
    throw new Error(
      `TX power must be between ${MESHCORE_RADIO_MIN_TX_POWER_DBM} and 127 dBm on the MeshCore wire.`,
    );
  }
  if (
    advertisedMaxTxPower !== null &&
    advertisedMaxTxPower !== undefined &&
    Number.isFinite(advertisedMaxTxPower) &&
    txPowerDbm > advertisedMaxTxPower
  ) {
    throw new Error(
      `TX power ${txPowerDbm} dBm exceeds this node's advertised maximum of ${advertisedMaxTxPower} dBm.`,
    );
  }
  return txPowerDbm;
}

function scaledSelfInfoValue(
  value: number | null,
  label: string,
): number {
  if (value === null || !Number.isFinite(value)) {
    throw new Error(`MeshCore SELF_INFO did not report ${label} for verification.`);
  }
  return Math.round(value * 1000);
}

export function verifyMeshCoreRadioParams(
  requested: MeshCoreRadioParamsWire,
  selfInfo: MeshCoreSelfInfo,
): void {
  const returnedFrequency = scaledSelfInfoValue(
    selfInfo.frequencyMhz,
    'radio frequency',
  );
  const returnedBandwidth = scaledSelfInfoValue(
    selfInfo.bandwidthKhz,
    'radio bandwidth',
  );

  if (
    returnedFrequency !== requested.frequencyMilliMhz ||
    returnedBandwidth !== requested.bandwidthMilliKhz ||
    selfInfo.spreadingFactor !== requested.spreadingFactor ||
    selfInfo.codingRate !== requested.codingRate
  ) {
    throw new Error(
      `MeshCore radio read-back mismatch. Requested ${formatMeshCoreRadioParams(
        requested,
      )}; returned ${formatMeshCoreSelfInfoRadio(selfInfo)}.`,
    );
  }
}

export function verifyMeshCoreTxPower(
  requestedTxPowerDbm: number,
  selfInfo: MeshCoreSelfInfo,
): void {
  if (selfInfo.txPower !== requestedTxPowerDbm) {
    throw new Error(
      `MeshCore TX-power read-back mismatch. Requested ${requestedTxPowerDbm} dBm; returned ${selfInfo.txPower} dBm.`,
    );
  }
}

export function formatMeshCoreRadioParams(input: MeshCoreRadioParams): string {
  return `${input.frequencyMhz.toFixed(3)} MHz · BW ${formatBandwidth(
    input.bandwidthKhz,
  )} kHz · SF${input.spreadingFactor} · CR${input.codingRate}`;
}

export function formatMeshCoreSelfInfoRadio(selfInfo: MeshCoreSelfInfo): string {
  if (
    selfInfo.frequencyMhz === null ||
    selfInfo.bandwidthKhz === null ||
    selfInfo.spreadingFactor === null ||
    selfInfo.codingRate === null
  ) {
    return 'incomplete SELF_INFO radio profile';
  }
  return formatMeshCoreRadioParams({
    frequencyMhz: selfInfo.frequencyMhz,
    bandwidthKhz: selfInfo.bandwidthKhz,
    spreadingFactor: selfInfo.spreadingFactor,
    codingRate: selfInfo.codingRate,
  });
}

export function formatBandwidth(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toString();
}
