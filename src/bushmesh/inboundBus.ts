import type {BushMeshInboundMessage} from './meshcoreBridge';

export type BushMeshInboundSource = 'live' | 'background-replay';

export type BushMeshInboundMetadata = {
  receivedAtMs: number;
  source: BushMeshInboundSource;
};

type BushMeshInboundListener = (
  message: BushMeshInboundMessage,
  metadata: BushMeshInboundMetadata,
) => void;

const listeners = new Set<BushMeshInboundListener>();

function normalizeMetadata(
  metadata?: Partial<BushMeshInboundMetadata>,
): BushMeshInboundMetadata {
  const receivedAtMs =
    typeof metadata?.receivedAtMs === 'number' &&
    Number.isFinite(metadata.receivedAtMs) &&
    metadata.receivedAtMs >= 0
      ? metadata.receivedAtMs
      : Date.now();

  return {
    receivedAtMs,
    source: metadata?.source ?? 'live',
  };
}

/**
 * Lightweight event bridge between radio transports and Bushmesh domain state.
 *
 * Metadata is part of the domain boundary because traffic replayed after an
 * Android process restart must retain the time it was actually heard. Treating
 * replay time as receive time would falsely make stale convoy positions appear
 * live. Callers that do not supply metadata remain live by default.
 */
export function publishBushMeshInboundMessage(
  message: BushMeshInboundMessage,
  metadata?: Partial<BushMeshInboundMetadata>,
): void {
  const normalized = normalizeMetadata(metadata);
  listeners.forEach(listener => listener(message, normalized));
}

export function subscribeBushMeshInboundMessages(
  listener: BushMeshInboundListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
