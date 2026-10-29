import {
  BushMeshControlCommand,
  BushMeshConvoyAction,
  BushMeshConvoyActionControl,
  BushMeshConvoyRole,
  BushMeshConvoyStatus,
  BushMeshForwardingInput,
  CompactLocation,
  convoyLocationDelta,
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
  locationCapturedAtMs?: number;
  speedKph?: number;
  headingDegrees?: number;
  batteryPercent?: number;
  stopped?: boolean;
  hazard?: boolean;
};

export type BushMeshConvoyCommandEntry = {
  command: BushMeshConvoyActionControl;
  receivedAt: number;
  local: boolean;
};

export type BushMeshConvoyHubState = {
  revision: number;
  config: BushMeshConvoyLocalConfig;
  telemetry: BushMeshConvoyLocalTelemetry;
  snapshot: BushMeshConvoySnapshot | null;
  recentCommands: BushMeshConvoyCommandEntry[];
  lastTransmitAt: number | null;
  lastReceiveAt: number | null;
};

type Listener = () => void;

const tracker = new BushMeshConvoyTracker();
const listeners = new Set<Listener>();
const seenCommandKeys = new Map<string, number>();

const NORMAL_LOCATION_ANCHOR_MS = 60_000;
const HAZARD_LOCATION_ANCHOR_MS = 20_000;
const MAX_LOCAL_LOCATION_AGE_MS = 90_000;
const MAX_LOCATION_FUTURE_SKEW_MS = 30_000;
const LOCATION_CHANGE_THRESHOLD_METRES = 2;
const MAX_DELTA_COMPONENT_METRES = 20_000;
const SPEED_CHANGE_THRESHOLD_KPH = 1.5;
const HEADING_CHANGE_THRESHOLD_DEGREES = 8;
const NORMAL_MOTION_REFRESH_MS = 20_000;
const HAZARD_MOTION_REFRESH_MS = 10_000;
const BATTERY_REFRESH_MS = 120_000;

let sequence = 1;
let commandSequence = 1;
let revision = 0;
let config: BushMeshConvoyLocalConfig = {
  enabled: false,
  convoyId: 1,
  orderIndex: 0,
  role: BushMeshConvoyRole.Member,
  heartbeatIntervalMs: 10_000,
};
let telemetry: BushMeshConvoyLocalTelemetry = {};
let recentCommands: BushMeshConvoyCommandEntry[] = [];
let lastTransmitAt: number | null = null;
let lastReceiveAt: number | null = null;
let outboundLocationAnchor: CompactLocation | null = null;
let outboundLocationAnchorAt: number | null = null;
let outboundSpeedKph: number | undefined;
let outboundSpeedAt: number | null = null;
let outboundHeadingDegrees: number | undefined;
let outboundHeadingAt: number | null = null;
let outboundBatteryPercent: number | undefined;
let outboundBatteryAt: number | null = null;

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

function assertWholeNumberInRange(
  value: number,
  min: number,
  max: number,
  label: string,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  }
}

