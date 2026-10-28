import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ConvoyFormationMember,
  ConvoyFormationSnapshot,
  evaluateConvoyFormation,
} from '../convoy/formation';
import {androidFormationPersistence} from '../persistence/AndroidFormationPersistence';
import {
  createFormationSnapshot,
  decodeFormationSnapshot,
  encodeFormationSnapshot,
} from '../persistence/formationSnapshot';
import {useConvoy} from './ConvoyContext';

const SELF_FORMATION_ID = '__bushmesh_self__';
const DEFAULT_CAUTION_GAP_METERS = 600;
const DEFAULT_CRITICAL_GAP_METERS = 1_000;
const SAVE_DEBOUNCE_MS = 250;

export type ConvoyFormationPersistenceStatus =
  | 'loading'
  | 'ready'
  | 'unsupported'
  | 'error';

type FormationMemberRef = {
  id: string;
  kind: ConvoyFormationMember['kind'];
};

type ConvoyFormationContextValue = {
  configured: boolean;
  members: ConvoyFormationMember[];
  snapshot: ConvoyFormationSnapshot;
  cautionGapMeters: number;
  criticalGapMeters: number;
  persistenceStatus: ConvoyFormationPersistenceStatus;
  persistenceError: string | null;
  startDraftFormation: () => void;
  clearFormation: () => void;
  moveMember: (id: string, direction: 'up' | 'down') => void;
  removeMember: (id: string) => void;
  addVehicle: (vehicleId: string) => void;
  setGapThresholds: (cautionMeters: number, criticalMeters: number) => void;
  resetFormationStorage: () => Promise<void>;
};

const ConvoyFormationContext = createContext<ConvoyFormationContextValue | null>(
  null,
);

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Bushmesh could not access encrypted convoy formation storage.';
}

