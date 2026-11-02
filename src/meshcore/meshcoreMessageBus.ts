import {ParsedChannelMessage} from './meshcoreParsers';

export type MeshCoreChannelMessageAcceptedEvent = {
  kind: 'channel-accepted';
  channelIndex: number;
  text: string;
  timestampSeconds: number;
  expectedAckHex: string | null;
  suggestedTimeoutMs: number | null;
};

export type MeshCoreMessageConfirmedEvent = {
  kind: 'confirmed';
  ackHex: string;
  roundTripMs: number | null;
  receivedAtMs: number;
};

export type MeshCoreInboundChannelMessageEvent = {
  kind: 'channel-received';
  message: ParsedChannelMessage;
  receivedAtMs: number;
};

export type MeshCoreMessageEvent =
  | MeshCoreChannelMessageAcceptedEvent
  | MeshCoreMessageConfirmedEvent
  | MeshCoreInboundChannelMessageEvent;

type MeshCoreMessageListener = (event: MeshCoreMessageEvent) => void;

const listeners = new Set<MeshCoreMessageListener>();

export function publishMeshCoreMessageEvent(event: MeshCoreMessageEvent): void {
  listeners.forEach(listener => listener(event));
}

export function subscribeMeshCoreMessageEvents(
  listener: MeshCoreMessageListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
