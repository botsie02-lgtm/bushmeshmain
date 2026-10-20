import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {decodeBushMeshMeshCoreFrame} from '../bushmesh/meshcoreBridge';
import {BushMeshOutboxEntry} from '../bushmesh/outbox';
import {BushMeshQuickActionCode} from '../bushmesh/protocol';
import {parseMeshCoreChannelDataFrame} from '../meshcore/meshcoreChannelData';
import {base64ToBytes} from '../meshcore/meshcorePackets';
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
import {useBushMesh} from './BushMeshContext';

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

/**
 * A sticky Android radio service may be draining the encrypted outbox after JS
 * process death. An explicit start without a new address tells the service that
 * the foreground process is back; Android preserves native GATT ownership but
 * stops its recovery worker before JS reads or writes the same outbox.
 */
async function yieldNativeRecoveryToForeground(): Promise<NativeRadioServiceStatus> {
  const current = await nativeRadioService.getStatus();
  if (
    current.ownership === 'native-service' &&
    current.radioRequested === true
  ) {
    await nativeRadioService.start(current.deviceLabel ?? null);
    return nativeRadioService.getStatus();
  }
  return current;
}

async function replayBackgroundInbox(): Promise<{
  replayed: number;
  skipped: number;
}> {
  if (!nativeRadioService.isSupported()) {
    return {replayed: 0, skipped: 0};
  }

  const recoveredFrames = await nativeRadioService.drainBackgroundInbox(128);
  let replayed = 0;
  let skipped = 0;

  for (const recovered of recoveredFrames) {
    try {
      const bytes = base64ToBytes(recovered.frameBase64);
      const frame = parseMeshCoreChannelDataFrame(bytes);
      if (!frame) {
        skipped += 1;
        continue;
      }

      const message = decodeBushMeshMeshCoreFrame(frame, {
        receivedAtMs: recovered.receivedAtMs,
        source: 'background-replay',
      });

      if (message) {
        replayed += 1;
      } else {
        skipped += 1;
      }
    } catch {
      // Native capture validates the surrounding MeshCore frame, but foreground
      // protocol decoding may still reject a future/unknown Bushmesh payload.
      // One unsupported frame must never block outbox recovery or other inbox
      // entries from replaying.
      skipped += 1;
    }
  }

  return {replayed, skipped};
}

export function RadioSessionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {setConnectionStatus} = useBushMesh();
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
    setConnectionStatus(snapshot.transportReady ? 'Connected' : 'Disconnected');
  }, [snapshot.transportReady, setConnectionStatus]);

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
        // Establish foreground ownership of persistence before loading. The
        // native module claims a newer generation lease synchronously before it
        // dispatches the service intent, so the recovery worker cannot mutate
        // the encrypted queue after this call returns.
        if (nativeRadioService.isSupported()) {
          const status = await yieldNativeRecoveryToForeground();
          if (active) {
            setNativeRuntime(status);
          }

          try {
            const replay = await replayBackgroundInbox();
            if (active && replay.skipped > 0) {
              setNativeRuntimeError(
                `${replay.skipped} background Bushmesh frame${
                  replay.skipped === 1 ? '' : 's'
                } could not be replayed by the current protocol.`,
              );
            }
          } catch (inboxError) {
            if (active) {
              setNativeRuntimeError(
                inboxError instanceof Error
                  ? `Background Bushmesh inbox could not be replayed: ${inboxError.message}`
                  : 'Background Bushmesh inbox could not be replayed.',
              );
            }
          }
        }

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
      } catch (restoreError) {
        const restoreMessage =
          restoreError instanceof Error
            ? restoreError.message
            : 'Encrypted Bushmesh outbox could not be restored.';

        try {
          await androidBushMeshPersistence.resetSecureStorage();
          persistenceReadyRef.current = true;
          if (active) {
            setPersistenceStatus('ready');
            setPersistenceError(
              `Previous pending radio traffic could not be authenticated and was discarded. Secure outbox storage was re-keyed and is ready for new traffic. ${restoreMessage}`,
            );
          }
        } catch (resetError) {
          persistenceReadyRef.current = true;
          if (active) {
            setPersistenceStatus('error');
            setPersistenceError(
              resetError instanceof Error
                ? `Encrypted outbox restore failed (${restoreMessage}) and secure storage could not be reinitialized: ${resetError.message}`
                : `Encrypted outbox restore failed (${restoreMessage}) and secure storage could not be reinitialized.`,
            );
          }
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
        let status: NativeRadioServiceStatus;

        if (snapshot.runtimeRequested) {
          await nativeRadioService.start(null);
          status = await nativeRadioService.getStatus();
        } else {
          const existing = await nativeRadioService.getStatus();
          if (
            existing.ownership === 'native-service' &&
            existing.radioRequested === true
          ) {
            // Native ownership can legitimately outlive the JS session. Preserve
            // the Android GATT target instead of interpreting an empty JS owner
            // set as a request to disconnect the radio.
            await nativeRadioService.start(existing.deviceLabel ?? null);
            status = await nativeRadioService.getStatus();
          } else {
            await nativeRadioService.stop();
            status = await nativeRadioService.getStatus();
          }
        }

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
  }, [snapshot.runtimeRequested]);

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
