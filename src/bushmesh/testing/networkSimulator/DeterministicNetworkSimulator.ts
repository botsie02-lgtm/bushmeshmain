import {BushMeshDatagramRuntime} from '../../runtime/public';
import type {
  BushMeshInboundResult,
  BushMeshOutboundDatagram,
  BushMeshOutboundPreparationOptions,
  BushMeshRuntimeClock,
  BushMeshRuntimePersistence,
  BushMeshSecurityAdapter,
  BushMeshSecurityAssociation,
  BushMeshSecurityProtectionRequest,
  BushMeshSecurityProtectionResult,
  BushMeshSecurityUnprotectionRequest,
  BushMeshSecurityUnprotectionResult,
  BushMeshTransportAvailability,
  BushMeshTransportAvailabilityPort,
} from '../../runtime/public';
import {createBushMeshSecurityProtocolContext} from '../../protocol/public';

export type SimulatorNodeId = number;

export type DeterministicNetworkLinkConfig = {
  enabled?: boolean;
  lossRate?: number;
  duplicationRate?: number;
  baseDelayMs?: number;
  jitterMs?: number;
  reorderChance?: number;
  reorderExtraDelayMs?: number;
  bitrateBps?: number;
  airtimeOverheadMs?: number;
  dutyCycle?: number;
  maxPayloadBytes?: number;
  maxQueueBytes?: number;
  rssiDbm?: number;
  snrDb?: number;
  retryDelayMs?: number;
};

export type DeterministicNetworkNodeConfig = {
  id: SimulatorNodeId;
  name?: string;
  transport?: string;
  maxPayloadBytes?: number;
  peerStaleAfterMs?: number;
  gpsStaleAfterMs?: number;
  useFakeSecurity?: boolean;
};

export type SimulatorTransmitOptions = {
  storeIfUnavailable?: boolean;
  convergenceKey?: string;
};

export type SimulatorTraceEvent = {
  atMs: number;
  kind:
    | 'node-added'
    | 'node-presence'
    | 'carrier'
    | 'gps'
    | 'link'
    | 'partition'
    | 'partition-healed'
    | 'queued'
    | 'deferred'
    | 'tx-start'
    | 'tx-complete'
    | 'dropped'
    | 'retry'
    | 'delivered'
    | 'duplicate'
    | 'runtime-rejected'
    | 'runtime-duplicate'
    | 'peer-stale'
    | 'gps-stale'
    | 'restart'
    | 'topology-path';
  from?: SimulatorNodeId;
  to?: SimulatorNodeId;
  packetId?: number;
  messageId?: number;
  detail?: string;
};

export type DeterministicNetworkMetrics = {
  attemptedDatagrams: number;
  transmissionAttempts: number;
  deliveredDatagrams: number;
  failedDatagrams: number;
  runtimeRejected: number;
  runtimeDuplicates: number;
  duplicateCopiesInjected: number;
  transportRetries: number;
  totalTransmittedBytes: number;
  estimatedAirtimeMs: number;
  latencySamplesMs: number[];
  emergencyLatencySamplesMs: number[];
  routeChanges: number;
  routeConvergenceSamplesMs: number[];
  storeAndForwardRecoveries: number;
  stalePeerExpiries: number;
  staleLocationExpiries: number;
  gpsDisappearances: number;
  carrierDisconnects: number;
  carrierReconnects: number;
  linkQualityChanges: number;
  maxQueueDepth: number;
  maxQueueBytes: number;
  currentQueueDepth: number;
  currentQueueBytes: number;
  droppedExpired: number;
  droppedLoss: number;
  droppedUnavailable: number;
  droppedOversize: number;
  droppedCongestion: number;
  convergenceDeliveries: Record<string, number>;
};

export type SimulatorFailureReport = {
  seed: number;
  reason: string;
  simulatedAtMs: number;
  nodeConfiguration: DeterministicNetworkNodeConfig[];
  timeline: SimulatorTraceEvent[];
  importantTrace: SimulatorTraceEvent[];
  metrics: DeterministicNetworkMetrics;
};

type ScheduledEvent = {
  id: number;
  atMs: number;
  action: () => Promise<void> | void;
};

type QueuedTransmission = {
  packetId: number;
  from: SimulatorNodeId;
  to: SimulatorNodeId;
  datagram: BushMeshOutboundDatagram;
  attempt: number;
  enqueuedAtMs: number;
  storeIfUnavailable: boolean;
  convergenceKey?: string;
  recoveredFromDeferred: boolean;
};

type LinkState = {
  config: Required<DeterministicNetworkLinkConfig>;
  queue: QueuedTransmission[];
  queueBytes: number;
  busy: boolean;
};

type GpsState = {
  available: boolean;
  lastFixAtMs: number | null;
  staleReported: boolean;
};

const DEFAULT_LINK: Required<DeterministicNetworkLinkConfig> = {
  enabled: true,
  lossRate: 0,
  duplicationRate: 0,
  baseDelayMs: 20,
  jitterMs: 0,
  reorderChance: 0,
  reorderExtraDelayMs: 0,
  bitrateBps: 5_000,
  airtimeOverheadMs: 0,
  dutyCycle: 1,
  maxPayloadBytes: 255,
  maxQueueBytes: 64 * 1024,
  rssiDbm: -85,
  snrDb: 7,
  retryDelayMs: 250,
};

