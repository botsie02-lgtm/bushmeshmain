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
import {useConvoy} from './ConvoyContext';

const SELF_FORMATION_ID = '__bushmesh_self__';

type FormationMemberRef = {
  id: string;
  kind: ConvoyFormationMember['kind'];
};

type ConvoyFormationContextValue = {
  configured: boolean;
  members: ConvoyFormationMember[];
  snapshot: ConvoyFormationSnapshot;
  startDraftFormation: () => void;
  clearFormation: () => void;
  moveMember: (id: string, direction: 'up' | 'down') => void;
  removeMember: (id: string) => void;
  addVehicle: (vehicleId: string) => void;
};

const ConvoyFormationContext = createContext<ConvoyFormationContextValue | null>(
  null,
);

export function ConvoyFormationProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {vehicles, localPosition} = useConvoy();
  const [memberRefs, setMemberRefs] = useState<FormationMemberRef[]>([]);
  const [configured, setConfigured] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

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
          cautionGapMeters: 600,
          criticalGapMeters: 1_000,
        },
        localPosition,
        vehicles,
        nowMs,
      ),
    [localPosition, members, nowMs, vehicles],
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

  const value = useMemo<ConvoyFormationContextValue>(
    () => ({
      configured,
      members,
      snapshot,
      startDraftFormation,
      clearFormation,
      moveMember,
      removeMember,
      addVehicle,
    }),
    [
      configured,
      members,
      snapshot,
      startDraftFormation,
      clearFormation,
      moveMember,
      removeMember,
      addVehicle,
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
