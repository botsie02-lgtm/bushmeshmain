import type {BushMeshInboundMessage} from './meshcoreBridge';

type BushMeshInboundListener = (message: BushMeshInboundMessage) => void;

const listeners = new Set<BushMeshInboundListener>();

/**
 * Lightweight JS event bridge between radio transport and Bushmesh domain
 * state. The planned native radio service will eventually replace this, but
 * keeping the UI subscribed to domain messages now avoids coupling screens to
 * MeshCoreClient directly.
 */
export function publishBushMeshInboundMessage(
  message: BushMeshInboundMessage,
): void {
  listeners.forEach(listener => listener(message));
}

export function subscribeBushMeshInboundMessages(
  listener: BushMeshInboundListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
