export type ReceivedDatagramTransport = 'meshcore' | 'ble' | 'usb' | 'tcp' | 'unknown';
export type ReceivedDatagramSource = 'live' | 'background-replay';

export type ReceivedDatagramLinkMetadata = {
  rssiDbm?: number;
  snrDb?: number;
  pathLength?: number;
};

export type ReceivedDatagram = {
  channelIndex: number;
  dataType: number;
  payload: Uint8Array;
  receivedAtMs: number;
  transport: ReceivedDatagramTransport;
  source: ReceivedDatagramSource;
  link?: ReceivedDatagramLinkMetadata;
  radioIdentityRef?: string | null;
  transportDeviceId?: string | null;
  diagnosticLabel?: string | null;
};

export type ReceivedDatagramListener = (datagram: ReceivedDatagram) => void;

const listeners = new Set<ReceivedDatagramListener>();

function finiteOrUndefined(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeReceivedDatagram(
  datagram: ReceivedDatagram,
): ReceivedDatagram {
  if (!Number.isInteger(datagram.channelIndex) || datagram.channelIndex < 0) {
    throw new Error('Received datagram channelIndex must be a non-negative integer.');
  }
  if (!Number.isInteger(datagram.dataType) || datagram.dataType < 0 || datagram.dataType > 0xffff) {
    throw new Error('Received datagram dataType must be a uint16.');
  }

  const receivedAtMs =
    Number.isFinite(datagram.receivedAtMs) && datagram.receivedAtMs >= 0
      ? datagram.receivedAtMs
      : Date.now();
  const link = datagram.link
    ? {
        rssiDbm: finiteOrUndefined(datagram.link.rssiDbm),
        snrDb: finiteOrUndefined(datagram.link.snrDb),
        pathLength: finiteOrUndefined(datagram.link.pathLength),
      }
    : undefined;

  return {
    ...datagram,
    payload: Uint8Array.from(datagram.payload),
    receivedAtMs,
    link,
  };
}

/**
 * Process-local handoff between radio lifecycle code and a protocol/runtime.
 * Radio-core owns transport metadata only; consumers own packet interpretation.
 */
export function publishReceivedDatagram(datagram: ReceivedDatagram): void {
  const normalized = normalizeReceivedDatagram(datagram);
  listeners.forEach(listener => listener(normalized));
}

export function subscribeReceivedDatagrams(
  listener: ReceivedDatagramListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
