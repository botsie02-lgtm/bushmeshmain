import {
  BushMeshPacketType,
  BushMeshPriority,
  encodeBushMeshConvoyWire,
  encodeBushMeshWire,
} from '../../protocol/public';
import type {BushMeshInboundResult, BushMeshSecurityAdapter} from '../../runtime/public';
import {
  DeterministicBushMeshNetworkSimulator,
  DeterministicNetworkLinkConfig,
  SimulatorNodeId,
  VirtualBushMeshNode,
} from './DeterministicNetworkSimulator';

/**
 * Test-only vehicle and position-observation model. It does not implement a
 * BushMesh convoy state machine, forwarding, GPS driver or Security provider.
 * All packets pass through frozen Protocol v1's real public runtime.
 */
export type VirtualVehicle = {
  id: SimulatorNodeId;
  eastMetres: number;
  northMetres: number;
};

export type PositionFreshness = 'fresh' | 'stale' | 'unavailable' | 'never-seen';

export type PositionObservation = {
  sourceNodeId: number;
  sequence: number;
  messageId: number;
  sampledAtMs: number;
  receivedAtMs: number;
  latitude?: number;
  longitude?: number;
  unavailable: boolean;
};

export type PositionView = {
  receiverId: number;
  sourceId: number;
  freshness: PositionFreshness;
  ageMs: number | null;
  lastSequence: number | null;
  lastPosition?: {latitude: number; longitude: number};
};

export type ConvoyRegressionReport = {
  seed: number;
  nodeCount: number;
  simulatedAtMs: number;
  delivery: {
    attempted: number;
    accepted: number;
    failed: number;
    duplicatesSuppressed: number;
    runtimeRejected: number;
    unauthorisedUpdatesRejected: number;
    droppedCollision: number;
    transportRetries: number;
    storeAndForwardRecoveries: number;
    deliveryRatio: number;
    averageLatencyMs: number | null;
  };
  queue: {
    maxDepth: number;
    maxBytes: number;
    currentDepth: number;
    droppedCongestion: number;
    droppedExpired: number;
    droppedUnavailable: number;
    maxQueueWaitMs: number;
  };
  airtime: {
    transmissionAttempts: number;
    estimatedMs: number;
    transmittedBytes: number;
    channelOverlaps: number;
    senderContentions: number;
    dutyCycleHoldMs: number;
    transmissionsBySender: Record<string, number>;
  };
  recovery: {carrierReconnects: number; storeAndForwardRecoveries: number; partitionHeals: number; nodeReturns: number};
  positionFreshness: {
    fresh: number;
    stale: number;
    unavailable: number;
    neverSeen: number;
    olderSequenceIgnored: number;
    unexpectedStateChanges: string[];
    views: PositionView[];
  };
};

type SentPosition = {
  sourceNodeId: number;
  sequence: number;
  sampledAtMs: number;
};

export type ConvoyMobilityOptions = {
  groupId?: string;
  convoyId?: number;
  radioRangeMetres?: number;
  positionStaleAfterMs?: number;
  link?: DeterministicNetworkLinkConfig;
  securityAdapters?: Record<number, BushMeshSecurityAdapter>;
};

export class ConvoyMobilityHarness {
  readonly network: DeterministicBushMeshNetworkSimulator;
  readonly groupId: string;
  readonly convoyId: number;
  readonly radioRangeMetres: number;
  readonly positionStaleAfterMs: number;

  private readonly linkOptions: DeterministicNetworkLinkConfig;
  private readonly securityAdapters: Record<number, BushMeshSecurityAdapter>;
  private readonly vehicles = new Map<number, VirtualVehicle>();
  private readonly lastAppliedLinks = new Map<string, string>();
  private readonly overrides = new Map<string, DeterministicNetworkLinkConfig>();
  private readonly sequence = new Map<number, number>();
  private readonly sentPositions = new Map<string, SentPosition>();
  private readonly observations = new Map<string, PositionObservation>();
  private readonly violations: string[] = [];
  private olderSequenceIgnored = 0;
  private nextMessageId = 200_000;

