import {MeshCoreClient} from '../meshcore/MeshCoreClient';
import {MeshCoreDeviceInfo} from '../meshcore/meshcoreDeviceInfo';
import {
  MeshCoreRadioParams,
  formatMeshCoreRadioParams,
} from '../meshcore/meshcoreRadioSettings';
import {MeshCoreSelfInfo} from '../meshcore/meshcoreSelfInfo';
import {NativeMeshCoreSession} from '../meshcore/NativeMeshCoreSession';

export type MeshCoreRadioManagementSession = NativeMeshCoreSession | MeshCoreClient;

export type AppRadioSettingsInput = MeshCoreRadioParams & {
  txPowerDbm: number;
};

export type AppVerifiedRadioSettings = {
  selfInfo: MeshCoreSelfInfo;
  deviceInfo: MeshCoreDeviceInfo;
  summary: string;
};

export async function refreshMeshCoreRadioSettings(
  session: MeshCoreRadioManagementSession,
): Promise<AppVerifiedRadioSettings> {
  const selfResponse = await session.sendAppStart('BushMesh');
  const deviceResponse = await session.sendDeviceQuery();
  const selfInfo = selfResponse.selfInfo;
  const deviceInfo = deviceResponse.deviceInfo;
  if (!selfInfo || !deviceInfo) {
    throw new Error('MeshCore radio settings could not be read from SELF_INFO / DEVICE_INFO.');
  }
  return {
    selfInfo,
    deviceInfo,
    summary: formatMeshCoreRadioParams({
      frequencyMhz: selfInfo.frequencyMhz ?? Number.NaN,
      bandwidthKhz: selfInfo.bandwidthKhz ?? Number.NaN,
      spreadingFactor: selfInfo.spreadingFactor ?? Number.NaN,
      codingRate: selfInfo.codingRate ?? Number.NaN,
    }),
  };
}

/**
 * Applies only the physical MeshCore radio profile. Channel slots, carrier PSKs,
 * BushMesh convoy membership and Security v1 material are outside this operation.
 */
export async function applyAndVerifyMeshCoreRadioSettings(
  session: MeshCoreRadioManagementSession,
  input: AppRadioSettingsInput,
): Promise<AppVerifiedRadioSettings> {
  const beforeDeviceResponse = await session.sendDeviceQuery();
  if (!beforeDeviceResponse.deviceInfo) {
    throw new Error('MeshCore Device Info is required before changing the radio profile.');
  }
  const repeatBefore = beforeDeviceResponse.deviceInfo.clientRepeat;

  let selfInfo = await session.setRadioParams({
    frequencyMhz: input.frequencyMhz,
    bandwidthKhz: input.bandwidthKhz,
    spreadingFactor: input.spreadingFactor,
    codingRate: input.codingRate,
  });

  if (selfInfo.txPower !== input.txPowerDbm) {
    selfInfo = await session.setRadioTxPower(input.txPowerDbm);
  }

  const deviceResponse = await session.sendDeviceQuery();
  if (!deviceResponse.deviceInfo) {
    throw new Error('MeshCore Device Info was unavailable after radio verification.');
  }
  const deviceInfo = deviceResponse.deviceInfo;
  if (
    deviceInfo.firmwareVersion >= 9 &&
    (repeatBefore === 0 || repeatBefore === 1) &&
    deviceInfo.clientRepeat !== repeatBefore
  ) {
    throw new Error(
      `MeshCore client-repeat mode changed unexpectedly from ${repeatBefore} to ${String(
        deviceInfo.clientRepeat,
      )}.`,
    );
  }

  return {
    selfInfo,
    deviceInfo,
    summary: formatMeshCoreRadioParams({
      frequencyMhz: selfInfo.frequencyMhz ?? input.frequencyMhz,
      bandwidthKhz: selfInfo.bandwidthKhz ?? input.bandwidthKhz,
      spreadingFactor: selfInfo.spreadingFactor ?? input.spreadingFactor,
      codingRate: selfInfo.codingRate ?? input.codingRate,
    }),
  };
}
