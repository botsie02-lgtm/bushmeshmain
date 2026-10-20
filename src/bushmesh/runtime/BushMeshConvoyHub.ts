import {
  BushMeshConvoyRole,
  BushMeshConvoyStatus,
  CompactLocation,
} from '../protocol';
import {
  BushMeshConvoySnapshot,
  BushMeshConvoyTracker,
} from './BushMeshConvoyTracker';

export type BushMeshConvoyLocalConfig = {
  enabled: boolean;
  convoyId: number;
  orderIndex: number;
  role: BushMeshConvoyRole | number;
  heartbeatIntervalMs: number;
};

export type BushMeshConvoyLocalTelemetry = {
  location?: CompactLocation;
  speedKph?: number;
  headingDegrees?: number;
  batteryPercent?: number;
  stopped?: boolean;
  hazard?: boolean;
};

export type BushMeshConvoyHubState = {
  revision: number;
  config: BushMeshConvoyLocalConfig;
  telemetry: BushMeshConvoyLocalTelemetry;
  snapshot: BushMeshConvoySnapshot | null;
  lastTransmitAt: number | null;
  lastReceiveAt: number | null;
};

type Listener = () => void;

const tracker = new BushMeshConvoyTracker();
const listeners = new Set<Listener>();

let sequence = 1;
let revision = 0;
let config: BushMeshConvoyLocalConfig = {
  enabled: false,
  convoyId: 1,
  orderIndex: 0,
  role: BushMeshConvoyRole.Member,
  heartbeatIntervalMs: 10_000,
};
let telemetry: BushMeshConvoyLocalTelemetry = {};
let lastTransmitAt: number | null = null;
let lastReceiveAt: number | null = null;

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function configureBushMeshConvoy(
  next: Partial<BushMeshConvoyLocalConfig>,
): BushMeshConvoyLocalConfig {
  const merged = {...config, ...next};

  if (!Number.isInteger(merged.convoyId) || merged.convoyId < 0 || merged.convoyId > 0xffffffff) {
    throw new Error('Convoy ID must be a uint32 value.');
  }
  if (!Number.isInteger(merged.orderIndex) || merged.orderIndex < 0 || merged.orderIndex > 0xffff) {
    throw new Error('Convoy position must be from 0 to 65535.');
  }
  if (!Number.isInteger(merged.role) || merged.role < 0 || merged.role > 7) {
    throw new Error('Convoy role must be from 0 to 7.');
  }
  if (!Number.isFinite(merged.heartbeatIntervalMs) || merged.heartbeatIntervalMs < 2_000) {
    throw new Error('Convoy heartbeat interval must be at least two seconds.');
  }

  config = merged;
  notify();
  return {...config};
}

export function updateBushMeshConvoyTelemetry(
  update: BushMeshConvoyLocalTelemetry,
): BushMeshConvoyLocalTelemetry {
  telemetry = {
    ...telemetry,
    ...update,
    location: update.location
      ? {...update.location}
      : telemetry.location
        ? {...telemetry.location}
        : undefined,
  };
  notify();
  return bushMeshConvoyTelemetry();
}

export function bushMeshConvoyTelemetry(): BushMeshConvoyLocalTelemetry {
  return {
    ...telemetry,
    location: telemetry.location ? {...telemetry.location} : undefined,
  };
}

export function nextBushMeshConvoyStatus(
  nodeId: number,
  now = Date.now(),
): BushMeshConvoyStatus {
  const status: BushMeshConvoyStatus = {
    convoyId: config.convoyId,
    nodeId,
    sequence,
    orderIndex: config.orderIndex,
    role: config.role,
    location: telemetry.location ? {...telemetry.location} : undefined,
    speedKph: telemetry.speedKph,
    headingDegrees: telemetry.headingDegrees,
    batteryPercent: telemetry.batteryPercent,
    stopped: telemetry.stopped,
    hazard: telemetry.hazard,
  };

  sequence = (sequence + 1) >>> 0;
  if (sequence === 0) {
    sequence = 1;
  }

  tracker.accept(status, now);
  return status;
}

export function markBushMeshConvoyTransmitted(now = Date.now()): void {
  lastTransmitAt = now;
  notify();
}

export function acceptBushMeshConvoyRemote(
  status: BushMeshConvoyStatus,
  receivedAt = Date.now(),
): boolean {
  const accepted = tracker.accept(status, receivedAt);
  if (accepted) {
    lastReceiveAt = receivedAt;
    notify();
  }
  return accepted;
}

export function getBushMeshConvoyState(now = Date.now()): BushMeshConvoyHubState {
  return {
    revision,
    config: {...config},
    telemetry: bushMeshConvoyTelemetry(),
    snapshot: tracker.snapshot(config.convoyId, now),
    lastTransmitAt,
    lastReceiveAt,
  };
}

export function subscribeBushMeshConvoy(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearBushMeshConvoyRemoteState(): void {
  tracker.clear();
  lastReceiveAt = null;
  notify();
}
