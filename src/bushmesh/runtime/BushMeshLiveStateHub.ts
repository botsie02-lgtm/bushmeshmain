import {BushMeshDistressType, LocationPrecision} from '../protocol';
import {getBushMeshPersistentStore} from './BushMeshPersistentStore';

export type BushMeshLivePeerLocation = {
  nodeId: number;
  channelIndex: number;
  latitude: number;
  longitude: number;
  precision?: LocationPrecision | number;
  batteryPercent?: number;
  receivedAt: number;
};

export type BushMeshLiveDistressAlert = {
  key: string;
  nodeId: number;
  channelIndex: number;
  messageId: number;
  type: BushMeshDistressType | number;
  latitude?: number;
  longitude?: number;
  precision?: LocationPrecision | number;
  batteryPercent?: number;
  receivedAt: number;
};

export type BushMeshLiveStateSnapshot = {
  peerLocations: BushMeshLivePeerLocation[];
  distressAlerts: BushMeshLiveDistressAlert[];
  revision: number;
  hydrated: boolean;
};

type PersistedLiveState = {
  version: 1;
  peerLocations: BushMeshLivePeerLocation[];
  distressAlerts: BushMeshLiveDistressAlert[];
};

type Listener = () => void;

const LIVE_STATE_STORAGE_KEY = 'bushmesh.liveState.v1';
const DEFAULT_LOCATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DISTRESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED_ALERTS = 50;

const listeners = new Set<Listener>();
let peerLocations = new Map<number, BushMeshLivePeerLocation>();
let distressAlerts: BushMeshLiveDistressAlert[] = [];
let revision = 0;
let mutationEpoch = 0;
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;
let snapshot: BushMeshLiveStateSnapshot = {
  peerLocations: [],
  distressAlerts: [],
  revision,
  hydrated,
};

function isFiniteCoordinate(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validOptionalBattery(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 100)
  );
}

function validOptionalPrecision(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isValidLocation(value: unknown): value is BushMeshLivePeerLocation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<BushMeshLivePeerLocation>;
  return (
    typeof item.nodeId === 'number' &&
    Number.isInteger(item.nodeId) &&
    item.nodeId >= 0 &&
    typeof item.channelIndex === 'number' &&
    Number.isInteger(item.channelIndex) &&
    item.channelIndex >= 0 &&
    item.channelIndex <= 255 &&
    isFiniteCoordinate(item.latitude, -90, 90) &&
    isFiniteCoordinate(item.longitude, -180, 180) &&
    validOptionalPrecision(item.precision) &&
    validOptionalBattery(item.batteryPercent) &&
    typeof item.receivedAt === 'number' &&
    Number.isFinite(item.receivedAt) &&
    item.receivedAt >= 0
  );
}

function isValidDistress(value: unknown): value is BushMeshLiveDistressAlert {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<BushMeshLiveDistressAlert>;
  const hasLatitude = item.latitude !== undefined;
  const hasLongitude = item.longitude !== undefined;

  return (
    typeof item.key === 'string' &&
    item.key.length > 0 &&
    typeof item.nodeId === 'number' &&
    Number.isInteger(item.nodeId) &&
    item.nodeId >= 0 &&
    typeof item.channelIndex === 'number' &&
    Number.isInteger(item.channelIndex) &&
    item.channelIndex >= 0 &&
    item.channelIndex <= 255 &&
    typeof item.messageId === 'number' &&
    Number.isInteger(item.messageId) &&
    item.messageId >= 0 &&
    typeof item.type === 'number' &&
    Number.isFinite(item.type) &&
    typeof item.receivedAt === 'number' &&
    Number.isFinite(item.receivedAt) &&
    item.receivedAt >= 0 &&
    hasLatitude === hasLongitude &&
    (!hasLatitude || isFiniteCoordinate(item.latitude, -90, 90)) &&
    (!hasLongitude || isFiniteCoordinate(item.longitude, -180, 180)) &&
    validOptionalPrecision(item.precision) &&
    validOptionalBattery(item.batteryPercent)
  );
}

function rebuildSnapshot(): void {
  revision += 1;
  snapshot = {
    peerLocations: Array.from(peerLocations.values())
      .map(location => ({...location}))
      .sort((a, b) => b.receivedAt - a.receivedAt),
    distressAlerts: distressAlerts.map(alert => ({...alert})),
    revision,
    hydrated,
  };

  for (const listener of listeners) {
    listener();
  }
}

function currentPersistedState(): PersistedLiveState {
  return {
    version: 1,
    peerLocations: Array.from(peerLocations.values()).map(location => ({...location})),
    distressAlerts: distressAlerts
      .slice(0, MAX_PERSISTED_ALERTS)
      .map(alert => ({...alert})),
  };
}

async function persistLiveState(): Promise<void> {
  if (hydrationPromise) {
    await hydrationPromise;
  }

  const store = getBushMeshPersistentStore();
  if (!store) {
    return;
  }

  await store.setItem(
    LIVE_STATE_STORAGE_KEY,
    JSON.stringify(currentPersistedState()),
  );
}

function persistLiveStateBestEffort(): void {
  void persistLiveState().catch(() => {
    // Persistence must never interrupt radio processing or user interaction.
  });
}

