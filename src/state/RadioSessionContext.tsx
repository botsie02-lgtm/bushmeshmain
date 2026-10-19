import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {BushMeshOutboxEntry} from '../bushmesh/outbox';
import {BushMeshQuickActionCode} from '../bushmesh/protocol';
import {
  NativeRadioServiceStatus,
  nativeRadioService,
} from '../native/NativeRadioService';
import {androidBushMeshPersistence} from '../persistence/AndroidBushMeshPersistence';
import {
  createOutboxSnapshot,
  restoreOutboxSnapshot,
} from '../persistence/outboxSnapshot';
import {
  BushMeshRadioSessionSnapshot,
  QueuePositionInput,
  bushMeshRadioSession,
} from '../radio/BushMeshRadioSession';
import {TransmissionAttemptResult} from '../radio/BushMeshTransmissionController';

type QueueDriverActionInput = {
  channelIndex: number;
  sequence: number;
  action: BushMeshQuickActionCode;
  latitude?: number | null;
  longitude?: number | null;
  ttlSeconds?: number;
  flags?: number;
};

export type OutboxPersistenceStatus =
  | 'restoring'
  | 'ready'
  | 'unsupported'
  | 'error';

type RadioSessionContextValue = {
  snapshot: BushMeshRadioSessionSnapshot;
  outbox: BushMeshOutboxEntry[];
  nativeRuntime: NativeRadioServiceStatus;
  nativeRuntimeError: string | null;
  persistenceStatus: OutboxPersistenceStatus;
  persistenceError: string | null;
  queueDriverAction: (input: QueueDriverActionInput) => BushMeshOutboxEntry;
  queuePosition: (input: QueuePositionInput) => BushMeshOutboxEntry;
  drainOnce: () => Promise<TransmissionAttemptResult>;
};

const RadioSessionContext = createContext<RadioSessionContextValue | null>(null);
const OUTBOX_DRAIN_INTERVAL_MS = 1_000;

const initialNativeRuntime: NativeRadioServiceStatus = {
  running: false,
  deviceLabel: null,
  startedAtMs: 0,
  ownership: 'unknown',
};

function activeEntriesForPersistence(
  entries: BushMeshOutboxEntry[],
): BushMeshOutboxEntry[] {
  return entries.filter(
    entry => entry.state === 'queued' || entry.state === 'inflight',
  );
}

