import {
  BushMeshControlledFloodForwarder,
  BushMeshForwardingDecision,
  BushMeshForwardingInput,
} from '../protocol';
import {BushMeshDedupStore, BushMeshPersistentDedup} from './BushMeshPersistentDedup';

/**
 * Controlled forwarding with durable duplicate memory. Forwarding decisions are
 * synchronous for the receive path; persistence is queued after each new
 * identity so a process restart retains the short replay window.
 */
export class BushMeshPersistentForwarder {
  readonly dedup: BushMeshPersistentDedup;
  private readonly forwarder: BushMeshControlledFloodForwarder;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(
    store?: BushMeshDedupStore,
    options?: {
      ttlMs?: number;
      maxEntries?: number;
      minJitterMs?: number;
      maxJitterMs?: number;
      storeKey?: string;
    },
  ) {
    this.dedup = new BushMeshPersistentDedup(store, {
      ttlMs: options?.ttlMs,
      maxEntries: options?.maxEntries,
      storeKey: options?.storeKey,
    });
    this.forwarder = new BushMeshControlledFloodForwarder(
      this.dedup.cache,
      options?.minJitterMs ?? 120,
      options?.maxJitterMs ?? 650,
    );
  }

  async initialize(now = Date.now()): Promise<number> {
    return this.dedup.initialize(now);
  }

  evaluate(
    input: BushMeshForwardingInput,
    now = Date.now(),
  ): BushMeshForwardingDecision {
    const decision = this.forwarder.evaluate(input, now);

    if (decision.reason !== 'duplicate') {
      this.persistChain = this.persistChain
        .then(() => this.dedup.persist(now))
        .catch(() => undefined);
    }

    return decision;
  }

  async flushPersistence(): Promise<void> {
    await this.persistChain;
  }

  async prune(now = Date.now()): Promise<number> {
    return this.dedup.prune(now);
  }

  async clear(): Promise<void> {
    await this.dedup.clear();
  }
}
