import {BleManager, Device} from 'react-native-ble-plx';

import {MESHCORE_BLE} from './meshcoreBle';
import {
  buildSendChannelPayloadCommand,
  sendChannelPayloadCommandHex,
} from './meshcoreCommands';

export type MeshCoreBinaryChannelWriteResult = {
  channelIndex: number;
  payloadBytes: number[];
  timestampSeconds: number;
  commandHex: string;
};

/**
 * Writes an arbitrary channel payload to a connected MeshCore companion.
 *
 * This intentionally does not enable BushMesh binary transport by itself.
 * Callers must explicitly opt into binary BushMesh framing after real hardware
 * verifies that the companion firmware preserves arbitrary bytes unchanged.
 */
export async function writeMeshCoreChannelPayload(
  manager: BleManager,
  device: Device,
  channelIndex: number,
  payloadBytes: number[],
  timestampSeconds = Math.floor(Date.now() / 1000),
): Promise<MeshCoreBinaryChannelWriteResult> {
  if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 255) {
    throw new Error('MeshCore channel index must be an integer from 0 to 255.');
  }

  const base64Command = buildSendChannelPayloadCommand(
    channelIndex,
    payloadBytes,
    timestampSeconds,
  );
  const commandHex = sendChannelPayloadCommandHex(
    channelIndex,
    payloadBytes,
    timestampSeconds,
  );

  await manager.writeCharacteristicWithResponseForDevice(
    device.id,
    MESHCORE_BLE.serviceUuid,
    MESHCORE_BLE.rxCharacteristicUuid,
    base64Command,
  );

  return {
    channelIndex,
    payloadBytes: [...payloadBytes],
    timestampSeconds,
    commandHex,
  };
}
