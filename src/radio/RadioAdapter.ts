export type RadioConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type RadioCapabilities = {
  transport: 'ble' | 'usb' | 'tcp' | 'unknown';
  maxChannels: number | null;
  supportsChannelData: boolean;
  maxChannelDataBytes: number | null;
};

export type RadioDatagram = {
  channelIndex: number;
  dataType: number;
  payload: Uint8Array;
};

/**
 * Transport-neutral boundary between BushMesh domain features and a radio.
 *
 * MeshCore is the first implementation, but convoy, mapping and speech
 * features should depend on this contract rather than MeshCore-specific BLE
 * commands. A future BushMesh firmware adapter can implement the same surface.
 */
export interface RadioAdapter {
  readonly connectionState: RadioConnectionState;
  readonly capabilities: RadioCapabilities;

  sendDatagram(datagram: RadioDatagram): Promise<void>;
}
