import {BushMeshConvoyRole} from '../protocol';
import {
  BushMeshConvoyLocalConfig,
  configureBushMeshConvoy,
  getBushMeshConvoyState,
} from './BushMeshConvoyHub';
import {
  BushMeshPersistentKeyValueStore,
  getBushMeshPersistentStore,
} from './BushMeshPersistentStore';

const STORAGE_KEY = 'bushmesh.convoy.config.v1';

type PersistedConvoyConfig = {
  version: 1;
  convoyId: number;
  orderIndex: number;
  role: number;
  heartbeatIntervalMs: number;
};

function isPersistedConfig(value: unknown): value is PersistedConvoyConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PersistedConvoyConfig>;
  return (
    candidate.version === 1 &&
    Number.isInteger(candidate.convoyId) &&
    candidate.convoyId! >= 0 &&
    candidate.convoyId! <= 0xffffffff &&
    Number.isInteger(candidate.orderIndex) &&
    candidate.orderIndex! >= 0 &&
    candidate.orderIndex! <= 0xffff &&
    Number.isInteger(candidate.role) &&
    candidate.role! >= BushMeshConvoyRole.Lead &&
    candidate.role! <= 7 &&
    Number.isFinite(candidate.heartbeatIntervalMs) &&
    candidate.heartbeatIntervalMs! >= 2000
  );
}

export class BushMeshConvoyPersistence {
  constructor(
    private readonly store: BushMeshPersistentKeyValueStore | null =
      getBushMeshPersistentStore(),
  ) {}

  isAvailable(): boolean {
    return this.store !== null;
  }

  async restore(): Promise<BushMeshConvoyLocalConfig | null> {
    if (!this.store) {
      return null;
    }

    const raw = await this.store.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.store.removeItem(STORAGE_KEY);
      return null;
    }

    if (!isPersistedConfig(parsed)) {
      await this.store.removeItem(STORAGE_KEY);
      return null;
    }

    // Deliberately restore disabled. Starting radio heartbeats always requires
    // an explicit user action in the current app session.
    return configureBushMeshConvoy({
      enabled: false,
      convoyId: parsed.convoyId,
      orderIndex: parsed.orderIndex,
      role: parsed.role,
      heartbeatIntervalMs: parsed.heartbeatIntervalMs,
    });
  }

  async persist(): Promise<void> {
    if (!this.store) {
      return;
    }

    const config = getBushMeshConvoyState().config;
    const payload: PersistedConvoyConfig = {
      version: 1,
      convoyId: config.convoyId,
      orderIndex: config.orderIndex,
      role: config.role,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
    };

    await this.store.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  async clear(): Promise<void> {
    await this.store?.removeItem(STORAGE_KEY);
  }
}

let sharedPersistence: BushMeshConvoyPersistence | null = null;

export function getBushMeshConvoyPersistence(): BushMeshConvoyPersistence {
  if (!sharedPersistence) {
    sharedPersistence = new BushMeshConvoyPersistence();
  }
  return sharedPersistence;
}
