export type MeshCoreFrameTransportHandlers = {
  onFrame: (bytes: number[]) => void;
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
};

/**
 * Raw companion-frame transport used by the MeshCore protocol client.
 *
 * A transport owns connection-specific mechanics such as BLE notifications,
 * MTU, reconnect and writes. It must preserve MeshCore frame boundaries: each
 * onFrame callback represents exactly one companion frame.
 */
export interface MeshCoreFrameTransport {
  readonly id: string;

  start(handlers: MeshCoreFrameTransportHandlers): Promise<void> | void;
  stop(): Promise<void> | void;
  writeBase64(base64Frame: string): Promise<void>;
  ensureReady(): Promise<number | null>;
}
