type BushMeshPublicKeyListener = (publicKey: string) => void;

let latestPublicKey: string | null = null;
const listeners = new Set<BushMeshPublicKeyListener>();

export function publishMeshCorePublicKey(publicKey: string): void {
  const normalized = publicKey.replace(/[^0-9a-f]/gi, '').toUpperCase();

  if (!normalized) {
    return;
  }

  latestPublicKey = normalized;

  for (const listener of listeners) {
    listener(normalized);
  }
}

export function getLatestMeshCorePublicKey(): string | null {
  return latestPublicKey;
}

export function subscribeMeshCorePublicKey(
  listener: BushMeshPublicKeyListener,
): () => void {
  listeners.add(listener);

  if (latestPublicKey) {
    listener(latestPublicKey);
  }

  return () => {
    listeners.delete(listener);
  };
}

export function clearMeshCorePublicKey(): void {
  latestPublicKey = null;
}
