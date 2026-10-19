import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {BushMeshOutboxEntry} from '../bushmesh/outbox';
import {BushMeshQuickActionCode} from '../bushmesh/protocol';
import {
  NativeRadioServiceStatus,
  nativeRadioService,
} from '../native/NativeRadioService';
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

type RadioSessionContextValue = {
  snapshot: BushMeshRadioSessionSnapshot;
  outbox: BushMeshOutboxEntry[];
  nativeRuntime: NativeRadioServiceStatus;
  nativeRuntimeError: string | null;
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
    const timer = setInterval(() => {
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
    return bushMeshRadioSession.drainOnce();
  }, []);

  const value = useMemo<RadioSessionContextValue>(
    () => ({
      snapshot,
      outbox,
      nativeRuntime,
      nativeRuntimeError,
      queueDriverAction,
      queuePosition,
      drainOnce,
    }),
    [
      snapshot,
      outbox,
      nativeRuntime,
      nativeRuntimeError,
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
