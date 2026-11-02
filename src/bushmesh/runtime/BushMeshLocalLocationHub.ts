import {CompactLocation} from '../protocol';

export type BushMeshLocalLocationSnapshot = {
  location: CompactLocation;
  capturedAtMs: number;
  accuracyMetres?: number;
  altitudeMetres?: number;
  speedKph?: number;
  headingDegrees?: number;
};

type Listener = (snapshot: BushMeshLocalLocationSnapshot | null) => void;

let current: BushMeshLocalLocationSnapshot | null = null;
const listeners = new Set<Listener>();

function clone(
  snapshot: BushMeshLocalLocationSnapshot | null,
): BushMeshLocalLocationSnapshot | null {
  return snapshot
    ? {
        ...snapshot,
        location: {...snapshot.location},
      }
    : null;
}

export function publishBushMeshLocalLocation(
  snapshot: BushMeshLocalLocationSnapshot,
): void {
  if (!Number.isFinite(snapshot.capturedAtMs) || snapshot.capturedAtMs < 0) {
    throw new Error('Local BushMesh location timestamp is invalid.');
  }

  current = clone(snapshot);
  const published = clone(current);
  for (const listener of listeners) {
    listener(published);
  }
}

export function getBushMeshLocalLocation(): BushMeshLocalLocationSnapshot | null {
  return clone(current);
}

export function clearBushMeshLocalLocation(): void {
  current = null;
  for (const listener of listeners) {
    listener(null);
  }
}

export function subscribeBushMeshLocalLocation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
