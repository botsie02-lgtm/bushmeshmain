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
  NativeMeshCoreOwnershipState,
  nativeMeshCoreSessionCoordinator,
} from '../meshcore/NativeMeshCoreSessionCoordinator';
import {parseMeshCoreChannelDataFrame} from '../meshcore/meshcoreChannelData';
import {meshCoreFrameToReceivedDatagram} from '../meshcore/MeshCoreReceivedDatagramAdapter';
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
import {publishReceivedDatagram} from '../radio/ReceivedDatagram';
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

export type RadioSessionNativeLifecycleDecision =
  | 'observe-native-owner'
  | 'start-react-native-session'
  | 'stop-react-native-session';

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

type RadioSessionNativeLifecycleService = Pick<
  typeof nativeRadioService,
  'getStatus' | 'start' | 'stop'
>;

type RadioSessionNativeLifecycleCoordinator = Pick<
  typeof nativeMeshCoreSessionCoordinator,
  'getSnapshot'
>;

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
 * Native MeshCore ownership is commanded exclusively by the application radio
 * ownership layer and NativeMeshCoreSessionCoordinator. RadioSessionProvider
 * only owns the legacy React-Native-session keepalive. A non-idle coordinator,
 * native-service status, live native target, or persisted native target is an
 * Android-native ownership reservation. Treating those states as observation
 * only closes takeover/shutdown races and preserves sticky process recovery
 * while Android restores its service state.
 */
export function decideRadioSessionNativeLifecycle(
  runtimeRequested: boolean,
  status: NativeRadioServiceStatus,
  coordinatorState: NativeMeshCoreOwnershipState,
): RadioSessionNativeLifecycleDecision {
  if (
    coordinatorState !== 'idle' ||
    status.ownership === 'native-service' ||
    status.persistedNativeTargetPresent === true ||
    status.deviceAddress != null ||
    status.nativeBleDeviceAddress != null
  ) {
    return 'observe-native-owner';
  }

  return runtimeRequested
    ? 'start-react-native-session'
    : 'stop-react-native-session';
}

/**
 * Synchronizes only the legacy React-Native-owned service lifecycle. Android
 * native-service ownership is observation-only here; start/stop/target/reconnect
 * authority belongs to AppRadioConnectionService + NativeMeshCoreSessionCoordinator.
 */
export async function syncNativeRuntimeForRadioSessionProvider(
  runtimeRequested: boolean,
  service: RadioSessionNativeLifecycleService = nativeRadioService,
  coordinator: RadioSessionNativeLifecycleCoordinator =
    nativeMeshCoreSessionCoordinator,
): Promise<NativeRadioServiceStatus> {
  const existing = await service.getStatus();
  const decision = decideRadioSessionNativeLifecycle(
    runtimeRequested,
    existing,
    coordinator.getSnapshot().state,
  );

  if (decision === 'observe-native-owner') {
    return existing;
  }

  if (decision === 'start-react-native-session') {
    await service.start(null);
  } else {
    await service.stop();
  }

  return service.getStatus();
}

/**
 * Replays Android-captured MeshCore channel data into the neutral inbound
 * datagram bus. Protocol/runtime subscribers decide whether the payload belongs
 * to BushMesh and how it should be decoded.
 */
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

      publishReceivedDatagram(
        meshCoreFrameToReceivedDatagram(frame, {
          receivedAtMs: recovered.receivedAtMs,
          source: 'background-replay',
          radioIdentityRef: bushMeshRadioSession.getSnapshot().identityRef,
          diagnosticLabel: 'meshcore-background-inbox',
        }),
      );
      replayed += 1;
    } catch {
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
        if (nativeRadioService.isSupported()) {
          // Process/background recovery is owned by Android. Foreground React
          // only observes the recovered native owner and replays its inbox; it
          // must not send START merely because a persisted target exists.
          const status = await nativeRadioService.getStatus();
          if (active) {
            setNativeRuntime(status);
          }

          try {
            const replay = await replayBackgroundInbox();
            if (active && replay.skipped > 0) {
              setNativeRuntimeError(
                `${replay.skipped} background radio datagram${
                  replay.skipped === 1 ? '' : 's'
                } could not be restored into the inbound runtime seam.`,
              );
            }
          } catch (inboxError) {
            if (active) {
              setNativeRuntimeError(
                inboxError instanceof Error
                  ? `Background radio inbox could not be replayed: ${inboxError.message}`
                  : 'Background radio inbox could not be replayed.',
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
        const status = await syncNativeRuntimeForRadioSessionProvider(
          snapshot.runtimeRequested,
        );

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