function pruneState(
  now: number,
  locationMaxAgeMs: number,
  distressMaxAgeMs: number,
): {locationsRemoved: number; alertsRemoved: number} {
  let locationsRemoved = 0;

  for (const [nodeId, location] of peerLocations.entries()) {
    if (now - location.receivedAt > locationMaxAgeMs) {
      peerLocations.delete(nodeId);
      locationsRemoved += 1;
    }
  }

  const previousAlertCount = distressAlerts.length;
  distressAlerts = distressAlerts.filter(
    alert => now - alert.receivedAt <= distressMaxAgeMs,
  );

  return {
    locationsRemoved,
    alertsRemoved: previousAlertCount - distressAlerts.length,
  };
}

export function hydrateBushMeshLiveState(now = Date.now()): Promise<void> {
  if (hydrationPromise) {
    return hydrationPromise;
  }

  const epochAtStart = mutationEpoch;
  hydrationPromise = (async () => {
    const store = getBushMeshPersistentStore();
    if (!store) {
      hydrated = true;
      rebuildSnapshot();
      return;
    }

    try {
      const raw = await store.getItem(LIVE_STATE_STORAGE_KEY);

      if (mutationEpoch !== epochAtStart) {
        hydrated = true;
        rebuildSnapshot();
        await store.setItem(
          LIVE_STATE_STORAGE_KEY,
          JSON.stringify(currentPersistedState()),
        );
        return;
      }

      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedLiveState>;

        if (parsed.version === 1) {
          peerLocations = new Map<number, BushMeshLivePeerLocation>();
          for (const candidate of parsed.peerLocations ?? []) {
            if (!isValidLocation(candidate)) {
              continue;
            }

            const existing = peerLocations.get(candidate.nodeId);
            if (!existing || candidate.receivedAt > existing.receivedAt) {
              peerLocations.set(candidate.nodeId, {...candidate});
            }
          }

          const alertsByKey = new Map<string, BushMeshLiveDistressAlert>();
          for (const candidate of parsed.distressAlerts ?? []) {
            if (!isValidDistress(candidate)) {
              continue;
            }

            const existing = alertsByKey.get(candidate.key);
            if (!existing || candidate.receivedAt > existing.receivedAt) {
              alertsByKey.set(candidate.key, {...candidate});
            }
          }

          distressAlerts = Array.from(alertsByKey.values())
            .sort((a, b) => b.receivedAt - a.receivedAt)
            .slice(0, MAX_PERSISTED_ALERTS);

          pruneState(
            now,
            DEFAULT_LOCATION_MAX_AGE_MS,
            DEFAULT_DISTRESS_MAX_AGE_MS,
          );
        }
      }
    } catch {
      // Invalid or unavailable native state falls back to the live session.
    } finally {
      hydrated = true;
      rebuildSnapshot();
    }
  })();

  return hydrationPromise;
}

export function publishBushMeshPeerLocation(
  location: BushMeshLivePeerLocation,
): void {
  mutationEpoch += 1;
  const existing = peerLocations.get(location.nodeId);

  if (!existing || location.receivedAt >= existing.receivedAt) {
    peerLocations.set(location.nodeId, {...location});
    rebuildSnapshot();
    persistLiveStateBestEffort();
  }
}

export function publishBushMeshDistressAlert(
  alert: BushMeshLiveDistressAlert,
  maxAlerts = MAX_PERSISTED_ALERTS,
): void {
  mutationEpoch += 1;
  const existingIndex = distressAlerts.findIndex(item => item.key === alert.key);

  if (existingIndex >= 0) {
    distressAlerts = distressAlerts.map((item, index) =>
      index === existingIndex && alert.receivedAt >= item.receivedAt
        ? {...alert}
        : item,
    );
  } else {
    distressAlerts = [{...alert}, ...distressAlerts];
  }

  distressAlerts = distressAlerts
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, Math.max(1, maxAlerts));
  rebuildSnapshot();
  persistLiveStateBestEffort();
}

export function getBushMeshLiveStateSnapshot(): BushMeshLiveStateSnapshot {
  return snapshot;
}

export function subscribeBushMeshLiveState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearBushMeshLiveState(): void {
  mutationEpoch += 1;
  peerLocations = new Map<number, BushMeshLivePeerLocation>();
  distressAlerts = [];
  rebuildSnapshot();

  const store = getBushMeshPersistentStore();
  if (store) {
    void store.removeItem(LIVE_STATE_STORAGE_KEY).catch(() => {
      // Clearing in-memory state should still succeed if storage is unavailable.
    });
  }
}

export function pruneBushMeshLiveState(
  now = Date.now(),
  options?: {
    locationMaxAgeMs?: number;
    distressMaxAgeMs?: number;
  },
): {locationsRemoved: number; alertsRemoved: number} {
  const result = pruneState(
    now,
    options?.locationMaxAgeMs ?? DEFAULT_LOCATION_MAX_AGE_MS,
    options?.distressMaxAgeMs ?? DEFAULT_DISTRESS_MAX_AGE_MS,
  );

  if (result.locationsRemoved > 0 || result.alertsRemoved > 0) {
    mutationEpoch += 1;
    rebuildSnapshot();
    persistLiveStateBestEffort();
  }

  return result;
}

void hydrateBushMeshLiveState();
