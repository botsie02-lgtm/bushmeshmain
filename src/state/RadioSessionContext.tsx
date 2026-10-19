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
  BushMeshRadioSessionSnapshot,
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
  queueDriverAction: (input: QueueDriverActionInput) => BushMeshOutboxEntry;
  drainOnce: () => Promise<TransmissionAttemptResult>;
};

const RadioSessionContext = createContext<RadioSessionContextValue | null>(null);
const OUTBOX_DRAIN_INTERVAL_MS = 1_000;

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

  useEffect(() => {
    const refresh = () => {
      setSnapshot(bushMeshRadioSession.getSnapshot());
      setOutbox(bushMeshRadioSession.listOutbox());
    };

    refresh();
    return bushMeshRadioSession.subscribe(refresh);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const current = bushMeshRadioSession.getSnapshot();
      if (!current.transportReady || current.queuedCount === 0) {
        return;
      }

      void bushMeshRadioSession.drainOnce();
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

  const drainOnce = useCallback(async (): Promise<TransmissionAttemptResult> => {
    return bushMeshRadioSession.drainOnce();
  }, []);

  const value = useMemo<RadioSessionContextValue>(
    () => ({snapshot, outbox, queueDriverAction, drainOnce}),
    [snapshot, outbox, queueDriverAction, drainOnce],
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
