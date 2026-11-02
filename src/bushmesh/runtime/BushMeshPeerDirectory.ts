import {BushMeshNodeHello, BushMeshPeerPolicy, negotiateBushMeshPeerPolicy} from '../protocol';

export type BushMeshPeerDirectoryStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

export type BushMeshPeerDirectoryEntry = {
  nodeId: number;
  hello: BushMeshNodeHello;
  firstSeenAt: number;
  lastSeenAt: number;
};

export type BushMeshPeerDirectoryView = BushMeshPeerDirectoryEntry & {
  policy: BushMeshPeerPolicy;
  stale: boolean;
};

type DirectorySnapshot = {
  version: 1;
  peers: BushMeshPeerDirectoryEntry[];
};

const DEFAULT_KEY = 'bushmesh.peerDirectory.v1';
const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Durable peer capability directory. This intentionally does NOT restore link
 * observations or routes. A historical peer may be shown in UI or used to
 * understand protocol compatibility, but it is never considered reachable until
 * a fresh hello/link observation is accepted by BushMeshPeerRegistry.
 */
export class BushMeshPeerDirectory {
  private readonly peers = new Map<number, BushMeshPeerDirectoryEntry>();
  private persistChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly localHello: () => BushMeshNodeHello | null,
    private readonly store?: BushMeshPeerDirectoryStore,
    private readonly storeKey = DEFAULT_KEY,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly maxAgeMs = DEFAULT_MAX_AGE_MS,
    private readonly staleAfterMs = 10 * 60 * 1000,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('Peer directory capacity must be a positive integer.');
    }
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      throw new Error('Peer directory max age must be greater than zero.');
    }
  }

  async initialize(now = Date.now()): Promise<number> {
    if (!this.store) {
      return 0;
    }

    const raw = await this.store.getItem(this.storeKey);
    if (!raw) {
      return 0;
    }

    let snapshot: DirectorySnapshot;
    try {
      snapshot = JSON.parse(raw) as DirectorySnapshot;
    } catch {
      await this.clear();
      return 0;
    }

    if (snapshot.version !== 1 || !Array.isArray(snapshot.peers)) {
      await this.clear();
      return 0;
    }

    this.peers.clear();
    for (const saved of snapshot.peers) {
      if (!this.isValid(saved, now)) {
        continue;
      }
      this.peers.set(saved.nodeId, this.clone(saved));
    }

    this.trim(now);
    await this.persistNow();
    return this.peers.size;
  }

  async remember(
    hello: BushMeshNodeHello,
    now = Date.now(),
  ): Promise<BushMeshPeerDirectoryView> {
    const existing = this.peers.get(hello.nodeId);
    const entry: BushMeshPeerDirectoryEntry = {
      nodeId: hello.nodeId,
      hello: {...hello},
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
    };
    this.peers.set(hello.nodeId, entry);
    this.trim(now);
    await this.persistNow();
    return this.view(entry, now);
  }

  get(nodeId: number, now = Date.now()): BushMeshPeerDirectoryView | null {
    this.trim(now);
    const entry = this.peers.get(nodeId);
    return entry ? this.view(entry, now) : null;
  }

  all(now = Date.now()): BushMeshPeerDirectoryView[] {
    this.trim(now);
    return Array.from(this.peers.values())
      .map(entry => this.view(entry, now))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.nodeId - b.nodeId);
  }

  async forget(nodeId: number): Promise<boolean> {
    const removed = this.peers.delete(nodeId);
    if (removed) {
      await this.persistNow();
    }
    return removed;
  }

  async prune(now = Date.now()): Promise<number[]> {
    const before = new Set(this.peers.keys());
    this.trim(now);
    const removed = Array.from(before).filter(nodeId => !this.peers.has(nodeId));
    if (removed.length > 0) {
      await this.persistNow();
    }
    return removed;
  }

  async clear(): Promise<void> {
    this.peers.clear();
    if (!this.store) {
      return;
    }
    if (this.store.removeItem) {
      await this.store.removeItem(this.storeKey);
    } else {
      await this.store.setItem(this.storeKey, '');
    }
  }

  schedulePersist(): void {
    this.persistChain = this.persistChain
      .then(() => this.persistNow())
      .catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.persistChain;
  }

  private view(entry: BushMeshPeerDirectoryEntry, now: number): BushMeshPeerDirectoryView {
    const local = this.localHello();
    const policy: BushMeshPeerPolicy = local
      ? negotiateBushMeshPeerPolicy(local, entry.hello)
      : {
          compatible: false,
          protocolVersion: null,
          capabilities: 0,
          transport: 'text-safe',
          allowSemantic: false,
          allowDictionary: false,
          dictionaryVersion: null,
          allowFragmentation: false,
          allowSelectiveAck: false,
          allowStoreAndForward: false,
          allowLocationDelta: false,
          allowSensorDelta: false,
          allowCompressedBinary: false,
          allowFileTransfer: false,
          allowRouting: false,
        };

    return {
      ...this.clone(entry),
      policy,
      stale: now - entry.lastSeenAt >= this.staleAfterMs,
    };
  }

  private trim(now: number): void {
    for (const [nodeId, entry] of this.peers.entries()) {
      if (now - entry.lastSeenAt > this.maxAgeMs) {
        this.peers.delete(nodeId);
      }
    }

    while (this.peers.size > this.maxEntries) {
      const oldest = Array.from(this.peers.values()).sort(
        (a, b) => a.lastSeenAt - b.lastSeenAt,
      )[0];
      if (!oldest) {
        break;
      }
      this.peers.delete(oldest.nodeId);
    }
  }

  private isValid(entry: BushMeshPeerDirectoryEntry, now: number): boolean {
    return Boolean(
      entry &&
        Number.isInteger(entry.nodeId) &&
        entry.nodeId >= 0 &&
        entry.nodeId <= 0xffffffff &&
        entry.hello &&
        entry.hello.nodeId === entry.nodeId &&
        Number.isFinite(entry.firstSeenAt) &&
        Number.isFinite(entry.lastSeenAt) &&
        entry.firstSeenAt >= 0 &&
        entry.lastSeenAt >= entry.firstSeenAt &&
        now - entry.lastSeenAt <= this.maxAgeMs
    );
  }

  private clone(entry: BushMeshPeerDirectoryEntry): BushMeshPeerDirectoryEntry {
    return {
      ...entry,
      hello: {...entry.hello},
    };
  }

  private async persistNow(): Promise<void> {
    if (!this.store) {
      return;
    }

    const snapshot: DirectorySnapshot = {
      version: 1,
      peers: Array.from(this.peers.values()).map(entry => this.clone(entry)),
    };
    await this.store.setItem(this.storeKey, JSON.stringify(snapshot));
  }
}