export function ConvoyFormationProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {vehicles, localPosition} = useConvoy();
  const [memberRefs, setMemberRefs] = useState<FormationMemberRef[]>([]);
  const [configured, setConfigured] = useState(false);
  const [cautionGapMeters, setCautionGapMeters] = useState(
    DEFAULT_CAUTION_GAP_METERS,
  );
  const [criticalGapMeters, setCriticalGapMeters] = useState(
    DEFAULT_CRITICAL_GAP_METERS,
  );
  const [persistenceStatus, setPersistenceStatus] =
    useState<ConvoyFormationPersistenceStatus>(
      androidFormationPersistence.supported ? 'loading' : 'unsupported',
    );
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!androidFormationPersistence.supported) {
      setPersistenceStatus('unsupported');
      return;
    }

    let cancelled = false;
    setPersistenceStatus('loading');
    setPersistenceError(null);

    androidFormationPersistence
      .load()
      .then(serialized => {
        if (cancelled) {
          return;
        }
        if (serialized === null) {
          setPersistenceStatus('ready');
          return;
        }

        const restored = decodeFormationSnapshot(serialized);
        setConfigured(restored.configured);
        setMemberRefs(restored.members.map(member => ({...member})));
        setCautionGapMeters(restored.cautionGapMeters);
        setCriticalGapMeters(restored.criticalGapMeters);
        setPersistenceStatus('ready');
      })
      .catch(error => {
        if (cancelled) {
          return;
        }
        setPersistenceError(errorMessage(error));
        setPersistenceStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      persistenceStatus !== 'ready' ||
      !androidFormationPersistence.supported
    ) {
      return;
    }

    const timer = setTimeout(() => {
      try {
        const serialized = encodeFormationSnapshot(
          createFormationSnapshot({
            configured,
            members: memberRefs,
            cautionGapMeters,
            criticalGapMeters,
          }),
        );

        androidFormationPersistence.save(serialized).catch(error => {
          setPersistenceError(errorMessage(error));
          setPersistenceStatus('error');
        });
      } catch (error) {
        setPersistenceError(errorMessage(error));
        setPersistenceStatus('error');
      }
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    cautionGapMeters,
    configured,
    criticalGapMeters,
    memberRefs,
    persistenceStatus,
  ]);

  const vehicleById = useMemo(
    () => new Map(vehicles.map(vehicle => [vehicle.id, vehicle])),
    [vehicles],
  );

  const members = useMemo<ConvoyFormationMember[]>(
    () =>
      memberRefs.map(ref => ({
        id: ref.id,
        kind: ref.kind,
        label:
          ref.kind === 'self'
            ? 'You'
            : vehicleById.get(ref.id)?.name ?? `Vehicle ${ref.id.slice(-4)}`,
      })),
    [memberRefs, vehicleById],
  );

  const snapshot = useMemo(
    () =>
      evaluateConvoyFormation(
        {
          members,
          cautionGapMeters,
          criticalGapMeters,
        },
        localPosition,
        vehicles,
        nowMs,
      ),
    [
      cautionGapMeters,
      criticalGapMeters,
      localPosition,
      members,
      nowMs,
      vehicles,
    ],
  );

  const startDraftFormation = useCallback(() => {
    const remoteRefs = [...vehicles]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(vehicle => ({id: vehicle.id, kind: 'vehicle' as const}));
    setMemberRefs([
      {id: SELF_FORMATION_ID, kind: 'self'},
      ...remoteRefs,
    ]);
    setConfigured(true);
  }, [vehicles]);

  const clearFormation = useCallback(() => {
    setMemberRefs([]);
    setConfigured(false);
    setCautionGapMeters(DEFAULT_CAUTION_GAP_METERS);
    setCriticalGapMeters(DEFAULT_CRITICAL_GAP_METERS);
  }, []);

  const moveMember = useCallback((id: string, direction: 'up' | 'down') => {
    setMemberRefs(current => {
      const index = current.findIndex(member => member.id === id);
      if (index < 0) {
        return current;
      }
      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }, []);

  const removeMember = useCallback((id: string) => {
    setMemberRefs(current => current.filter(member => member.id !== id));
  }, []);

  const addVehicle = useCallback(
    (vehicleId: string) => {
      if (!vehicleById.has(vehicleId)) {
        return;
      }
      setMemberRefs(current => {
        if (current.some(member => member.id === vehicleId)) {
          return current;
        }
        return [...current, {id: vehicleId, kind: 'vehicle'}];
      });
      setConfigured(true);
    },
    [vehicleById],
  );

  const setGapThresholds = useCallback(
    (cautionMeters: number, criticalMeters: number) => {
      if (
        !Number.isFinite(cautionMeters) ||
        cautionMeters <= 0 ||
        !Number.isFinite(criticalMeters) ||
        criticalMeters <= cautionMeters
      ) {
        throw new Error(
          'Formation critical gap must be greater than a positive caution gap.',
        );
      }
      setCautionGapMeters(cautionMeters);
      setCriticalGapMeters(criticalMeters);
    },
    [],
  );

  const resetFormationStorage = useCallback(async () => {
    if (!androidFormationPersistence.supported) {
      clearFormation();
      setPersistenceError(null);
      setPersistenceStatus('unsupported');
      return;
    }

    setPersistenceStatus('loading');
    setPersistenceError(null);
    try {
      await androidFormationPersistence.resetUnreadableStorage();
      setMemberRefs([]);
      setConfigured(false);
      setCautionGapMeters(DEFAULT_CAUTION_GAP_METERS);
      setCriticalGapMeters(DEFAULT_CRITICAL_GAP_METERS);
      setPersistenceStatus('ready');
    } catch (error) {
      setPersistenceError(errorMessage(error));
      setPersistenceStatus('error');
      throw error;
    }
  }, [clearFormation]);

  const value = useMemo<ConvoyFormationContextValue>(
    () => ({
      configured,
      members,
      snapshot,
      cautionGapMeters,
      criticalGapMeters,
      persistenceStatus,
      persistenceError,
      startDraftFormation,
      clearFormation,
      moveMember,
      removeMember,
      addVehicle,
      setGapThresholds,
      resetFormationStorage,
    }),
    [
      configured,
      members,
      snapshot,
      cautionGapMeters,
      criticalGapMeters,
      persistenceStatus,
      persistenceError,
      startDraftFormation,
      clearFormation,
      moveMember,
      removeMember,
      addVehicle,
      setGapThresholds,
      resetFormationStorage,
    ],
  );

  return (
    <ConvoyFormationContext.Provider value={value}>
      {children}
    </ConvoyFormationContext.Provider>
  );
}

export function useConvoyFormation(): ConvoyFormationContextValue {
  const context = useContext(ConvoyFormationContext);
  if (!context) {
    throw new Error('useConvoyFormation must be used inside ConvoyFormationProvider');
  }
  return context;
}
