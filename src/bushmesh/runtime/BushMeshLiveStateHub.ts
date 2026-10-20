import {BushMeshDistressType, LocationPrecision} from '../protocol';

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
};

type Listener = () => void;

const listeners = new Set<Listener>();
let peerLocations = new Map<number, BushMeshLivePeerLocation>();
let distressAlerts: BushMeshLiveDistressAlert[] = [];
let revision = 0;
let snapshot: BushMeshLiveStateSnapshot = {
  peerLocations: [],
  distressAlerts: [],
  revision,
};

function rebuildSnapshot(): void {
  revision += 1;
  snapshot = {
    peerLocations: Array.from(peerLocations.values())
      .map(location => ({...location}))
      .sort((a, b) => b.receivedAt - a.receivedAt),
    distressAlerts: distressAlerts.map(alert => ({...alert})),
    revision,
  };

  for (const listener of listeners) {
    listener();
  }
}

export function publishBushMeshPeerLocation(
  location: BushMeshLivePeerLocation,
): void {
  peerLocations.set(location.nodeId, {...location});
  rebuildSnapshot();
}

export function publishBushMeshDistressAlert(
  alert: BushMeshLiveDistressAlert,
  maxAlerts = 50,
): void {
  const existingIndex = distressAlerts.findIndex(item => item.key === alert.key);

  if (existingIndex >= 0) {
    distressAlerts = distressAlerts.map((item, index) =>
      index === existingIndex ? {...alert} : item,
    );
  } else {
    distressAlerts = [{...alert}, ...distressAlerts].slice(0, maxAlerts);
  }

  rebuildSnapshot();
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
  peerLocations = new Map<number, BushMeshLivePeerLocation>();
  distressAlerts = [];
  rebuildSnapshot();
}

export function pruneBushMeshLiveState(
  now = Date.now(),
  options?: {
    locationMaxAgeMs?: number;
    distressMaxAgeMs?: number;
  },
): {locationsRemoved: number; alertsRemoved: number} {
  const locationMaxAgeMs = options?.locationMaxAgeMs ?? 24 * 60 * 60 * 1000;
  const distressMaxAgeMs = options?.distressMaxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
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
  const alertsRemoved = previousAlertCount - distressAlerts.length;

  if (locationsRemoved > 0 || alertsRemoved > 0) {
    rebuildSnapshot();
  }

  return {locationsRemoved, alertsRemoved};
}
