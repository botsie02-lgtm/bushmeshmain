import {Device} from 'react-native-ble-plx';

export const MESHCORE_BLE = {
  serviceUuid: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
  rxCharacteristicUuid: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E',
  txCharacteristicUuid: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E',
};

export type MeshCoreBleDiscovery = {
  serviceFound: boolean;
  rxFound: boolean;
  txFound: boolean;
};

export async function discoverMeshCoreBle(
  device: Device,
): Promise<MeshCoreBleDiscovery> {
  const services = await device.services();

  const meshCoreService = services.find(
    service =>
      service.uuid.toLowerCase() === MESHCORE_BLE.serviceUuid.toLowerCase(),
  );

  if (!meshCoreService) {
    return {
      serviceFound: false,
      rxFound: false,
      txFound: false,
    };
  }

  const characteristics = await meshCoreService.characteristics();

  const rxFound = characteristics.some(
    characteristic =>
      characteristic.uuid.toLowerCase() ===
      MESHCORE_BLE.rxCharacteristicUuid.toLowerCase(),
  );

  const txFound = characteristics.some(
    characteristic =>
      characteristic.uuid.toLowerCase() ===
      MESHCORE_BLE.txCharacteristicUuid.toLowerCase(),
  );

  return {
    serviceFound: true,
    rxFound,
    txFound,
  };
}