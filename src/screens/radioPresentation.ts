import type {BushMeshChannelMessage} from '../state/BushMeshContext';

export type RadioPresentationPhase =
  | 'disconnected'
  | 'link-only'
  | 'carrier-ready'
  | 'runtime-ready';

export type RadioPresentation = {
  phase: RadioPresentationPhase;
  badge: string;
  title: string;
  explanation: string;
  maySubmitCarrierText: boolean;
};

/**
 * BLE/companion status, carrier message submission and BushMesh datagram
 * readiness are different claims. None of these implies peer delivery or
 * verified Security membership.
 */
export function deriveRadioPresentation(input: {
  connected: boolean;
  canSendChannelMessage: boolean;
  channelIndex: string | null;
  channelName: string | null;
  protocolTransportReady: boolean;
}): RadioPresentation {
  if (!input.connected) {
    return {
      phase: 'disconnected',
      badge: 'DISCONNECTED',
      title: 'Connect your companion',
      explanation: 'No active MeshCore companion link; outgoing channel text is unavailable.',
      maySubmitCarrierText: false,
    };
  }
  const selected = input.channelIndex !== null &&
    /^(?:[0-7])$/.test(input.channelIndex) &&
    !!input.channelName?.trim();
  if (!input.canSendChannelMessage || !selected) {
    return {
      phase: 'link-only',
      badge: 'COMPANION ONLY',
      title: 'Radio linked · messages not ready',
      explanation: 'Companion state alone does not prove the selected carrier can submit text.',
      maySubmitCarrierText: false,
    };
  }
  if (!input.protocolTransportReady) {
    return {
      phase: 'carrier-ready',
      badge: 'CARRIER READY',
      title: 'Channel text available',
      explanation: 'Carrier submission is available; canonical BushMesh data transport is not ready. Peers have not acknowledged anything.',
      maySubmitCarrierText: true,
    };
  }
  return {
    phase: 'runtime-ready',
    badge: 'CARRIER READY',
    title: 'Companion and data runtime ready',
    explanation: 'Carrier submission and datagram runtime are available. Any individual peer delivery still requires its own acknowledgement.',
    maySubmitCarrierText: true,
  };
}

export function scopedCarrierHistory(
  activeChannelIndex: string | null,
  messages: readonly BushMeshChannelMessage[],
): BushMeshChannelMessage[] {
  if (activeChannelIndex === null) return [];
  return messages.filter(message =>
    message.channelIndex === activeChannelIndex,
  );
}

export function carrierMessageSummary(messages: readonly BushMeshChannelMessage[]) {
  return {
    received: messages.filter(x => x.direction === 'received').length,
    pending: messages.filter(x => x.direction === 'sent' && x.status === 'pending').length,
    accepted: messages.filter(x => x.direction === 'sent' && x.status === 'accepted').length,
    confirmed: messages.filter(x => x.direction === 'sent' && x.status === 'confirmed').length,
    failed: messages.filter(x => x.direction === 'sent' && x.status === 'failed').length,
  };
}