  constructor(seed: number, options: ConvoyMobilityOptions = {}) {
    this.network = new DeterministicBushMeshNetworkSimulator(seed);
    this.groupId = options.groupId ?? 'simulated-convoy';
    this.convoyId = options.convoyId ?? 9;
    this.radioRangeMetres = options.radioRangeMetres ?? 180;
    this.positionStaleAfterMs = options.positionStaleAfterMs ?? 30_000;
    this.linkOptions = {...options.link};
    this.securityAdapters = options.securityAdapters ?? {};
    if (!Number.isFinite(this.radioRangeMetres) || this.radioRangeMetres <= 0) {
      throw new Error('The synthetic radio range must be positive.');
    }
    if (!Number.isFinite(this.positionStaleAfterMs) || this.positionStaleAfterMs <= 0) {
      throw new Error('Position staleness threshold must be positive.');
    }
  }

  async addFleet(count: number, spacingMetres = 25): Promise<void> {
    if (!Number.isInteger(count) || count < 2 || count > 20 || this.vehicles.size) {
      throw new Error('A fleet must contain 2–20 nodes and can only be initialized once.');
    }
    for (let id = 1; id <= count; id += 1) {
      const node = await this.network.addNode(
        {id, name: `vehicle-${id}`},
        {securityAdapter: this.securityAdapters[id]},
      );
      this.vehicles.set(id, {id, eastMetres: (id - 1) * spacingMetres, northMetres: 0});
      node.onInboundResult(result => this.observe(id, result));
      this.network.setGpsFix(id);
    }
    this.refreshLinks();
  }

  vehicle(id: number): VirtualVehicle {
    const vehicle = this.vehicles.get(id);
    if (!vehicle) {
      throw new Error(`Unknown virtual vehicle ${id}.`);
    }
    return {...vehicle};
  }

  node(id: number): VirtualBushMeshNode {
    this.vehicle(id);
    return this.network.node(id);
  }

  ids(): number[] {
    return Array.from(this.vehicles.keys());
  }

  move(id: number, eastMetres: number, northMetres = 0): void {
    if (!Number.isFinite(eastMetres) || !Number.isFinite(northMetres)) {
      throw new Error('Virtual vehicle coordinates must be finite.');
    }
    this.vehicle(id);
    this.vehicles.set(id, {id, eastMetres, northMetres});
    this.refreshLinks();
  }

  moveGroup(ids: number[], deltaEastMetres: number, deltaNorthMetres = 0): void {
    for (const id of ids) {
      const previous = this.vehicle(id);
      this.vehicles.set(id, {
        id,
        eastMetres: previous.eastMetres + deltaEastMetres,
        northMetres: previous.northMetres + deltaNorthMetres,
      });
    }
    this.refreshLinks();
  }

  /** Directional carrier override, never an application routing decision. */
  overrideLink(from: number, to: number, patch: DeterministicNetworkLinkConfig): void {
    this.vehicle(from);
    this.vehicle(to);
    if (from === to) throw new Error('Virtual self-links are unsupported.');
    const key = `${from}>${to}`;
    this.overrides.set(key, {...this.overrides.get(key), ...patch});
    this.refreshLinks();
  }

  setPresent(id: number, present: boolean): void {
    this.vehicle(id);
    this.network.setNodePresent(id, present);
  }

  setGpsAvailable(id: number, available: boolean): void {
    this.vehicle(id);
    if (available) this.network.setGpsFix(id);
    else this.network.clearGps(id);
  }

  /**
   * Link quality is intentionally a synthetic deterministic distance function,
   * not a calibrated LoRa propagation model or protocol route selection.
   */
  refreshLinks(): void {
    for (const from of this.vehicles.values()) {
      for (const to of this.vehicles.values()) {
        if (from.id === to.id) continue;
        const distance = Math.hypot(
          to.eastMetres - from.eastMetres,
          to.northMetres - from.northMetres,
        );
        const key = `${from.id}>${to.id}`;
        const override = this.overrides.get(key) ?? {};
        const enabled = distance <= this.radioRangeMetres &&
          override.enabled !== false;
        const rssiDbm = Math.max(-125, Math.round(
          -65 - 22 * Math.log10(Math.max(10, distance) / 10),
        ));
        const snrDb = Math.max(-15, Math.round(11 - distance * 22 / this.radioRangeMetres));
        const next: DeterministicNetworkLinkConfig = {
          ...this.linkOptions,
          ...override,
          enabled,
          rssiDbm: override.rssiDbm ?? rssiDbm,
          snrDb: override.snrDb ?? snrDb,
        };
        const encoded = JSON.stringify(next);
        if (this.lastAppliedLinks.get(key) !== encoded) {
          this.network.setLink(from.id, to.id, next);
          this.lastAppliedLinks.set(key, encoded);
        }
      }
    }
  }

  private key(receiverId: number, sourceId: number): string {
    return `${receiverId}<${sourceId}`;
  }

