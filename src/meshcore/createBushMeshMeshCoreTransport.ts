import {BleManager, Device} from 'react-native-ble-plx';

import {BushMeshRuntimeTransport} from '../bushmesh/runtime/BushMeshNetworkRuntime';
import {MeshCoreClient} from './MeshCoreClient';
import {writeMeshCoreChannelPayload} from './meshcoreBinaryTransport';

export type BushMeshMeshCoreTransportOptions = {
  enableExperimentalBinary?: boolean;
};

/**
 * Creates the transport surface consumed by BushMeshNetworkRuntime.
 *
 * Text-safe MeshCore channel messages are always available. Raw binary channel
 * payloads are exposed only when the caller explicitly enables them, keeping
 * the production default compatible until real Heltec-to-Heltec testing proves
 * arbitrary byte preservation.
 */
export function createBushMeshMeshCoreTransport(
  client: MeshCoreClient,
  manager: BleManager,
  device: Device,
  options?: BushMeshMeshCoreTransportOptions,
): BushMeshRuntimeTransport {
  const transport: BushMeshRuntimeTransport = {
    sendTextChannelMessage: async (channelIndex, message) =>
      client.sendChannelMessage(channelIndex, message),
  };

  if (options?.enableExperimentalBinary === true) {
    transport.sendBinaryChannelPayload = async (channelIndex, payloadBytes) =>
      writeMeshCoreChannelPayload(manager, device, channelIndex, payloadBytes);
  }

  return transport;
}
