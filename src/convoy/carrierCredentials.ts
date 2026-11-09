import {BushMeshRadioProfile} from '../radio/RadioProfile';

export type ActiveConvoyCarrierProfile = {
  convoyId: string;
  convoyName: string;
  channelName: string;
  channelIndex: number;
  /** Recovered means read-only MeshCore carrier data, not convoy enrollment. */
  origin?: 'enrolled' | 'recovered';
};

export type CarrierCredentialDetails = {
  convoyName: string;
  channelName: string;
  channelIndex: number;
  privacy: 'private';
  secretStatus: 'configured';
  frequency: string;
  bandwidth: string;
  spreadingFactor: string;
  codingRate: string;
  txPower: string;
};

export const MESHCORE_CARRIER_PSK_DISTINCTION =
  'MeshCore carrier PSK — not BushMesh Security v1 group key';

export function normalizeCarrierPskHex(secretHex: string): string {
  const normalized = secretHex.trim().toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(normalized)) {
    throw new Error(
      'MeshCore carrier PSK must be exactly 16 bytes / 32 hexadecimal characters.',
    );
  }
  return normalized;
}

export function buildCarrierCredentialDetails(
  profile: ActiveConvoyCarrierProfile,
  radioProfile: BushMeshRadioProfile | null,
): CarrierCredentialDetails {
  const modem = radioProfile?.modem ?? null;
  return {
    convoyName: profile.convoyName,
    channelName: profile.channelName,
    channelIndex: profile.channelIndex,
    privacy: 'private',
    secretStatus: 'configured',
    frequency:
      radioProfile?.frequencyMhz == null
        ? 'Unknown'
        : `${radioProfile.frequencyMhz} MHz`,
    bandwidth:
      modem?.bandwidthKhz == null ? 'Unknown' : `${modem.bandwidthKhz} kHz`,
    spreadingFactor:
      modem?.spreadingFactor == null ? 'Unknown' : `SF${modem.spreadingFactor}`,
    codingRate:
      modem?.codingRate == null ? 'Unknown' : `4/${modem.codingRate}`,
    txPower:
      radioProfile?.txPower == null ? 'Unknown' : `${radioProfile.txPower} dBm`,
  };
}