  private observe(receiverId: number, result: BushMeshInboundResult): void {
    if (result.status !== 'accepted' || result.kind !== 'protocol') return;
    if (result.typed.kind !== 'convoy') return;
    const value = result.typed.value;
    const sourceId = result.securityRouting?.sourceNodeId;
    if (!result.protected || result.securityAssociation.kind !== 'group' ||
        result.securityAssociation.groupId !== this.groupId ||
        sourceId === undefined || value.nodeId !== sourceId) {
      this.violations.push(
        `receiver=${receiverId} invalid accepted convoy source=${sourceId ?? 'missing'} embedded=${value.nodeId}`,
      );
      return;
    }
    const sent = this.sentPositions.get(`${sourceId}:${result.decoded.envelope.messageId}`);
    if (!sent || sent.sourceNodeId !== sourceId || sent.sequence !== value.sequence) {
      this.violations.push(
        `receiver=${receiverId} unaccounted accepted position source=${sourceId} seq=${value.sequence}`,
      );
      return;
    }
    const key = this.key(receiverId, sourceId);
    const previous = this.observations.get(key);
    if (previous && value.sequence <= previous.sequence) {
      this.olderSequenceIgnored += 1;
      return;
    }
    if (value.locationUnavailable && value.location) {
      this.violations.push(`receiver=${receiverId} contradictory location flags`);
      return;
    }
    this.observations.set(key, {
      sourceNodeId: sourceId,
      sequence: value.sequence,
      messageId: result.decoded.envelope.messageId,
      sampledAtMs: sent.sampledAtMs,
      receivedAtMs: result.datagram.receivedAtMs,
      latitude: value.location?.latitude,
      longitude: value.location?.longitude,
      unavailable: value.locationUnavailable === true,
    });
  }

  /**
   * Real canonical convoy wire encoding + Security container dispatch. Each
   * recipient receives the same final opaque outbound datagram.
   */
  async publishPosition(
    sourceId: number,
    recipients: number[] = this.ids().filter(id => id !== sourceId),
    storeIfUnavailable = false,
  ): Promise<number> {
    const source = this.node(sourceId);
    const vehicle = this.vehicle(sourceId);
    const sequence = (this.sequence.get(sourceId) ?? 0) + 1;
    this.sequence.set(sourceId, sequence);
    const messageId = this.nextMessageId++;
    const gpsAvailable = source.gps.available;
    if (gpsAvailable) this.network.setGpsFix(sourceId);
    const latitude = -37.8 + vehicle.northMetres / 111_320;
    const longitude = 145 + vehicle.eastMetres /
      (111_320 * Math.cos(-37.8 * Math.PI / 180));
    this.sentPositions.set(`${sourceId}:${messageId}`, {
      sourceNodeId: sourceId,
      sequence,
      sampledAtMs: this.network.clock.now(),
    });
    const wire = encodeBushMeshConvoyWire({
      convoyId: this.convoyId,
      nodeId: sourceId,
      sequence,
      orderIndex: sourceId - 1,
      role: sourceId === 1 ? 0 : 1,
      ...(gpsAvailable
        ? {location: {latitude, longitude}}
        : {locationUnavailable: true}),
    }, messageId);
    const outbound = await source.prepareOutbound(wire, {
      identityAssociation: {kind: 'group', groupId: this.groupId},
      securityRouting: {sourceNodeId: sourceId, groupId: this.groupId},
      label: `convoy-position:${sourceId}:${sequence}`,
    });
    for (const receiverId of recipients) {
      this.vehicle(receiverId);
      if (receiverId === sourceId) throw new Error('Cannot publish a position to itself.');
      await this.network.transmit(sourceId, receiverId, outbound, {
        storeIfUnavailable,
        convergenceKey: 'convoy-position',
      });
    }
    return messageId;
  }

  async sendMessage(
    from: number,
    to: number,
    options: {
      retryAttempts?: number;
      storeIfUnavailable?: boolean;
      expiresAfterMs?: number;
      priority?: BushMeshPriority;
    } = {},
  ): Promise<number> {
    const node = this.node(from);
    this.vehicle(to);
    const messageId = this.nextMessageId++;
    const wire = encodeBushMeshWire({
      type: BushMeshPacketType.Message,
      priority: options.priority ?? BushMeshPriority.DirectMessage,
      ackRequested: false,
      messageId,
      payload: [from & 0xff, to & 0xff, messageId & 0xff],
    });
    const outbound = await node.prepareOutbound(wire, {
      retryIntent: options.retryAttempts && options.retryAttempts > 1
        ? {mode: 'transport-retry', maxTransportAttempts: options.retryAttempts}
        : undefined,
      expiresAtMs: options.expiresAfterMs === undefined
        ? undefined : this.network.clock.now() + options.expiresAfterMs,
    });
    await this.network.transmit(from, to, outbound, {
      storeIfUnavailable: options.storeIfUnavailable ?? false,
    });
    return messageId;
  }

