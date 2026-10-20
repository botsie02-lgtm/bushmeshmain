import {
  BushMeshConvoyRole,
  BushMeshConvoyStatus,
  BushMeshForwardingInput,
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
  // A different convoy shares the physical channel but must not influence this
  // convoy's forwarding corridor or health state.
  if (status.convoyId !== config.convoyId) {
    return false;
  }

  const accepted = tracker.accept(status, receivedAt);
  if (accepted) {
    lastReceiveAt = receivedAt;
    notify();
  }
  return accepted;
}

/**
 * Returns true/false only when the local convoy has enough topology knowledge
 * to make a safe corridor decision. null means "unknown", which deliberately
 * falls back to normal controlled flooding rather than risking packet loss.
 */
export function bushMeshConvoyForwardingPermission(
  input: BushMeshForwardingInput,
  now = Date.now(),
): boolean | null {
  if (!config.enabled || input.destinationNodeId === undefined) {
    return null;
  }

  const snapshot = tracker.snapshot(config.convoyId, now);
  const local = snapshot.members.find(
    member => member.status.nodeId === input.localNodeId,
  );
  const source = snapshot.members.find(
    member => member.status.nodeId === input.sourceNodeId,
  );
  const destination = snapshot.members.find(
    member => member.status.nodeId === input.destinationNodeId,
  );

  if (!local || !source || !destination) {
    return null;
  }

  if (local.health !== 'active') {
    return false;
  }

  if (input.previousHopNodeId !== undefined) {
    const previous = snapshot.members.find(
      member => member.status.nodeId === input.previousHopNodeId,
    );
    if (!previous) {
      return null;
    }

    const relays = tracker.relayCandidates(
      config.convoyId,
      input.previousHopNodeId,
      input.destinationNodeId,
      now,
    );
    return relays[0] === input.localNodeId;
  }

  const low = Math.min(source.status.orderIndex, destination.status.orderIndex);
  const high = Math.max(source.status.orderIndex, destination.status.orderIndex);
  return local.status.orderIndex > low && local.status.orderIndex < high;
}

export function recommendedBushMeshConvoyHeartbeatMs(): number {
  if (telemetry.hazard) {
    return Math.min(config.heartbeatIntervalMs, 3_000);
  }
  if (telemetry.stopped) {
    return Math.max(config.heartbeatIntervalMs, 20_000);
  }
  return config.heartbeatIntervalMs;
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
