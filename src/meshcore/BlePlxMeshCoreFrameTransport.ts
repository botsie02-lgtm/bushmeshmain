import {BleManager, Device, Subscription} from 'react-native-ble-plx';

import {MESHCORE_BLE} from './meshcoreBle';
import {base64ToBytes} from './meshcorePackets';
import {
  MeshCoreFrameTransport,
  MeshCoreFrameTransportHandlers,
} from './MeshCoreFrameTransport';

const REQUESTED_BLE_MTU = 185;

/**
 * Compatibility transport for the existing React Native BLE ownership path.
 *
 * Keeping BLE-PLX behind the same raw-frame boundary as the Android foreground
 * transport lets MeshCore protocol code migrate without changing command or
 * packet semantics.
 */
export class BlePlxMeshCoreFrameTransport implements MeshCoreFrameTransport {
  readonly id: string;

  private subscription: Subscription | null = null;
  private readyPromise: Promise<number | null> | null = null;

  constructor(
    private readonly manager: BleManager,
    private readonly device: Device,
  ) {
    this.id = `ble-plx:${device.id}`;
  }

  start(handlers: MeshCoreFrameTransportHandlers): void {
    this.stop();
    this.subscription = this.manager.monitorCharacteristicForDevice(
      this.device.id,
      MESHCORE_BLE.serviceUuid,
      MESHCORE_BLE.txCharacteristicUuid,
      (error, characteristic) => {
        if (error) {
          handlers.onError?.(`MeshCore BLE notification error: ${error.message}`);
          return;
        }
        if (!characteristic?.value) {
          return;
        }

        try {
          handlers.onFrame(base64ToBytes(characteristic.value));
        } catch (decodeError) {
          handlers.onError?.(
            decodeError instanceof Error
              ? `MeshCore BLE frame decode failed: ${decodeError.message}`
              : 'MeshCore BLE frame decode failed.',
          );
        }
      },
    );
    handlers.onStatus?.('BLE-PLX MeshCore frame transport started.');
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.readyPromise = null;
  }

  async writeBase64(base64Frame: string): Promise<void> {
    if (!base64Frame) {
      throw new Error('MeshCore BLE frame cannot be empty.');
    }

    await this.manager.writeCharacteristicWithResponseForDevice(
      this.device.id,
      MESHCORE_BLE.serviceUuid,
      MESHCORE_BLE.rxCharacteristicUuid,
      base64Frame,
    );
  }

  ensureReady(): Promise<number | null> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = this.manager
      .requestMTUForDevice(this.device.id, REQUESTED_BLE_MTU)
      .then(readyDevice =>
        typeof readyDevice.mtu === 'number' ? readyDevice.mtu : null,
      )
      .catch(() => null);

    return this.readyPromise;
  }
}
