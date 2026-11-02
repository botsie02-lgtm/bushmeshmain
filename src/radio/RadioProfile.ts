import {LoRaModemParams} from './loraAirtime';

export type BushMeshRadioProfile = {
  source: 'meshcore' | 'bushmesh-firmware' | 'unknown';
  frequencyMhz: number | null;
  txPower: number | null;
  maxTxPower: number | null;
  modem: LoRaModemParams | null;
};

export function cloneBushMeshRadioProfile(
  profile: BushMeshRadioProfile | null,
): BushMeshRadioProfile | null {
  if (!profile) {
    return null;
  }

  return {
    ...profile,
    modem: profile.modem ? {...profile.modem} : null,
  };
}
