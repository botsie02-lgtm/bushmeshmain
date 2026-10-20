import {
  BushMeshLivePeerLocation,
  getBushMeshLiveStateSnapshot,
  subscribeBushMeshLiveState,
} from './BushMeshLiveStateHub';
import {getBushMeshPersistentStore} from './BushMeshPersistentStore';

export type BushMeshPeerTrack = {
  nodeId: number;
  points: BushMeshLivePeerLocation[];
};

export type BushMeshPeerTrackSnapshot = {
  tracks: BushMeshPeerTrack[];
  totalPoints: number;
  hydrated: boolean;
  revision: number;
};

type PersistedTracks = {
  version: 1;
  tracks: BushMeshPeerTrack[];
};

type Listener = () => void;

const STORAGE_KEY = 'bushmesh.peerTracks.v1';
const MAX_POINTS_PER_NODE = 20;
const MAX_TOTAL_POINTS = 240;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const listeners = new Set<Listener>();
const tracks = new Map<number, BushMeshLivePeerLocation[]>();
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;
let mutationEpoch = 0;
let revision = 0;
let snapshot: BushMeshPeerTrackSnapshot = {
  tracks: [],
  totalPoints: 0,
  hydrated,
  revision,
};

function clonePoint(point: BushMeshLivePeerLocation): BushMeshLivePeerLocation {
  return {...point};
}

function rebuildSnapshot(): void {
  revision += 1;
  const nextTracks = Array.from(tracks.entries())
    .map(([nodeId, points]) => ({
      nodeId,
      points: points.map(clonePoint),
    }))
    .filter(track => track.points.length > 0)
    .sort((a, b) => {
      const aTime = a.points[a.points.length - 1]?.receivedAt ?? 0;
      const bTime = b.points[b.points.length - 1]?.receivedAt ?? 0;
      return bTime - aTime;
    });

  snapshot = {
    tracks: nextTracks,
    totalPoints: nextTracks.reduce((sum, track) => sum + track.points.length, 0),
    hydrated,
    revision,
  };

  for (const listener of listeners) {
    listener();
  }
}

function isValidPoint(value: unknown): value is BushMeshLivePeerLocation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const point = value as Partial<BushMeshLivePeerLocation>;
  return (
    typeof point.nodeId === 'number' &&
    Number.isInteger(point.nodeId) &&
    point.nodeId >= 0 &&
    typeof point.channelIndex === 'number' &&
    Number.isInteger(point.channelIndex) &&
    point.channelIndex >= 0 &&
    point.channelIndex <= 255 &&
    typeof point.latitude === 'number' &&
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180 &&
    typeof point.receivedAt === 'number' &&
    Number.isFinite(point.receivedAt) &&
    point.receivedAt >= 0
  );
}

function trim(now = Date.now()): void {
  for (const [nodeId, points] of tracks.entries()) {
    const kept = points
      .filter(point => now - point.receivedAt <= MAX_AGE_MS)
      .sort((a, b) => a.receivedAt - b.receivedAt)
      .slice(-MAX_POINTS_PER_NODE);

    if (kept.length === 0) {
      tracks.delete(nodeId);
    } else {
      tracks.set(nodeId, kept);
    }
  }

  const all = Array.from(tracks.values())
    .flat()
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, MAX_TOTAL_POINTS);
  const allowed = new Set(all.map(point => `${point.nodeId}:${point.receivedAt}`));

  for (const [nodeId, points] of tracks.entries()) {
    const kept = points.filter(point => allowed.has(`${point.nodeId}:${point.receivedAt}`));
    if (kept.length === 0) {
      tracks.delete(nodeId);
    } else {
      tracks.set(nodeId, kept);
    }
  }
}

function shouldAppend(
  previous: BushMeshLivePeerLocation | undefined,
  next: BushMeshLivePeerLocation,
): boolean {
  if (!previous) {
    return true;
  }
  if (next.receivedAt <= previous.receivedAt) {
    return false;
  }

  const moved =
    Math.abs(next.latitude - previous.latitude) > 0.000001 ||
    Math.abs(next.longitude - previous.longitude) > 0.000001;
  const heartbeatElapsed = next.receivedAt - previous.receivedAt >= 5 * 60 * 1000;
  return moved || heartbeatElapsed;
}

function persistedPayload(): PersistedTracks {
  return {
    version: 1,
    tracks: Array.from(tracks.entries()).map(([nodeId, points]) => ({
      nodeId,
      points: points.map(clonePoint),
    })),
  };
}

async function persist(): Promise<void> {
  if (hydrationPromise) {
    await hydrationPromise;
  }

  const store = getBushMeshPersistentStore();
  if (!store) {
    return;
  }

  await store.setItem(STORAGE_KEY, JSON.stringify(persistedPayload()));
}

function persistBestEffort(): void {
  void persist().catch(() => {
    // Track persistence is supplementary and must not affect radio processing.
  });
}

function acceptLatestLocations(): boolean {
  let changed = false;

  for (const location of getBushMeshLiveStateSnapshot().peerLocations) {
    const points = tracks.get(location.nodeId) ?? [];
    const previous = points[points.length - 1];

    if (!shouldAppend(previous, location)) {
      continue;
    }

    tracks.set(location.nodeId, [...points, clonePoint(location)]);
    changed = true;
  }

  if (changed) {
    mutationEpoch += 1;
    trim();
    rebuildSnapshot();
    persistBestEffort();
  }

  return changed;
}

export function hydrateBushMeshPeerTracks(now = Date.now()): Promise<void> {
  if (hydrationPromise) {
    return hydrationPromise;
  }

  const epochAtStart = mutationEpoch;
  hydrationPromise = (async () => {
    const store = getBushMeshPersistentStore();
    if (!store) {
      hydrated = true;
      acceptLatestLocations();
      rebuildSnapshot();
      return;
    }

    try {
      const raw = await store.getItem(STORAGE_KEY);
      if (mutationEpoch === epochAtStart && raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedTracks>;
        if (parsed.version === 1 && Array.isArray(parsed.tracks)) {
          tracks.clear();
          for (const candidate of parsed.tracks) {
            if (
              !candidate ||
              typeof candidate.nodeId !== 'number' ||
              !Number.isInteger(candidate.nodeId) ||
              !Array.isArray(candidate.points)
            ) {
              continue;
            }

            const points = candidate.points
              .filter(isValidPoint)
              .filter(point => point.nodeId === candidate.nodeId)
              .sort((a, b) => a.receivedAt - b.receivedAt);
            if (points.length > 0) {
              tracks.set(candidate.nodeId, points);
            }
          }
          trim(now);
        }
      }
    } catch {
      // Corrupt storage falls back to live locations.
    } finally {
      hydrated = true;
      acceptLatestLocations();
      rebuildSnapshot();
    }
  })();

  return hydrationPromise;
}

export function clearBushMeshPeerTracks(): void {
  mutationEpoch += 1;
  tracks.clear();
  rebuildSnapshot();

  const store = getBushMeshPersistentStore();
  if (store) {
    void store.removeItem(STORAGE_KEY).catch(() => {
      // In-memory clear remains successful if native persistence is unavailable.
    });
  }
}

export function getBushMeshPeerTrackSnapshot(): BushMeshPeerTrackSnapshot {
  return snapshot;
}

export function subscribeBushMeshPeerTracks(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

subscribeBushMeshLiveState(() => {
  acceptLatestLocations();
});
void hydrateBushMeshPeerTracks();
