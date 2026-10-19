import {MeshCoreSelfInfo} from '../meshcore/meshcoreSelfInfo';
import {LoRaModemParams} from './loraAirtime';

export type MeshCoreRadioProfile = {
  frequencyMhz: number | null;
  txPower: number;
  maxTxPower: number;
  modem: LoRaModemParams | null;
};

function supportedCodingRate(value: number | null): value is 5 | 6 | 7 | 8 {
  return value === 5 || value === 6 || value === 7 || value === 8;
}

/**
 * Converts the radio parameters advertised in MeshCore SELF_INFO into the
 * transport-neutral shape used by Bushmesh airtime accounting. Incomplete or
 * unsupported modem settings deliberately produce modem=null rather than a
 * guessed estimate.
 */
export function meshCoreSelfInfoToRadioProfile(
  selfInfo: MeshCoreSelfInfo,
): MeshCoreRadioProfile {
  const hasSupportedSpreadingFactor =
    selfInfo.spreadingFactor !== null &&
    Number.isInteger(selfInfo.spreadingFactor) &&
    selfInfo.spreadingFactor >= 5 &&
    selfInfo.spreadingFactor <= 12;
  const hasSupportedBandwidth =
    selfInfo.bandwidthKhz !== null &&
    Number.isFinite(selfInfo.bandwidthKhz) &&
    selfInfo.bandwidthKhz > 0;

  const modem =
    hasSupportedSpreadingFactor &&
    hasSupportedBandwidth &&
    supportedCodingRate(selfInfo.codingRate)
      ? {
          spreadingFactor: selfInfo.spreadingFactor as number,
          bandwidthKhz: selfInfo.bandwidthKhz as number,
          codingRate: selfInfo.codingRate,
        }
      : null;

  return {
    frequencyMhz: selfInfo.frequencyMhz,
    txPower: selfInfo.txPower,
    maxTxPower: selfInfo.maxTxPower,
    modem,
  };
}