const PRIORITY_RANK: Record<BushMeshOutboundDatagram['priority'], number> = {
  safety: 0,
  control: 1,
  message: 2,
  position: 3,
  bulk: 4,
};

function probability(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite probability from 0 to 1.`);
  }
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be finite and greater than zero.`);
  }
  return value;
}

function asciiBytes(value: string): number[] {
  return Array.from(value).map(character => character.charCodeAt(0) & 0x7f);
}

function asciiString(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(value => String.fromCharCode(value))
    .join('');
}

function encodeAssociation(
  association: Exclude<BushMeshSecurityAssociation, {kind: 'none'}>,
): number[] {
  let kind: number;
  let id: string;
  if (association.kind === 'direct-session') {
    kind = 1;
    id = association.sessionId;
  } else if (association.kind === 'group') {
    kind = 2;
    id = association.groupId;
  } else {
    kind = 3;
    id = association.deviceId;
  }
  const bytes = asciiBytes(id);
  if (bytes.length > 255) {
    throw new Error('Fake Security association id is too long.');
  }
  return [kind, bytes.length, ...bytes];
}

function decodeAssociation(bytes: Uint8Array): {
  association: BushMeshSecurityAssociation;
  offset: number;
} {
  const kind = bytes[3];
  const length = bytes[4];
  if (kind === undefined || length === undefined || bytes.length < 5 + length) {
    throw new Error('Malformed fake Security envelope.');
  }
  const id = asciiString(bytes.slice(5, 5 + length));
  if (kind === 1) {
    return {
      association: {kind: 'direct-session', sessionId: id},
      offset: 5 + length,
    };
  }
  if (kind === 2) {
    return {association: {kind: 'group', groupId: id}, offset: 5 + length};
  }
  if (kind === 3) {
    return {association: {kind: 'identity', deviceId: id}, offset: 5 + length};
  }
  throw new Error('Unknown fake Security association kind.');
}

/**
 * Test-only implementation of the frozen runtime Security seam. It intentionally
 * performs no cryptography; its job is to exercise the adapter boundary and
 * canonical protocol AAD without importing Security v1 internals.
 */
export class FakeBushMeshSecurityAdapter implements BushMeshSecurityAdapter {
  async protect(
    request: BushMeshSecurityProtectionRequest,
  ): Promise<BushMeshSecurityProtectionResult> {
    return {
      datagramPayload: Uint8Array.from([
        0xfa,
        0xce,
        0x01,
        ...encodeAssociation(request.association),
        ...Array.from(request.plaintextWireBytes),
      ]),
      protectedPayload: {
        fake: true,
        association: request.association.kind,
        trafficClass: request.trafficClass,
      },
      securityVersion: 1,
    };
  }

  async unprotect(
    request: BushMeshSecurityUnprotectionRequest,
  ): Promise<BushMeshSecurityUnprotectionResult> {
    const bytes = request.datagramPayload;
    if (bytes[0] !== 0xfa || bytes[1] !== 0xce || bytes[2] !== 0x01) {
      throw new Error('Fake Security protected payload marker missing.');
    }
    const decoded = decodeAssociation(bytes);
    const plaintextWireBytes = bytes.slice(decoded.offset);
    const context = createBushMeshSecurityProtocolContext(
      Array.from(plaintextWireBytes),
    );
    return {
      plaintextWireBytes,
      authenticatedHeader: Uint8Array.from(context.authenticatedHeader),
      protectedPayload: {fake: true},
      association: decoded.association,
      securityVersion: 1,
    };
  }
}

export class DeterministicRandom {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) {
      throw new Error('Simulator seed must be an integer.');
    }
    this.state = (seed >>> 0) || 0x6d2b79f5;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x1_0000_0000;
  }

  between(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  chance(chance: number): boolean {
    return this.next() < chance;
  }
}

export class VirtualBushMeshClock implements BushMeshRuntimeClock {
  private currentMs: number;
  private nextTimerId = 1;
  private readonly timers = new Map<number, {atMs: number; handler: () => void}>();

  constructor(initialMs = 0) {
    if (!Number.isFinite(initialMs) || initialMs < 0) {
      throw new Error('Virtual clock initial time must be finite and non-negative.');
    }
    this.currentMs = initialMs;
  }

  now(): number {
    return this.currentMs;
  }

  setTimeout(handler: () => void, delayMs: number): number {
    const id = this.nextTimerId++;
    this.timers.set(id, {
      atMs: this.currentMs + Math.max(0, delayMs),
      handler,
    });
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') {
      this.timers.delete(handle);
    }
  }

  advanceTo(targetMs: number): void {
    if (!Number.isFinite(targetMs) || targetMs < this.currentMs) {
      throw new Error('Virtual clock cannot move backwards.');
    }
    while (true) {
      const next = Array.from(this.timers.entries())
        .filter(([, timer]) => timer.atMs <= targetMs)
        .sort((a, b) => a[1].atMs - b[1].atMs || a[0] - b[0])[0];
      if (!next) {
        break;
      }
      const [id, timer] = next;
      this.timers.delete(id);
      this.currentMs = timer.atMs;
      timer.handler();
    }
    this.currentMs = targetMs;
  }
}