function assertFiniteInRange(
  value: number,
  min: number,
  max: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be from ${min} to ${max}.`);
  }
}

function validateLocation(location: CompactLocation): void {
  assertFiniteInRange(location.latitude, -90, 90, 'Convoy latitude');
  assertFiniteInRange(location.longitude, -180, 180, 'Convoy longitude');
  if (location.precision !== undefined) {
    assertWholeNumberInRange(
      location.precision,
      0,
      3,
      'Convoy location precision',
    );
  }
}

function commandKey(command: BushMeshConvoyActionControl): string {
  return `${command.convoyId}:${command.originNodeId}:${command.sequence}`;
}

function rememberCommand(
  command: BushMeshConvoyActionControl,
  receivedAt: number,
  local: boolean,
): boolean {
  const key = commandKey(command);
  if (seenCommandKeys.has(key)) {
    return false;
  }

  seenCommandKeys.set(key, receivedAt);
  recentCommands = [
    {
      command: {...command},
      receivedAt,
      local,
    },
    ...recentCommands,
  ].slice(0, 30);

  const cutoff = receivedAt - 60 * 60 * 1000;
  for (const [seenKey, seenAt] of seenCommandKeys.entries()) {
    if (seenAt < cutoff) {
      seenCommandKeys.delete(seenKey);
    }
  }

  notify();
  return true;
}

function resetOutboundCompressionState(): void {
  outboundLocationAnchor = null;
  outboundLocationAnchorAt = null;
  outboundSpeedKph = undefined;
  outboundSpeedAt = null;
  outboundHeadingDegrees = undefined;
  outboundHeadingAt = null;
  outboundBatteryPercent = undefined;
  outboundBatteryAt = null;
}

export function isBushMeshConvoyLocationFresh(now = Date.now()): boolean {
  if (!telemetry.location || telemetry.locationCapturedAtMs === undefined) {
    return false;
  }

  const ageMs = now - telemetry.locationCapturedAtMs;
  return ageMs >= -MAX_LOCATION_FUTURE_SKEW_MS && ageMs <= MAX_LOCAL_LOCATION_AGE_MS;
}

function convoyLocationFields(
  now: number,
): Pick<
  BushMeshConvoyStatus,
  'location' | 'locationDelta' | 'locationUnavailable'
> {
  const current = telemetry.location;
  if (!current || !isBushMeshConvoyLocationFresh(now)) {
    // Explicit invalidation lets receivers immediately stop using an old fix in
    // gap/routing calculations. It costs only the spare bit in the flags byte.
    outboundLocationAnchor = null;
    outboundLocationAnchorAt = null;
    return {locationUnavailable: true};
  }

  const anchorIntervalMs = telemetry.hazard
    ? HAZARD_LOCATION_ANCHOR_MS
    : NORMAL_LOCATION_ANCHOR_MS;
  const anchor = outboundLocationAnchor;
  const anchorAt = outboundLocationAnchorAt;

  if (
    !anchor ||
    anchorAt === null ||
    now - anchorAt >= anchorIntervalMs
  ) {
    outboundLocationAnchor = {...current};
    outboundLocationAnchorAt = now;
    return {location: {...current}};
  }

  const delta = convoyLocationDelta(anchor, current);
  const unchanged =
    Math.abs(delta.northMetres) < LOCATION_CHANGE_THRESHOLD_METRES &&
    Math.abs(delta.eastMetres) < LOCATION_CHANGE_THRESHOLD_METRES;

  if (unchanged) {
    return {};
  }

  if (
    Math.abs(delta.northMetres) > MAX_DELTA_COMPONENT_METRES ||
    Math.abs(delta.eastMetres) > MAX_DELTA_COMPONENT_METRES
  ) {
    // A large jump is more likely to be a GPS correction/teleport than useful
    // delta data. Reset the anchor immediately so receivers self-heal.
    outboundLocationAnchor = {...current};
    outboundLocationAnchorAt = now;
    return {location: {...current}};
  }

  return {locationDelta: delta};
}

function headingDifferenceDegrees(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360;
  return Math.min(difference, 360 - difference);
}

function convoySparseTelemetryFields(
  now: number,
): Pick<
  BushMeshConvoyStatus,
  'speedKph' | 'headingDegrees' | 'batteryPercent'
> {
  const fields: Pick<
    BushMeshConvoyStatus,
    'speedKph' | 'headingDegrees' | 'batteryPercent'
  > = {};
  const motionRefreshMs = telemetry.hazard
    ? HAZARD_MOTION_REFRESH_MS
    : NORMAL_MOTION_REFRESH_MS;
  const motionFresh = isBushMeshConvoyLocationFresh(now);

  if (
    motionFresh &&
    telemetry.speedKph !== undefined &&
    (outboundSpeedKph === undefined ||
      outboundSpeedAt === null ||
      Math.abs(telemetry.speedKph - outboundSpeedKph) >=
        SPEED_CHANGE_THRESHOLD_KPH ||
      now - outboundSpeedAt >= motionRefreshMs)
  ) {
    fields.speedKph = telemetry.speedKph;
    outboundSpeedKph = telemetry.speedKph;
    outboundSpeedAt = now;
  }

  if (
    motionFresh &&
    telemetry.headingDegrees !== undefined &&
    (outboundHeadingDegrees === undefined ||
      outboundHeadingAt === null ||
      headingDifferenceDegrees(
        telemetry.headingDegrees,
        outboundHeadingDegrees,
      ) >= HEADING_CHANGE_THRESHOLD_DEGREES ||
      now - outboundHeadingAt >= motionRefreshMs)
  ) {
    fields.headingDegrees = telemetry.headingDegrees;
    outboundHeadingDegrees = telemetry.headingDegrees;
    outboundHeadingAt = now;
  }

  if (
    telemetry.batteryPercent !== undefined &&
    (outboundBatteryPercent === undefined ||
      outboundBatteryAt === null ||
      telemetry.batteryPercent !== outboundBatteryPercent ||
      now - outboundBatteryAt >= BATTERY_REFRESH_MS)
  ) {
    fields.batteryPercent = telemetry.batteryPercent;
    outboundBatteryPercent = telemetry.batteryPercent;
    outboundBatteryAt = now;
  }

  return fields;
}

export function configureBushMeshConvoy(
  next: Partial<BushMeshConvoyLocalConfig>,
): BushMeshConvoyLocalConfig {
  const merged = {...config, ...next};

  assertWholeNumberInRange(merged.convoyId, 0, 0xffffffff, 'Convoy ID');
  assertWholeNumberInRange(merged.orderIndex, 0, 0xffff, 'Vehicle position');
  assertWholeNumberInRange(merged.role, 0, 7, 'Convoy role');
  if (!Number.isFinite(merged.heartbeatIntervalMs) || merged.heartbeatIntervalMs < 2_000) {
    throw new Error('Convoy heartbeat interval must be at least two seconds.');
  }

  const changedConvoy = merged.convoyId !== config.convoyId;
  config = merged;
  if (changedConvoy) {
    tracker.clear();
    recentCommands = [];
    seenCommandKeys.clear();
    lastReceiveAt = null;
    resetOutboundCompressionState();
  }
  notify();
  return {...config};
}

export function updateBushMeshConvoyTelemetry(
  update: BushMeshConvoyLocalTelemetry,
): BushMeshConvoyLocalTelemetry {
  if (update.location) {
    validateLocation(update.location);
  }
  if (update.locationCapturedAtMs !== undefined && !Number.isFinite(update.locationCapturedAtMs)) {
    throw new Error('Convoy location timestamp must be finite.');
  }
  if (update.speedKph !== undefined) {
    assertFiniteInRange(update.speedKph, 0, 6553.5, 'Convoy speed');
  }
  if (update.headingDegrees !== undefined) {
    if (
      !Number.isFinite(update.headingDegrees) ||
      update.headingDegrees < 0 ||
      update.headingDegrees >= 360
    ) {
      throw new Error('Convoy heading must be from 0 to less than 360 degrees.');
    }
  }
  if (update.batteryPercent !== undefined) {
    assertWholeNumberInRange(
      update.batteryPercent,
      0,
      100,
      'Convoy battery percentage',
    );
  }
  if (update.stopped !== undefined && typeof update.stopped !== 'boolean') {
    throw new Error('Convoy stopped state must be boolean.');
  }
  if (update.hazard !== undefined && typeof update.hazard !== 'boolean') {
    throw new Error('Convoy hazard state must be boolean.');
  }

  const location = update.location
    ? {...update.location}
    : telemetry.location
      ? {...telemetry.location}
      : undefined;
  const locationCapturedAtMs = update.location
    ? update.locationCapturedAtMs ?? Date.now()
    : telemetry.locationCapturedAtMs;

  telemetry = {
    ...telemetry,
    ...update,
    location,
    locationCapturedAtMs,
  };
  notify();
  return bushMeshConvoyTelemetry();
}

export function clearBushMeshConvoyLocalLocation(): void {
  telemetry = {
    ...telemetry,
    location: undefined,
    locationCapturedAtMs: undefined,
    speedKph: undefined,
    headingDegrees: undefined,
  };
  outboundLocationAnchor = null;
  outboundLocationAnchorAt = null;
  outboundSpeedKph = undefined;
  outboundSpeedAt = null;
  outboundHeadingDegrees = undefined;
  outboundHeadingAt = null;
  notify();
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
  assertWholeNumberInRange(nodeId, 0, 0xffffffff, 'Convoy node ID');

  const locationFields = convoyLocationFields(now);
  const sparseTelemetryFields = convoySparseTelemetryFields(now);
  const status: BushMeshConvoyStatus = {
    convoyId: config.convoyId,
    nodeId,
    sequence,
    orderIndex: config.orderIndex,
    role: config.role,
    ...locationFields,
    ...sparseTelemetryFields,
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

export function nextBushMeshConvoyCommand(
  originNodeId: number,
  action: BushMeshConvoyAction | number,
  options?: {targetOrderIndex?: number; etaMinutes?: number; now?: number},
): BushMeshConvoyActionControl {
  assertWholeNumberInRange(originNodeId, 0, 0xffffffff, 'Convoy command origin');
  assertWholeNumberInRange(action, 1, 255, 'Convoy action');
  if (options?.targetOrderIndex !== undefined) {
    assertWholeNumberInRange(
      options.targetOrderIndex,
      0,
      0xffff,
      'Convoy target position',
    );
  }
  if (options?.etaMinutes !== undefined) {
    assertWholeNumberInRange(options.etaMinutes, 0, 0xffff, 'Convoy action ETA');
  }

  const command: BushMeshConvoyActionControl = {
    command: BushMeshControlCommand.ConvoyAction,
    convoyId: config.convoyId,
    originNodeId,
    sequence: commandSequence,
    action,
    targetOrderIndex: options?.targetOrderIndex,
    etaMinutes: options?.etaMinutes,
  };

  commandSequence = (commandSequence + 1) >>> 0;
  if (commandSequence === 0) {
    commandSequence = 1;
  }

  rememberCommand(command, options?.now ?? Date.now(), true);
  return command;
}

export function convoyCommandAppliesToLocalPosition(
  command: BushMeshConvoyActionControl,
): boolean {
  return (
    command.convoyId === config.convoyId &&
    (command.targetOrderIndex === undefined ||
      command.targetOrderIndex === config.orderIndex)
  );
}

export function acceptBushMeshConvoyCommandRemote(
  command: BushMeshConvoyActionControl,
  receivedAt = Date.now(),
): boolean {
  if (
    command.command !== BushMeshControlCommand.ConvoyAction ||
    command.convoyId !== config.convoyId
  ) {
    return false;
  }

  return rememberCommand(command, receivedAt, false);
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
    recentCommands: recentCommands.map(entry => ({
      ...entry,
      command: {...entry.command},
    })),
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
  recentCommands = [];
  seenCommandKeys.clear();
  lastReceiveAt = null;
  notify();
}
