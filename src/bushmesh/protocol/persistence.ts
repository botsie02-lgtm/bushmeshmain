import {
  BushMeshDeliveryQueue,
  BushMeshQueuedMessage,
} from './deliveryQueue';

const QUEUE_SNAPSHOT_VERSION = 1;

export type BushMeshKeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

type QueueSnapshotEnvelope = {
  version: number;
  messages: BushMeshQueuedMessage[];
};

export function serializeDeliveryQueue(queue: BushMeshDeliveryQueue): string {
  const snapshot: QueueSnapshotEnvelope = {
    version: QUEUE_SNAPSHOT_VERSION,
    messages: queue.snapshot(),
  };

  return JSON.stringify(snapshot);
}

export function parseDeliveryQueueSnapshot(value: string): BushMeshQueuedMessage[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Stored Bushmesh delivery queue is not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Stored Bushmesh delivery queue has invalid shape.');
  }

  const snapshot = parsed as Partial<QueueSnapshotEnvelope>;

  if (snapshot.version !== QUEUE_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported delivery queue snapshot version ${snapshot.version}.`);
  }

  if (!Array.isArray(snapshot.messages)) {
    throw new Error('Stored Bushmesh delivery queue is missing messages.');
  }

  return snapshot.messages as BushMeshQueuedMessage[];
}

export async function saveDeliveryQueue(
  queue: BushMeshDeliveryQueue,
  store: BushMeshKeyValueStore,
  key = 'bushmesh.deliveryQueue.v1',
): Promise<void> {
  await store.setItem(key, serializeDeliveryQueue(queue));
}

export async function restoreDeliveryQueue(
  queue: BushMeshDeliveryQueue,
  store: BushMeshKeyValueStore,
  options?: {
    key?: string;
    now?: number;
  },
): Promise<number> {
  const key = options?.key ?? 'bushmesh.deliveryQueue.v1';
  const stored = await store.getItem(key);

  if (!stored) {
    return 0;
  }

  return queue.restoreSnapshot(parseDeliveryQueueSnapshot(stored), {
    now: options?.now,
    replace: true,
  });
}

export async function clearPersistedDeliveryQueue(
  store: BushMeshKeyValueStore,
  key = 'bushmesh.deliveryQueue.v1',
): Promise<void> {
  if (store.removeItem) {
    await store.removeItem(key);
    return;
  }

  await store.setItem(key, '');
}
