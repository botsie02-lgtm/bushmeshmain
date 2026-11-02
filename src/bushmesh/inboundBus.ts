import type {BushMeshInboundMessage} from '../radio/LegacyBushMeshInboundAdapter';

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

/** Legacy application-domain bus retained until the canonical runtime replaces it. */
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
