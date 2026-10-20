import {BushMeshConvoyCoordinator} from './BushMeshConvoyCoordinator';
import {BushMeshNodeRuntime} from './BushMeshNodeRuntime';
import {BushMeshPersistentDistressBeacon} from './BushMeshPersistentDistressBeacon';
import {BushMeshPersistentPeerRegistry} from './BushMeshPersistentPeerRegistry';
import {getBushMeshPersistentStore} from './BushMeshPersistentStore';
import {BushMeshReliableSender} from './BushMeshReliableSender';
import {
  BushMeshStoreForwardRuntime,
  BushMeshStoreForwardStore,
} from './BushMeshStoreForwardRuntime';
import {BushMeshTraceBuffer} from './BushMeshTraceBuffer';

export type BushMeshRuntimeServicesSnapshot = {
  running: boolean;
  queuedStoreForwardMessages: number;
  distress: ReturnType<BushMeshPersistentDistressBeacon['state']>;
  traceEntries: number;
  knownPeers: number;
  convoyRunning: boolean;
  convoyMembers: number;
  convoyIssues: number;
};

export class BushMeshRuntimeServices {
  readonly storeForward: BushMeshStoreForwardRuntime;
  readonly reliableSender: BushMeshReliableSender;
  readonly distress: BushMeshPersistentDistressBeacon;
  readonly trace: BushMeshTraceBuffer;
  readonly convoy: BushMeshConvoyCoordinator;
  readonly peerPersistence: BushMeshPersistentPeerRegistry;

  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private peerStateHydrated = false;

  constructor(
    readonly node: BushMeshNodeRuntime,
    options?: {
      store?: BushMeshStoreForwardStore;
      traceCapacity?: number;
    },
  ) {
    const persistentStore =
      options?.store ?? getBushMeshPersistentStore() ?? undefined;

    this.storeForward = new BushMeshStoreForwardRuntime(
      node.network,
      persistentStore,
    );
    this.reliableSender = new BushMeshReliableSender(
      node.network,
      this.storeForward,
    );
    this.distress = new BushMeshPersistentDistressBeacon(
      node.network,
      () => {
        const local = node.localHello();
        if (!local) {
          throw new Error('BushMesh distress cannot start before node identity is known.');
        }
        return local.nodeId;
      },
      persistentStore,
    );
    this.trace = new BushMeshTraceBuffer(options?.traceCapacity ?? 250);
    this.convoy = new BushMeshConvoyCoordinator(node);
    this.peerPersistence = new BushMeshPersistentPeerRegistry(persistentStore);
  }

  async start(options?: {
    now?: number;
    storeForwardFlushMs?: number;
    peerMaintenanceMs?: number;
  }): Promise<number> {
    if (this.running) {
      return this.storeForward.size();
    }

    const now = options?.now ?? Date.now();
    const restored = await this.storeForward.initialize(now);
    const restoredDistress = await this.distress.initialize(now);
    await this.restorePeerTopology(now);
    this.running = true;
    this.reliableSender.startAutoFlush(options?.storeForwardFlushMs ?? 5000);

    const peerMaintenanceMs = options?.peerMaintenanceMs ?? 60 * 1000;
    if (!Number.isFinite(peerMaintenanceMs) || peerMaintenanceMs < 5000) {
      throw new Error('BushMesh peer maintenance interval must be at least five seconds.');
    }

    this.maintenanceTimer = setInterval(() => {
      void this.runPeerMaintenance(Date.now());
    }, peerMaintenanceMs);

    this.trace.recordEvent(
      'Runtime services started',
      `Restored ${restored} delayed message(s)${
        restoredDistress ? ' and an active distress schedule' : ''
      }.`,
    );
    return restored;
  }

  stop(): void {
    this.running = false;
    this.reliableSender.stop();
    this.distress.suspend();
    this.convoy.stop();
    void this.distress.flushPersistence().catch(() => undefined);
    void this.persistPeerTopology().catch(() => undefined);

    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }

    this.trace.recordEvent('Runtime services stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  async restorePeerTopology(now = Date.now()): Promise<void> {
    if (this.peerStateHydrated) {
      return;
    }

    const registry = this.node.peers();
    if (!registry) {
      return;
    }

    const restored = await this.peerPersistence.restore(registry, now);
    this.peerStateHydrated = true;

    if (restored.peers > 0 || restored.routes > 0) {
      this.trace.recordEvent(
        'Peer topology restored',
        `Restored ${restored.peers} peer(s) and ${restored.routes} route hint(s).`,
      );
    }
  }

  async persistPeerTopology(now = Date.now()): Promise<void> {
    const registry = this.node.peers();
    if (!registry) {
      return;
    }

    await this.peerPersistence.persist(registry, now);
  }

  snapshot(): BushMeshRuntimeServicesSnapshot {
    const convoy = this.convoy.snapshot();

    return {
      running: this.running,
      queuedStoreForwardMessages: this.storeForward.size(),
      distress: this.distress.state(),
      traceEntries: this.trace.size(),
      knownPeers: this.node.peers()?.all().length ?? 0,
      convoyRunning: this.convoy.isRunning(),
      convoyMembers: convoy?.members.length ?? 0,
      convoyIssues: convoy?.issues.length ?? 0,
    };
  }

  private async runPeerMaintenance(now: number): Promise<void> {
    if (!this.peerStateHydrated) {
      await this.restorePeerTopology(now);
    }

    const registry = this.node.peers();
    const removed = registry?.prune(now) ?? [];
    if (removed.length > 0) {
      this.trace.recordEvent(
        'Peer maintenance',
        `Pruned ${removed.length} stale peer(s): ${removed
          .map(nodeId => nodeId.toString(16).padStart(8, '0'))
          .join(', ')}`,
      );
    }

    this.convoy.tracker.prune(now);
    await this.persistPeerTopology(now).catch(error => {
      this.trace.recordEvent(
        'Peer persistence failed',
        error instanceof Error ? error.message : 'Unknown peer persistence error.',
      );
    });
  }
}