  positionView(receiverId: number, sourceId: number): PositionView {
    this.vehicle(receiverId);
    this.vehicle(sourceId);
    const observation = this.observations.get(this.key(receiverId, sourceId));
    if (!observation) {
      return {receiverId, sourceId, freshness: 'never-seen', ageMs: null, lastSequence: null};
    }
    const ageMs = this.network.clock.now() - observation.sampledAtMs;
    const freshness: PositionFreshness = observation.unavailable
      ? 'unavailable' : ageMs >= this.positionStaleAfterMs ? 'stale' : 'fresh';
    return {
      receiverId,
      sourceId,
      freshness,
      ageMs,
      lastSequence: observation.sequence,
      ...(observation.latitude !== undefined && observation.longitude !== undefined
        ? {lastPosition: {latitude: observation.latitude, longitude: observation.longitude}}
        : {}),
    };
  }

  report(): ConvoyRegressionReport {
    const metrics = this.network.metrics;
    const views: PositionView[] = [];
    const counts = {fresh: 0, stale: 0, unavailable: 0, neverSeen: 0};
    for (const receiverId of this.ids()) {
      for (const sourceId of this.ids()) {
        if (receiverId === sourceId) continue;
        const view = this.positionView(receiverId, sourceId);
        views.push(view);
        const bucket = view.freshness === 'never-seen' ? 'neverSeen' : view.freshness;
        counts[bucket] += 1;
      }
    }
    return {
      seed: this.network.seed,
      nodeCount: this.vehicles.size,
      simulatedAtMs: this.network.clock.now(),
      delivery: {
        attempted: metrics.attemptedDatagrams,
        accepted: metrics.deliveredDatagrams,
        failed: metrics.failedDatagrams,
        duplicatesSuppressed: metrics.runtimeDuplicates,
        runtimeRejected: metrics.runtimeRejected,
        unauthorisedUpdatesRejected: this.network.trace.filter(e =>
          e.kind === 'runtime-rejected' && e.detail?.startsWith('security-failed:')
        ).length,
        droppedCollision: metrics.droppedCollision,
        transportRetries: metrics.transportRetries,
        storeAndForwardRecoveries: metrics.storeAndForwardRecoveries,
        deliveryRatio: metrics.attemptedDatagrams
          ? metrics.deliveredDatagrams / metrics.attemptedDatagrams : 0,
        averageLatencyMs: this.network.averageLatencyMs(),
      },
      queue: {
        maxDepth: metrics.maxQueueDepth,
        maxBytes: metrics.maxQueueBytes,
        currentDepth: metrics.currentQueueDepth,
        droppedCongestion: metrics.droppedCongestion,
        droppedExpired: metrics.droppedExpired,
        droppedUnavailable: metrics.droppedUnavailable,
        maxQueueWaitMs: metrics.maxQueueWaitMs,
      },
      airtime: {
        transmissionAttempts: metrics.transmissionAttempts,
        estimatedMs: metrics.estimatedAirtimeMs,
        transmittedBytes: metrics.totalTransmittedBytes,
        channelOverlaps: metrics.channelOverlaps,
        senderContentions: metrics.senderContentions,
        dutyCycleHoldMs: metrics.dutyCycleHoldMs,
        transmissionsBySender: {...metrics.transmissionsBySender},
      },
      recovery: {
        carrierReconnects: metrics.carrierReconnects,
        storeAndForwardRecoveries: metrics.storeAndForwardRecoveries,
        partitionHeals: this.network.trace.filter(e => e.kind === 'partition-healed').length,
        nodeReturns: this.network.trace.filter(e => e.kind === 'node-presence' && e.detail === 'present').length,
      },
      positionFreshness: {
        ...counts,
        olderSequenceIgnored: this.olderSequenceIgnored,
        unexpectedStateChanges: [...this.violations],
        views,
      },
    };
  }

  regressionFailure(reason: string): string {
    return JSON.stringify({
      reason,
      convoy: this.report(),
      network: this.network.failureReport(reason),
    }, null, 2);
  }
}