export class InMemoryBushMeshRuntimePersistence
  implements BushMeshRuntimePersistence {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

export class MutableTransportAvailabilityPort
  implements BushMeshTransportAvailabilityPort {
  private readonly listeners = new Set<
    (value: BushMeshTransportAvailability) => void
  >();
  private value: BushMeshTransportAvailability;

  constructor(transport: string, maxPayloadBytes: number) {
    this.value = {transport, available: true, maxPayloadBytes};
  }

  getAvailability(): BushMeshTransportAvailability {
    return {...this.value};
  }

  setAvailable(available: boolean, reason?: string): void {
    this.value = {
      ...this.value,
      available,
      reason: available ? undefined : reason ?? 'simulated-disconnect',
    };
    this.listeners.forEach(listener => listener(this.getAvailability()));
  }

  subscribe(
    listener: (value: BushMeshTransportAvailability) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class VirtualBushMeshNode {
  readonly config: DeterministicNetworkNodeConfig;
  readonly persistence: InMemoryBushMeshRuntimePersistence;
  readonly availability: MutableTransportAvailabilityPort;
  readonly security?: BushMeshSecurityAdapter;
  readonly gps: GpsState = {
    available: false,
    lastFixAtMs: null,
    staleReported: false,
  };
  present = true;
  lastInboundResult: BushMeshInboundResult | null = null;
  private runtime: BushMeshDatagramRuntime;
  private readonly clock: VirtualBushMeshClock;

  constructor(
    config: DeterministicNetworkNodeConfig,
    clock: VirtualBushMeshClock,
    persistence = new InMemoryBushMeshRuntimePersistence(),
  ) {
    this.config = {
      ...config,
      name: config.name ?? `node-${config.id}`,
      transport: config.transport ?? 'sim-radio',
      maxPayloadBytes: config.maxPayloadBytes ?? 255,
      peerStaleAfterMs: config.peerStaleAfterMs ?? 60_000,
      gpsStaleAfterMs: config.gpsStaleAfterMs ?? 30_000,
      useFakeSecurity: config.useFakeSecurity ?? true,
    };
    this.clock = clock;
    this.persistence = persistence;
    this.availability = new MutableTransportAvailabilityPort(
      this.config.transport!,
      this.config.maxPayloadBytes!,
    );
    this.security = this.config.useFakeSecurity
      ? new FakeBushMeshSecurityAdapter()
      : undefined;
    this.runtime = this.createRuntime();
  }

  private createRuntime(): BushMeshDatagramRuntime {
    return new BushMeshDatagramRuntime({
      clock: this.clock,
      persistence: this.persistence,
      security: this.security,
      transportAvailability: this.availability,
    });
  }

  async initialize(): Promise<number> {
    return this.runtime.initialize();
  }

  async prepareOutbound(
    wireBytes: number[] | Uint8Array,
    options: Partial<BushMeshOutboundPreparationOptions> = {},
  ): Promise<BushMeshOutboundDatagram> {
    return this.runtime.prepareOutbound(wireBytes, {
      channelIndex: options.channelIndex ?? 0,
      dataType: options.dataType ?? 0x42,
      transport: options.transport ?? this.config.transport!,
      expiresAtMs: options.expiresAtMs,
      retryIntent: options.retryIntent,
      identityAssociation: options.identityAssociation,
      trafficClass: options.trafficClass,
      label: options.label,
    });
  }

  async acceptInbound(
    datagram: Parameters<BushMeshDatagramRuntime['acceptInbound']>[0],
  ): Promise<BushMeshInboundResult> {
    this.lastInboundResult = await this.runtime.acceptInbound(datagram);
    return this.lastInboundResult;
  }

  async restart(): Promise<number> {
    await this.runtime.flush();
    this.runtime = this.createRuntime();
    return this.runtime.initialize();
  }

  async flush(): Promise<void> {
    await this.runtime.flush();
  }

  transportAvailable(): boolean {
    return this.availability.getAvailability().available;
  }
}

function newMetrics(): DeterministicNetworkMetrics {
  return {
    attemptedDatagrams: 0,
    transmissionAttempts: 0,
    deliveredDatagrams: 0,
    failedDatagrams: 0,
    runtimeRejected: 0,
    runtimeDuplicates: 0,
    duplicateCopiesInjected: 0,
    transportRetries: 0,
    totalTransmittedBytes: 0,
    estimatedAirtimeMs: 0,
    latencySamplesMs: [],
    emergencyLatencySamplesMs: [],
    routeChanges: 0,
    routeConvergenceSamplesMs: [],
    storeAndForwardRecoveries: 0,
    stalePeerExpiries: 0,
    staleLocationExpiries: 0,
    gpsDisappearances: 0,
    carrierDisconnects: 0,
    carrierReconnects: 0,
    linkQualityChanges: 0,
    maxQueueDepth: 0,
    maxQueueBytes: 0,
    currentQueueDepth: 0,
    currentQueueBytes: 0,
    droppedExpired: 0,
    droppedLoss: 0,
    droppedUnavailable: 0,
    droppedOversize: 0,
    droppedCongestion: 0,
    convergenceDeliveries: {},
  };
}

export class DeterministicBushMeshNetworkSimulator {
  readonly seed: number;
  readonly clock: VirtualBushMeshClock;
  readonly random: DeterministicRandom;
  readonly metrics: DeterministicNetworkMetrics = newMetrics();
  readonly trace: SimulatorTraceEvent[] = [];
  readonly timeline: SimulatorTraceEvent[] = [];

  private readonly nodes = new Map<SimulatorNodeId, VirtualBushMeshNode>();
  private readonly links = new Map<string, LinkState>();
  private readonly deferred: QueuedTransmission[] = [];
  private readonly blockedPairs = new Set<string>();
  private readonly scheduled: ScheduledEvent[] = [];
  private readonly peerLastSeen = new Map<string, number>();
  private readonly stalePeerReported = new Set<string>();
  private readonly observedPaths = new Map<string, string>();
  private readonly topologyChangedAt = new Map<string, number>();
  private nextPacketId = 1;
  private nextEventId = 1;

  constructor(seed: number, initialTimeMs = 0) {
    this.seed = seed;
    this.clock = new VirtualBushMeshClock(initialTimeMs);
    this.random = new DeterministicRandom(seed);
  }

  private pair(from: SimulatorNodeId, to: SimulatorNodeId): string {
    return `${from}>${to}`;
  }

  private peerKey(receiver: SimulatorNodeId, source: SimulatorNodeId): string {
    return `${receiver}<${source}`;
  }

  private record(
    event: Omit<SimulatorTraceEvent, 'atMs'>,
    timeline = false,
  ): void {
    const full: SimulatorTraceEvent = {atMs: this.clock.now(), ...event};
    this.trace.push(full);
    if (timeline) {
      this.timeline.push(full);
    }
  }

  async addNode(
    config: DeterministicNetworkNodeConfig,
  ): Promise<VirtualBushMeshNode> {
    if (this.nodes.has(config.id)) {
      throw new Error(`Simulator node ${config.id} already exists.`);
    }
    const node = new VirtualBushMeshNode(config, this.clock);
    await node.initialize();
    this.nodes.set(config.id, node);
    this.record(
      {kind: 'node-added', to: config.id, detail: node.config.name},
      true,
    );
    return node;
  }

  node(id: SimulatorNodeId): VirtualBushMeshNode {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Unknown simulator node ${id}.`);
    }
    return node;
  }

  private normalizeLinkConfig(
    patch: DeterministicNetworkLinkConfig,
    current: Required<DeterministicNetworkLinkConfig> = DEFAULT_LINK,
  ): Required<DeterministicNetworkLinkConfig> {
    const next = {...current, ...patch};
    next.lossRate = probability(next.lossRate, 'lossRate');
    next.duplicationRate = probability(next.duplicationRate, 'duplicationRate');
    next.reorderChance = probability(next.reorderChance, 'reorderChance');
    next.dutyCycle = positive(next.dutyCycle, 'dutyCycle');
    if (next.dutyCycle > 1) {
      throw new Error('dutyCycle must not exceed 1.');
    }
    next.bitrateBps = positive(next.bitrateBps, 'bitrateBps');
    next.maxPayloadBytes = positive(next.maxPayloadBytes, 'maxPayloadBytes');
    next.maxQueueBytes = positive(next.maxQueueBytes, 'maxQueueBytes');
    return next;
  }

  setLink(
    from: SimulatorNodeId,
    to: SimulatorNodeId,
    patch: DeterministicNetworkLinkConfig,
  ): void {
    this.node(from);
    this.node(to);
    const key = this.pair(from, to);
    const existing = this.links.get(key);
    const previous = existing?.config ?? DEFAULT_LINK;
    const config = this.normalizeLinkConfig(patch, previous);
    if (
      existing &&
      (previous.rssiDbm !== config.rssiDbm || previous.snrDb !== config.snrDb)
    ) {
      this.metrics.linkQualityChanges += 1;
    }
    this.links.set(key, {
      config,
      queue: existing?.queue ?? [],
      queueBytes: existing?.queueBytes ?? 0,
      busy: existing?.busy ?? false,
    });
    this.record(
      {
        kind: 'link',
        from,
        to,
        detail: `enabled=${config.enabled} loss=${config.lossRate} rssi=${config.rssiDbm} snr=${config.snrDb}`,
      },
      true,
    );
    this.markTopologyChanged();
    this.flushDeferred();
    this.resumeAllLinks();
  }

  setBidirectionalLink(
    a: SimulatorNodeId,
    b: SimulatorNodeId,
    patch: DeterministicNetworkLinkConfig,
  ): void {
    this.setLink(a, b, patch);
    this.setLink(b, a, patch);
  }

  partition(groups: SimulatorNodeId[][]): void {
    this.blockedPairs.clear();
    for (let left = 0; left < groups.length; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        for (const a of groups[left]) {
          for (const b of groups[right]) {
            this.blockedPairs.add(this.pair(a, b));
            this.blockedPairs.add(this.pair(b, a));
          }
        }
      }
    }
    this.record({kind: 'partition', detail: JSON.stringify(groups)}, true);
    this.markTopologyChanged();
  }

  healPartition(): void {
    this.blockedPairs.clear();
    this.record({kind: 'partition-healed'}, true);
    this.markTopologyChanged();
    this.flushDeferred();
    this.resumeAllLinks();
  }

  setNodePresent(id: SimulatorNodeId, present: boolean): void {
    const node = this.node(id);
    node.present = present;
    this.record(
      {kind: 'node-presence', to: id, detail: present ? 'present' : 'missing'},
      true,
    );
    this.markTopologyChanged();
    if (present) {
      this.flushDeferred();
      this.resumeAllLinks();
    }
  }

  setCarrierAvailable(id: SimulatorNodeId, available: boolean): void {
    const node = this.node(id);
    const previous = node.transportAvailable();
    node.availability.setAvailable(available);
    if (previous !== available) {
      if (available) {
        this.metrics.carrierReconnects += 1;
      } else {
        this.metrics.carrierDisconnects += 1;
      }
    }
    this.record(
      {kind: 'carrier', to: id, detail: available ? 'connected' : 'disconnected'},
      true,
    );
    if (available) {
      this.flushDeferred();
      this.resumeAllLinks();
    }
  }

  setGpsFix(id: SimulatorNodeId): void {
    const node = this.node(id);
    node.gps.available = true;
    node.gps.lastFixAtMs = this.clock.now();
    node.gps.staleReported = false;
    this.record({kind: 'gps', to: id, detail: 'fix'}, true);
  }

  clearGps(id: SimulatorNodeId): void {
    const node = this.node(id);
    if (node.gps.available) {
      this.metrics.gpsDisappearances += 1;
    }
    node.gps.available = false;
    this.record({kind: 'gps', to: id, detail: 'unavailable'}, true);
  }

  async restartNode(id: SimulatorNodeId): Promise<number> {
    const restored = await this.node(id).restart();
    this.record(
      {kind: 'restart', to: id, detail: `restoredDedup=${restored}`},
      true,
    );
    return restored;
  }

  private configuredLink(
    from: SimulatorNodeId,
    to: SimulatorNodeId,
  ): LinkState | undefined {
    return this.links.get(this.pair(from, to));
  }

  private requireLink(from: SimulatorNodeId, to: SimulatorNodeId): LinkState {
    const link = this.configuredLink(from, to);
    if (!link) {
      throw new Error(`No virtual radio link configured for ${from}>${to}.`);
    }
    return link;
  }

  private isAvailable(from: SimulatorNodeId, to: SimulatorNodeId): boolean {
    const source = this.node(from);
    const destination = this.node(to);
    const link = this.configuredLink(from, to);
    return Boolean(
      link &&
        source.present &&
        destination.present &&
        source.transportAvailable() &&
        destination.transportAvailable() &&
        link.config.enabled &&
        !this.blockedPairs.has(this.pair(from, to)),
    );
  }

  private schedule(atMs: number, action: ScheduledEvent['action']): void {
    this.scheduled.push({id: this.nextEventId++, atMs, action});
  }

  private updateQueueMetrics(): void {
    let depth = this.deferred.length;
    let bytes = this.deferred.reduce(
      (sum, item) => sum + item.datagram.payload.length,
      0,
    );
    for (const link of this.links.values()) {
      depth += link.queue.length;
      bytes += link.queueBytes;
    }
    this.metrics.currentQueueDepth = depth;
    this.metrics.currentQueueBytes = bytes;
    this.metrics.maxQueueDepth = Math.max(this.metrics.maxQueueDepth, depth);
    this.metrics.maxQueueBytes = Math.max(this.metrics.maxQueueBytes, bytes);
  }

  async transmit(
    from: SimulatorNodeId,
    to: SimulatorNodeId,
    datagram: BushMeshOutboundDatagram,
    options: SimulatorTransmitOptions = {},
  ): Promise<number> {
    this.node(from);
    this.node(to);
    const packetId = this.nextPacketId++;
    this.metrics.attemptedDatagrams += 1;
    const item: QueuedTransmission = {
      packetId,
      from,
      to,
      datagram,
      attempt: 1,
      enqueuedAtMs: this.clock.now(),
      storeIfUnavailable: options.storeIfUnavailable ?? false,
      convergenceKey: options.convergenceKey,
      recoveredFromDeferred: false,
    };
    this.enqueueOrDefer(item);
    return packetId;
  }

  private enqueueOrDefer(item: QueuedTransmission): void {
    if (
      item.datagram.expiresAtMs !== null &&
      item.datagram.expiresAtMs <= this.clock.now()
    ) {
      this.metrics.failedDatagrams += 1;
      this.metrics.droppedExpired += 1;
      this.recordDrop(item, 'expired-before-queue');
      return;
    }

    const link = this.configuredLink(item.from, item.to);
    if (!link || !this.isAvailable(item.from, item.to)) {
      if (item.storeIfUnavailable) {
        if (!this.deferred.some(existing => existing.packetId === item.packetId)) {
          this.deferred.push(item);
        }
        this.record({
          kind: 'deferred',
          from: item.from,
          to: item.to,
          packetId: item.packetId,
          messageId: item.datagram.diagnostics.messageId,
          detail: link ? 'transport-unavailable' : 'link-unconfigured',
        });
        this.updateQueueMetrics();
        return;
      }
      this.metrics.failedDatagrams += 1;
      this.metrics.droppedUnavailable += 1;
      this.recordDrop(item, link ? 'transport-unavailable' : 'link-unconfigured');
      return;
    }

    const maxPayload = Math.min(
      link.config.maxPayloadBytes,
      this.node(item.from).config.maxPayloadBytes!,
    );
    if (item.datagram.payload.length > maxPayload) {
      this.metrics.failedDatagrams += 1;
      this.metrics.droppedOversize += 1;
      this.recordDrop(
        item,
        `oversize:${item.datagram.payload.length}>${maxPayload}`,
      );
      return;
    }
    if (link.queueBytes + item.datagram.payload.length > link.config.maxQueueBytes) {
      this.metrics.failedDatagrams += 1;
      this.metrics.droppedCongestion += 1;
      this.recordDrop(item, 'congestion-queue-full');
      return;
    }

    link.queue.push(item);
    link.queueBytes += item.datagram.payload.length;
    link.queue.sort((left, right) => {
      const priority =
        PRIORITY_RANK[left.datagram.priority] -
        PRIORITY_RANK[right.datagram.priority];
      return (
        priority ||
        left.enqueuedAtMs - right.enqueuedAtMs ||
        left.packetId - right.packetId
      );
    });
    this.record({
      kind: 'queued',
      from: item.from,
      to: item.to,
      packetId: item.packetId,
      messageId: item.datagram.diagnostics.messageId,
      detail: item.datagram.priority,
    });
    this.updateQueueMetrics();
    this.pumpLink(item.from, item.to);
  }

  private pumpLink(from: SimulatorNodeId, to: SimulatorNodeId): void {
    const link = this.requireLink(from, to);
    if (link.busy || link.queue.length === 0) {
      return;
    }

    const item = link.queue.shift()!;
    link.queueBytes -= item.datagram.payload.length;
    this.updateQueueMetrics();

    if (!this.isAvailable(from, to)) {
      this.enqueueOrDefer(item);
      // Do not leave later work stranded behind a packet that became unavailable.
      this.pumpLink(from, to);
      return;
    }
    if (
      item.datagram.expiresAtMs !== null &&
      item.datagram.expiresAtMs <= this.clock.now()
    ) {
      this.metrics.failedDatagrams += 1;
      this.metrics.droppedExpired += 1;
      this.recordDrop(item, 'expired-in-queue');
      this.pumpLink(from, to);
      return;
    }

    link.busy = true;
    this.metrics.transmissionAttempts += 1;
    this.metrics.totalTransmittedBytes += item.datagram.payload.length;
    const airtimeMs =
      (item.datagram.payload.length * 8 * 1000) / link.config.bitrateBps +
      link.config.airtimeOverheadMs;
    this.metrics.estimatedAirtimeMs += airtimeMs;
    this.record({
      kind: 'tx-start',
      from,
      to,
      packetId: item.packetId,
      messageId: item.datagram.diagnostics.messageId,
      detail: `attempt=${item.attempt} airtimeMs=${airtimeMs.toFixed(3)}`,
    });

    const occupiedMs = airtimeMs / link.config.dutyCycle;
    this.schedule(this.clock.now() + occupiedMs, async () => {
      link.busy = false;
      this.record({
        kind: 'tx-complete',
        from,
        to,
        packetId: item.packetId,
        messageId: item.datagram.diagnostics.messageId,
      });
      await this.completeTransmission(item, link);
      this.pumpLink(from, to);
    });
  }

  private resumeAllLinks(): void {
    for (const key of this.links.keys()) {
      const [from, to] = key.split('>').map(Number);
      const link = this.requireLink(from, to);
      if (!link.busy && link.queue.length > 0) {
        this.pumpLink(from, to);
      }
    }
  }

  private async completeTransmission(
    item: QueuedTransmission,
    link: LinkState,
  ): Promise<void> {
    if (!this.isAvailable(item.from, item.to)) {
      this.enqueueOrDefer(item);
      return;
    }
    if (this.random.chance(link.config.lossRate)) {
      this.metrics.droppedLoss += 1;
      const retryIntent = item.datagram.retryIntent;
      if (
        retryIntent.mode === 'transport-retry' &&
        item.attempt < retryIntent.maxTransportAttempts
      ) {
        this.metrics.transportRetries += 1;
        const retry: QueuedTransmission = {
          ...item,
          attempt: item.attempt + 1,
        };
        this.record({
          kind: 'retry',
          from: item.from,
          to: item.to,
          packetId: item.packetId,
          messageId: item.datagram.diagnostics.messageId,
          detail: `attempt=${retry.attempt}`,
        });
        this.schedule(
          this.clock.now() + link.config.retryDelayMs,
          () => this.enqueueOrDefer(retry),
        );
      } else {
        this.metrics.failedDatagrams += 1;
        this.recordDrop(item, 'random-loss');
      }
      return;
    }

    let delayMs = link.config.baseDelayMs;
    if (link.config.jitterMs > 0) {
      delayMs += this.random.between(
        -link.config.jitterMs,
        link.config.jitterMs,
      );
    }
    if (this.random.chance(link.config.reorderChance)) {
      delayMs += this.random.between(0, link.config.reorderExtraDelayMs);
    }
    delayMs = Math.max(0, delayMs);
    this.schedule(
      this.clock.now() + delayMs,
      () => this.deliver(item, link, false),
    );

    if (this.random.chance(link.config.duplicationRate)) {
      this.metrics.duplicateCopiesInjected += 1;
      const duplicateDelayMs =
        delayMs +
        Math.max(
          1,
          this.random.between(1, link.config.reorderExtraDelayMs + 20),
        );
      this.schedule(
        this.clock.now() + duplicateDelayMs,
        () => this.deliver(item, link, true),
      );
    }
  }

  private async deliver(
    item: QueuedTransmission,
    link: LinkState,
    duplicate: boolean,
  ): Promise<void> {
    if (!this.isAvailable(item.from, item.to)) {
      if (!duplicate) {
        this.enqueueOrDefer(item);
      }
      return;
    }
    if (
      item.datagram.expiresAtMs !== null &&
      item.datagram.expiresAtMs <= this.clock.now()
    ) {
      if (!duplicate) {
        this.metrics.failedDatagrams += 1;
        this.metrics.droppedExpired += 1;
        this.recordDrop(item, 'expired-before-delivery');
      }
      return;
    }

    const destination = this.node(item.to);
    const result = await destination.acceptInbound({
      channelIndex: item.datagram.channelIndex,
      dataType: item.datagram.dataType,
      payload: Uint8Array.from(item.datagram.payload),
      receivedAtMs: this.clock.now(),
      transport: item.datagram.transport,
      source: 'live',
      sourceNodeId: item.from,
      link: {
        rssiDbm: link.config.rssiDbm,
        snrDb: link.config.snrDb,
        pathLength: 1,
      },
      diagnosticLabel: item.datagram.diagnostics.label,
      securityProtected: item.datagram.diagnostics.protected,
    });

    const peerKey = this.peerKey(item.to, item.from);
    this.peerLastSeen.set(peerKey, this.clock.now());
    this.stalePeerReported.delete(peerKey);

    if (result.status === 'duplicate') {
      this.metrics.runtimeDuplicates += 1;
      this.record({
        kind: 'runtime-duplicate',
        from: item.from,
        to: item.to,
        packetId: item.packetId,
        messageId: item.datagram.diagnostics.messageId,
        detail: duplicate ? 'injected-copy' : 'replay',
      });
      return;
    }
    if (result.status === 'rejected') {
      this.metrics.runtimeRejected += 1;
      if (!duplicate) {
        this.metrics.failedDatagrams += 1;
      }
      this.record({
        kind: 'runtime-rejected',
        from: item.from,
        to: item.to,
        packetId: item.packetId,
        messageId: item.datagram.diagnostics.messageId,
        detail: `${result.reason}:${result.error}`,
      });
      return;
    }
    if (duplicate) {
      this.record({
        kind: 'duplicate',
        from: item.from,
        to: item.to,
        packetId: item.packetId,
        messageId: item.datagram.diagnostics.messageId,
      });
      return;
    }

    this.metrics.deliveredDatagrams += 1;
    const latencyMs = this.clock.now() - item.datagram.createdAtMs;
    this.metrics.latencySamplesMs.push(latencyMs);
    if (item.datagram.priority === 'safety') {
      this.metrics.emergencyLatencySamplesMs.push(latencyMs);
    }
    if (item.recoveredFromDeferred) {
      this.metrics.storeAndForwardRecoveries += 1;
    }
    if (item.convergenceKey) {
      this.metrics.convergenceDeliveries[item.convergenceKey] =
        (this.metrics.convergenceDeliveries[item.convergenceKey] ?? 0) + 1;
    }
    this.record({
      kind: 'delivered',
      from: item.from,
      to: item.to,
      packetId: item.packetId,
      messageId: item.datagram.diagnostics.messageId,
      detail: `latencyMs=${latencyMs}`,
    });
  }

  private recordDrop(item: QueuedTransmission, detail: string): void {
    this.record({
      kind: 'dropped',
      from: item.from,
      to: item.to,
      packetId: item.packetId,
      messageId: item.datagram.diagnostics.messageId,
      detail,
    });
  }

  private flushDeferred(): void {
    if (this.deferred.length === 0) {
      return;
    }
    const retained: QueuedTransmission[] = [];
    for (const item of this.deferred.splice(0)) {
      if (this.isAvailable(item.from, item.to)) {
        this.enqueueOrDefer({...item, recoveredFromDeferred: true});
      } else {
        retained.push(item);
      }
    }
    this.deferred.push(...retained);
    this.updateQueueMetrics();
  }

  private markTopologyChanged(): void {
    for (const key of this.observedPaths.keys()) {
      this.topologyChangedAt.set(key, this.clock.now());
    }
  }

  observePhysicalPath(
    from: SimulatorNodeId,
    to: SimulatorNodeId,
  ): SimulatorNodeId[] | null {
    this.node(from);
    this.node(to);
    const queue: SimulatorNodeId[][] = [[from]];
    const visited = new Set<SimulatorNodeId>([from]);
    let found: SimulatorNodeId[] | null = null;

    while (queue.length > 0 && !found) {
      const path = queue.shift()!;
      const tail = path[path.length - 1];
      if (tail === to) {
        found = path;
        break;
      }
      for (const candidate of this.nodes.keys()) {
        if (visited.has(candidate)) {
          continue;
        }
        // Only explicitly configured directed links participate in topology.
        if (!this.configuredLink(tail, candidate)) {
          continue;
        }
        if (!this.isAvailable(tail, candidate)) {
          continue;
        }
        visited.add(candidate);
        queue.push([...path, candidate]);
      }
    }

    const key = this.pair(from, to);
    const encoded = found ? found.join('>') : 'unreachable';
    const previous = this.observedPaths.get(key);
    if (previous !== undefined && previous !== encoded) {
      this.metrics.routeChanges += 1;
      const changedAt = this.topologyChangedAt.get(key) ?? this.clock.now();
      this.metrics.routeConvergenceSamplesMs.push(
        this.clock.now() - changedAt,
      );
    }
    this.observedPaths.set(key, encoded);
    this.topologyChangedAt.delete(key);
    this.record({kind: 'topology-path', from, to, detail: encoded});
    return found;
  }

  private expireStaleObservations(): void {
    for (const [peerKey, lastSeen] of this.peerLastSeen.entries()) {
      if (this.stalePeerReported.has(peerKey)) {
        continue;
      }
      const [receiverText] = peerKey.split('<');
      const receiver = this.node(Number(receiverText));
      if (this.clock.now() - lastSeen >= receiver.config.peerStaleAfterMs!) {
        this.stalePeerReported.add(peerKey);
        this.metrics.stalePeerExpiries += 1;
        this.record({
          kind: 'peer-stale',
          to: receiver.config.id,
          detail: peerKey,
        });
      }
    }

    for (const node of this.nodes.values()) {
      if (
        node.gps.lastFixAtMs !== null &&
        !node.gps.staleReported &&
        this.clock.now() - node.gps.lastFixAtMs >= node.config.gpsStaleAfterMs!
      ) {
        node.gps.staleReported = true;
        this.metrics.staleLocationExpiries += 1;
        this.record({kind: 'gps-stale', to: node.config.id});
      }
    }
  }

  async advanceBy(deltaMs: number): Promise<void> {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new Error('Simulator advance delta must be finite and non-negative.');
    }
    await this.advanceTo(this.clock.now() + deltaMs);
  }

  async advanceTo(targetMs: number): Promise<void> {
    if (!Number.isFinite(targetMs) || targetMs < this.clock.now()) {
      throw new Error('Simulator virtual time cannot move backwards.');
    }
    while (true) {
      this.scheduled.sort(
        (left, right) => left.atMs - right.atMs || left.id - right.id,
      );
      const event = this.scheduled[0];
      if (!event || event.atMs > targetMs) {
        break;
      }
      this.scheduled.shift();
      this.clock.advanceTo(event.atMs);
      await event.action();
    }
    this.clock.advanceTo(targetMs);
    this.expireStaleObservations();
    this.updateQueueMetrics();
  }

  async runUntilIdle(maxEvents = 100_000): Promise<void> {
    let processed = 0;
    this.resumeAllLinks();
    while (this.scheduled.length > 0) {
      if (processed >= maxEvents) {
        throw new Error(
          `Simulator exceeded ${maxEvents} scheduled events; possible amplification loop.`,
        );
      }
      this.scheduled.sort(
        (left, right) => left.atMs - right.atMs || left.id - right.id,
      );
      await this.advanceTo(this.scheduled[0].atMs);
      this.resumeAllLinks();
      processed += 1;
    }
    this.updateQueueMetrics();
  }

  averageLatencyMs(): number | null {
    if (this.metrics.latencySamplesMs.length === 0) {
      return null;
    }
    return (
      this.metrics.latencySamplesMs.reduce((sum, value) => sum + value, 0) /
      this.metrics.latencySamplesMs.length
    );
  }

  pendingWorkCount(): number {
    return this.metrics.currentQueueDepth + this.scheduled.length;
  }

  assertBounded(
    maxQueueDepth: number,
    maxScheduledEvents = 100_000,
  ): string[] {
    const failures: string[] = [];
    if (this.metrics.maxQueueDepth > maxQueueDepth) {
      failures.push(
        `max queue depth ${this.metrics.maxQueueDepth} exceeded ${maxQueueDepth}`,
      );
    }
    if (this.scheduled.length > maxScheduledEvents) {
      failures.push(
        `scheduled event count ${this.scheduled.length} exceeded ${maxScheduledEvents}`,
      );
    }
    if (
      this.metrics.duplicateCopiesInjected >
      Math.max(1, this.metrics.transmissionAttempts) * 2
    ) {
      failures.push(
        'duplicate amplification exceeded deterministic transport bound',
      );
    }
    return failures;
  }

  failureReport(reason: string): SimulatorFailureReport {
    return {
      seed: this.seed,
      reason,
      simulatedAtMs: this.clock.now(),
      nodeConfiguration: Array.from(this.nodes.values()).map(node => ({
        ...node.config,
      })),
      timeline: this.timeline.slice(),
      importantTrace: this.trace.slice(-120),
      metrics: JSON.parse(
        JSON.stringify(this.metrics),
      ) as DeterministicNetworkMetrics,
    };
  }
}
