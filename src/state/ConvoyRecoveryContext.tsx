import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {ConvoyFreshness, getConvoyFreshness} from '../convoy/convoy';
import {
  ConvoyRecoveryCase,
  prioritizeConvoyRecoveryCases,
} from '../convoy/recoveryPriority';
import {useConvoy} from './ConvoyContext';

export type ConvoyRecoveryEventType = 'stale' | 'lost' | 'reacquired';

export type ConvoyRecoveryEvent = {
  id: string;
  type: ConvoyRecoveryEventType;
  vehicleId: string;
  vehicleName: string;
  occurredAtMs: number;
  positionReceivedAtMs: number;
  previousFreshness: ConvoyFreshness | null;
  currentFreshness: ConvoyFreshness;
};

type ConvoyRecoveryContextValue = {
  activeCases: ConvoyRecoveryCase[];
  events: ConvoyRecoveryEvent[];
  latestReacquired: ConvoyRecoveryEvent | null;
  acknowledgeReacquired: (eventId: string) => void;
  clearRecoveryHistory: () => void;
};

const ConvoyRecoveryContext = createContext<ConvoyRecoveryContextValue | null>(null);
const MAX_RECOVERY_EVENTS = 100;

function severity(freshness: ConvoyFreshness): number {
  switch (freshness) {
    case 'live':
      return 0;
    case 'recent':
      return 1;
    case 'stale':
      return 2;
    case 'lost':
      return 3;
  }
}

export function ConvoyRecoveryProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {vehicles, buddyTails} = useConvoy();
  const [nowMs, setNowMs] = useState(Date.now());
  const [events, setEvents] = useState<ConvoyRecoveryEvent[]>([]);
  const [acknowledgedReacquiredIds, setAcknowledgedReacquiredIds] = useState<
    Set<string>
  >(() => new Set());
  const previousFreshnessRef = useRef<Map<string, ConvoyFreshness>>(new Map());
  const previousReceivedAtRef = useRef<Map<string, number>>(new Map());
  const initializedRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const nextFreshness = new Map<string, ConvoyFreshness>();
    const nextReceivedAt = new Map<string, number>();
    const newEvents: ConvoyRecoveryEvent[] = [];

    vehicles.forEach(vehicle => {
      const currentFreshness = getConvoyFreshness(vehicle.receivedAtMs, nowMs);
      const previousFreshness = previousFreshnessRef.current.get(vehicle.id) ?? null;
      const previousReceivedAt = previousReceivedAtRef.current.get(vehicle.id);
      const hasNewFix =
        previousReceivedAt !== undefined && vehicle.receivedAtMs > previousReceivedAt;

      if (initializedRef.current && previousFreshness) {
        if (
          severity(currentFreshness) > severity(previousFreshness) &&
          (currentFreshness === 'stale' || currentFreshness === 'lost')
        ) {
          newEvents.push({
            id: `${vehicle.id}:${currentFreshness}:${vehicle.receivedAtMs}`,
            type: currentFreshness,
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            occurredAtMs: nowMs,
            positionReceivedAtMs: vehicle.receivedAtMs,
            previousFreshness,
            currentFreshness,
          });
        } else if (
          (previousFreshness === 'stale' || previousFreshness === 'lost') &&
          (currentFreshness === 'live' || currentFreshness === 'recent') &&
          hasNewFix
        ) {
          newEvents.push({
            id: `${vehicle.id}:reacquired:${vehicle.receivedAtMs}`,
            type: 'reacquired',
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            occurredAtMs: nowMs,
            positionReceivedAtMs: vehicle.receivedAtMs,
            previousFreshness,
            currentFreshness,
          });
        }
      }

      nextFreshness.set(vehicle.id, currentFreshness);
      nextReceivedAt.set(vehicle.id, vehicle.receivedAtMs);
    });

    previousFreshnessRef.current = nextFreshness;
    previousReceivedAtRef.current = nextReceivedAt;
    initializedRef.current = true;

    if (newEvents.length > 0) {
      setEvents(current => {
        const existingIds = new Set(current.map(event => event.id));
        const unique = newEvents.filter(event => !existingIds.has(event.id));
        if (unique.length === 0) {
          return current;
        }
        return [...unique.reverse(), ...current].slice(0, MAX_RECOVERY_EVENTS);
      });
    }
  }, [nowMs, vehicles]);

  const activeCases = useMemo(
    () => prioritizeConvoyRecoveryCases(vehicles, buddyTails, nowMs),
    [vehicles, buddyTails, nowMs],
  );

  const latestReacquired = useMemo(
    () =>
      events.find(
        event =>
          event.type === 'reacquired' &&
          !acknowledgedReacquiredIds.has(event.id) &&
          nowMs - event.occurredAtMs <= 45_000,
      ) ?? null,
    [acknowledgedReacquiredIds, events, nowMs],
  );

  const acknowledgeReacquired = useCallback((eventId: string) => {
    setAcknowledgedReacquiredIds(current => {
      const next = new Set(current);
      next.add(eventId);
      return next;
    });
  }, []);

  const clearRecoveryHistory = useCallback(() => {
    setEvents([]);
    setAcknowledgedReacquiredIds(new Set());
  }, []);

  const value = useMemo<ConvoyRecoveryContextValue>(
    () => ({
      activeCases,
      events,
      latestReacquired,
      acknowledgeReacquired,
      clearRecoveryHistory,
    }),
    [
      activeCases,
      events,
      latestReacquired,
      acknowledgeReacquired,
      clearRecoveryHistory,
    ],
  );

  return (
    <ConvoyRecoveryContext.Provider value={value}>
      {children}
    </ConvoyRecoveryContext.Provider>
  );
}

export function useConvoyRecovery(): ConvoyRecoveryContextValue {
  const context = useContext(ConvoyRecoveryContext);
  if (!context) {
    throw new Error('useConvoyRecovery must be used inside ConvoyRecoveryProvider');
  }
  return context;
}