export function RadioSessionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<BushMeshRadioSessionSnapshot>(() =>
    bushMeshRadioSession.getSnapshot(),
  );
  const [outbox, setOutbox] = useState<BushMeshOutboxEntry[]>(() =>
    bushMeshRadioSession.listOutbox(),
  );
  const [nativeRuntime, setNativeRuntime] = useState<NativeRadioServiceStatus>(
    initialNativeRuntime,
  );
  const [nativeRuntimeError, setNativeRuntimeError] = useState<string | null>(
    null,
  );
  const [persistenceStatus, setPersistenceStatus] =
    useState<OutboxPersistenceStatus>(() =>
      androidBushMeshPersistence.isSupported() ? 'restoring' : 'unsupported',
    );
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const persistenceReadyRef = useRef(
    !androidBushMeshPersistence.isSupported(),
  );
  const persistenceWriteChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const refresh = () => {
      setSnapshot(bushMeshRadioSession.getSnapshot());
      setOutbox(bushMeshRadioSession.listOutbox());
    };

    refresh();
    return bushMeshRadioSession.subscribe(refresh);
  }, []);

  useEffect(() => {
    let active = true;

    const restorePersistedOutbox = async () => {
      if (!androidBushMeshPersistence.isSupported()) {
        persistenceReadyRef.current = true;
        if (active) {
          setPersistenceStatus('unsupported');
          setPersistenceError(null);
        }
        return;
      }

      try {
        const snapshotToRestore = await androidBushMeshPersistence.loadOutbox();
        if (snapshotToRestore) {
          const restoredEntries = restoreOutboxSnapshot(
            snapshotToRestore,
            Date.now(),
          );
          bushMeshRadioSession.restoreOutbox(restoredEntries);
        }

        persistenceReadyRef.current = true;
        if (active) {
          setPersistenceStatus('ready');
          setPersistenceError(null);
        }
      } catch (error) {
        // A corrupt/unreadable queue must not deadlock the live radio forever.
        // Surface the failure, leave the runtime queue untouched, and permit new
        // traffic to proceed rather than silently inventing recovered packets.
        persistenceReadyRef.current = true;
        if (active) {
          setPersistenceStatus('error');
          setPersistenceError(
            error instanceof Error
              ? error.message
              : 'Encrypted Bushmesh outbox could not be restored.',
          );
        }
      }
    };

    restorePersistedOutbox().catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const syncNativeRuntime = async () => {
      try {
        if (snapshot.transportReady) {
          await nativeRadioService.start(null);
        } else {
          await nativeRadioService.stop();
        }

        const status = await nativeRadioService.getStatus();
        if (active) {
          setNativeRuntime(status);
          setNativeRuntimeError(null);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setNativeRuntimeError(
          error instanceof Error
            ? error.message
            : 'Android foreground radio runtime could not be updated.',
        );
      }
    };

    syncNativeRuntime().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [snapshot.transportReady]);

  useEffect(() => {
    if (
      persistenceStatus !== 'ready' ||
      !androidBushMeshPersistence.isSupported()
    ) {
      return;
    }

    const entriesToPersist = activeEntriesForPersistence(outbox);
    persistenceWriteChainRef.current = persistenceWriteChainRef.current
      .then(async () => {
        if (entriesToPersist.length === 0) {
          await androidBushMeshPersistence.clearOutbox();
          return;
        }

        await androidBushMeshPersistence.saveOutbox(
          createOutboxSnapshot(entriesToPersist, Date.now()),
        );
      })
      .catch(error => {
        setPersistenceError(
          error instanceof Error
            ? error.message
            : 'Encrypted Bushmesh outbox could not be saved.',
        );
      });
  }, [outbox, persistenceStatus]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!persistenceReadyRef.current) {
        return;
      }

      const current = bushMeshRadioSession.getSnapshot();
      if (!current.transportReady || current.queuedCount === 0) {
        return;
      }

      bushMeshRadioSession.drainOnce().catch(() => undefined);
    }, OUTBOX_DRAIN_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  const queueDriverAction = useCallback(
    (input: QueueDriverActionInput): BushMeshOutboxEntry => {
      return bushMeshRadioSession.queueQuickAction({
        ...input,
        timestampSeconds: Math.floor(Date.now() / 1000),
      });
    },
    [],
  );

  const queuePosition = useCallback(
    (input: QueuePositionInput): BushMeshOutboxEntry => {
      return bushMeshRadioSession.queuePosition(input);
    },
    [],
  );

  const drainOnce = useCallback(async (): Promise<TransmissionAttemptResult> => {
    if (!persistenceReadyRef.current) {
      return {entry: null, outcome: 'idle'};
    }
    return bushMeshRadioSession.drainOnce();
  }, []);

  const value = useMemo<RadioSessionContextValue>(
    () => ({
      snapshot,
      outbox,
      nativeRuntime,
      nativeRuntimeError,
      persistenceStatus,
      persistenceError,
      queueDriverAction,
      queuePosition,
      drainOnce,
    }),
    [
      snapshot,
      outbox,
      nativeRuntime,
      nativeRuntimeError,
      persistenceStatus,
      persistenceError,
      queueDriverAction,
      queuePosition,
      drainOnce,
    ],
  );

  return (
    <RadioSessionContext.Provider value={value}>
      {children}
    </RadioSessionContext.Provider>
  );
}

export function useRadioSession(): RadioSessionContextValue {
  const context = useContext(RadioSessionContext);
  if (!context) {
    throw new Error('useRadioSession must be used inside RadioSessionProvider');
  }
  return context;
}
