import {Buffer} from 'buffer';

import {BushMeshFileContentType} from '../protocol';
import {getBushMeshPersistentStore} from './BushMeshPersistentStore';

export type BushMeshInboxFile = {
  id: string;
  transferId: number;
  channelIndex: number;
  sourceNodeId?: number;
  fileName?: string;
  contentType: BushMeshFileContentType | number;
  data: number[];
  receivedAt: number;
};

export type BushMeshFileInboxSnapshot = {
  files: BushMeshInboxFile[];
  totalBytes: number;
  hydrated: boolean;
  revision: number;
};

type PersistedInboxFile = Omit<BushMeshInboxFile, 'data'> & {
  dataBase64: string;
};

type PersistedInbox = {
  version: 1;
  files: PersistedInboxFile[];
};

type Listener = () => void;

const STORAGE_KEY = 'bushmesh.fileInbox.v1';
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_FILES = 24;
const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const listeners = new Set<Listener>();
let files: BushMeshInboxFile[] = [];
let hydrated = false;
let revision = 0;
let mutationEpoch = 0;
let hydrationPromise: Promise<void> | null = null;
let snapshot: BushMeshFileInboxSnapshot = {
  files: [],
  totalBytes: 0,
  hydrated,
  revision,
};

function cloneFile(file: BushMeshInboxFile): BushMeshInboxFile {
  return {...file, data: [...file.data]};
}

function rebuildSnapshot(): void {
  revision += 1;
  snapshot = {
    files: files.map(cloneFile),
    totalBytes: files.reduce((sum, file) => sum + file.data.length, 0),
    hydrated,
    revision,
  };

  for (const listener of listeners) {
    listener();
  }
}

function trimToLimits(now = Date.now()): void {
  files = files
    .filter(file => now - file.receivedAt <= DEFAULT_MAX_AGE_MS)
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, MAX_FILES);

  let totalBytes = 0;
  files = files.filter(file => {
    if (file.data.length > MAX_FILE_BYTES) {
      return false;
    }

    if (totalBytes + file.data.length > MAX_TOTAL_BYTES) {
      return false;
    }

    totalBytes += file.data.length;
    return true;
  });
}

function toPersisted(file: BushMeshInboxFile): PersistedInboxFile {
  const {data, ...metadata} = file;
  return {
    ...metadata,
    dataBase64: Buffer.from(data).toString('base64'),
  };
}

function fromPersisted(value: unknown): BushMeshInboxFile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const item = value as Partial<PersistedInboxFile>;
  if (
    typeof item.id !== 'string' ||
    item.id.length === 0 ||
    typeof item.transferId !== 'number' ||
    !Number.isInteger(item.transferId) ||
    item.transferId < 0 ||
    typeof item.channelIndex !== 'number' ||
    !Number.isInteger(item.channelIndex) ||
    item.channelIndex < 0 ||
    item.channelIndex > 255 ||
    typeof item.contentType !== 'number' ||
    !Number.isFinite(item.contentType) ||
    typeof item.receivedAt !== 'number' ||
    !Number.isFinite(item.receivedAt) ||
    item.receivedAt < 0 ||
    typeof item.dataBase64 !== 'string' ||
    (item.sourceNodeId !== undefined &&
      (typeof item.sourceNodeId !== 'number' ||
        !Number.isInteger(item.sourceNodeId) ||
        item.sourceNodeId < 0)) ||
    (item.fileName !== undefined && typeof item.fileName !== 'string')
  ) {
    return null;
  }

  try {
    const data = Array.from(Buffer.from(item.dataBase64, 'base64'));
    if (data.length > MAX_FILE_BYTES) {
      return null;
    }

    return {
      id: item.id,
      transferId: item.transferId,
      channelIndex: item.channelIndex,
      sourceNodeId: item.sourceNodeId,
      fileName: item.fileName,
      contentType: item.contentType,
      data,
      receivedAt: item.receivedAt,
    };
  } catch {
    return null;
  }
}

