import type {ReceivedDatagramListener} from './ReceivedDatagram';

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
 * Transport-neutral boundary between application/runtime services and a radio.
 * It transports bytes and link metadata only; packet encoding, encryption,
 * routing and BushMesh semantics belong above this interface.
 */
export interface RadioAdapter {
  readonly connectionState: RadioConnectionState;
  readonly capabilities: RadioCapabilities;

  sendDatagram(datagram: RadioDatagram): Promise<void>;

  /**
   * Optional during the compatibility migration. Production adapters should
   * expose inbound channel data through the neutral ReceivedDatagram contract.
   */
  subscribeReceivedDatagrams?(
    listener: ReceivedDatagramListener,
  ): () => void;
}