async function persist(): Promise<void> {
  if (hydrationPromise) {
    await hydrationPromise;
  }

  const store = getBushMeshPersistentStore();
  if (!store) {
    return;
  }

  const payload: PersistedInbox = {
    version: 1,
    files: files.map(toPersisted),
  };
  await store.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function persistBestEffort(): void {
  void persist().catch(() => {
    // A storage failure must never reject a completed radio transfer.
  });
}

export function hydrateBushMeshFileInbox(now = Date.now()): Promise<void> {
  if (hydrationPromise) {
    return hydrationPromise;
  }

  const epochAtStart = mutationEpoch;
  hydrationPromise = (async () => {
    const store = getBushMeshPersistentStore();
    if (!store) {
      hydrated = true;
      rebuildSnapshot();
      return;
    }

    try {
      const raw = await store.getItem(STORAGE_KEY);

      if (mutationEpoch !== epochAtStart) {
        hydrated = true;
        rebuildSnapshot();
        await store.setItem(
          STORAGE_KEY,
          JSON.stringify({version: 1, files: files.map(toPersisted)}),
        );
        return;
      }

      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedInbox>;
        if (parsed.version === 1 && Array.isArray(parsed.files)) {
          const restored = parsed.files
            .map(fromPersisted)
            .filter((file): file is BushMeshInboxFile => file !== null);
          const deduplicated = new Map<string, BushMeshInboxFile>();

          for (const file of restored) {
            const existing = deduplicated.get(file.id);
            if (!existing || file.receivedAt > existing.receivedAt) {
              deduplicated.set(file.id, file);
            }
          }

          files = Array.from(deduplicated.values());
          trimToLimits(now);
        }
      }
    } catch {
      // Corrupt storage falls back to an empty/live inbox.
    } finally {
      hydrated = true;
      rebuildSnapshot();
    }
  })();

  return hydrationPromise;
}

export function publishBushMeshInboxFile(
  file: Omit<BushMeshInboxFile, 'id' | 'receivedAt'> & {
    id?: string;
    receivedAt?: number;
  },
): {stored: boolean; id: string; reason?: string} {
  const receivedAt = file.receivedAt ?? Date.now();
  const id = file.id ?? `${file.sourceNodeId ?? 'unknown'}:${file.transferId}:${receivedAt}`;

  if (file.data.length > MAX_FILE_BYTES) {
    return {
      stored: false,
      id,
      reason: `Received file exceeds persistent inbox limit of ${MAX_FILE_BYTES} bytes.`,
    };
  }

  mutationEpoch += 1;
  const inboxFile: BushMeshInboxFile = {
    ...file,
    id,
    receivedAt,
    data: [...file.data],
  };
  files = [inboxFile, ...files.filter(existing => existing.id !== id)];
  trimToLimits(receivedAt);
  rebuildSnapshot();
  persistBestEffort();
  return {stored: files.some(existing => existing.id === id), id};
}

export function removeBushMeshInboxFile(id: string): boolean {
  const previousLength = files.length;
  files = files.filter(file => file.id !== id);

  if (files.length === previousLength) {
    return false;
  }

  mutationEpoch += 1;
  rebuildSnapshot();
  persistBestEffort();
  return true;
}

export function clearBushMeshFileInbox(): void {
  mutationEpoch += 1;
  files = [];
  rebuildSnapshot();

  const store = getBushMeshPersistentStore();
  if (store) {
    void store.removeItem(STORAGE_KEY).catch(() => {
      // In-memory clear remains successful if native persistence is unavailable.
    });
  }
}

export function getBushMeshFileInboxSnapshot(): BushMeshFileInboxSnapshot {
  return snapshot;
}

export function subscribeBushMeshFileInbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bushMeshInboxFilePreview(
  file: BushMeshInboxFile,
  maxCharacters = 600,
): string | null {
  if (
    file.contentType !== BushMeshFileContentType.Text &&
    file.contentType !== BushMeshFileContentType.Json &&
    file.contentType !== BushMeshFileContentType.Configuration &&
    file.contentType !== BushMeshFileContentType.ContactCard
  ) {
    return null;
  }

  const text = Buffer.from(file.data).toString('utf8');
  return text.length > maxCharacters
    ? `${text.slice(0, maxCharacters)}…`
    : text;
}

void hydrateBushMeshFileInbox();
