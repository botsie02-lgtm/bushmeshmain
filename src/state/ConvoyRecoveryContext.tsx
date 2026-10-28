import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ConvoyFreshness,
  Coordinate,
  distanceMeters,
  getConvoyFreshness,
} from '../convoy/convoy';
import {
  ConvoyRecoveryCase,
  prioritizeConvoyRecoveryCases,
} from '../convoy/recoveryPriority';
import {useConvoy} from './ConvoyContext';

export type ConvoyRecoveryEventType = 'stale' | 'lost' | 'reacquired';

export type ConvoyRecoveryPositionSnapshot = Coordinate & {
  receivedAtMs: number;
  accuracyMeters: number | null;
  snrDb: number | null;
  pathLength: number | null;
};

export type ConvoyRecoveryEvent = {
  id: string;
  type: ConvoyRecoveryEventType;
  vehicleId: string;
  vehicleName: string;
  occurredAtMs: number;
  positionReceivedAtMs: number;
  previousFreshness: ConvoyFreshness | null;
  currentFreshness: ConvoyFreshness;
  position: ConvoyRecoveryPositionSnapshot;
};

export type ConvoyRecoveryIncident = {
  id: string;
  vehicleId: string;
  vehicleName: string;
  status: 'active' | 'recovered';
  startedAtMs: number;
  escalatedToLostAtMs: number | null;
  resolvedAtMs: number | null;
  durationMs: number | null;
  worstState: 'stale' | 'lost';
  eventIds: string[];
  lastKnown: ConvoyRecoveryPositionSnapshot;
  reacquired: ConvoyRecoveryPositionSnapshot | null;
  reacquisitionOffsetMeters: number | null;
};

type ConvoyRecoveryContextValue = {
  activeCases: ConvoyRecoveryCase[];
  events: ConvoyRecoveryEvent[];
  incidents: ConvoyRecoveryIncident[];
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

function buildRecoveryIncidents(
  events: ConvoyRecoveryEvent[],
): ConvoyRecoveryIncident[] {
  const chronological = [...events].sort(
    (left, right) => left.occurredAtMs - right.occurredAtMs,
  );
  const activeByVehicle = new Map<string, ConvoyRecoveryIncident>();
  const completed: ConvoyRecoveryIncident[] = [];

  chronological.forEach(event => {
    if (event.type === 'stale' || event.type === 'lost') {
      let incident = activeByVehicle.get(event.vehicleId);
      if (!incident) {
        incident = {
          id: `incident:${event.vehicleId}:${event.occurredAtMs}`,
          vehicleId: event.vehicleId,
          vehicleName: event.vehicleName,
          status: 'active',
          startedAtMs: event.occurredAtMs,
          escalatedToLostAtMs: event.type === 'lost' ? event.occurredAtMs : null,
          resolvedAtMs: null,
          durationMs: null,
          worstState: event.type,
          eventIds: [event.id],
          lastKnown: event.position,
          reacquired: null,
          reacquisitionOffsetMeters: null,
        };
        activeByVehicle.set(event.vehicleId, incident);
        return;
      }

      incident.vehicleName = event.vehicleName;
      incident.eventIds.push(event.id);
      incident.lastKnown = event.position;
      if (event.type === 'lost') {
        incident.worstState = 'lost';
        incident.escalatedToLostAtMs ??= event.occurredAtMs;
      }
      return;
    }

    const incident = activeByVehicle.get(event.vehicleId);
    if (!incident) {
      return;
    }

    incident.vehicleName = event.vehicleName;
    incident.eventIds.push(event.id);
    incident.status = 'recovered';
    incident.resolvedAtMs = event.occurredAtMs;
    incident.durationMs = Math.max(0, event.occurredAtMs - incident.startedAtMs);
    incident.reacquired = event.position;
    incident.reacquisitionOffsetMeters = distanceMeters(
      incident.lastKnown,
      event.position,
    );
    completed.push(incident);
    activeByVehicle.delete(event.vehicleId);
  });

  return [...activeByVehicle.values(), ...completed].sort((left, right) => {
    const leftTime = left.resolvedAtMs ?? left.startedAtMs;
    const rightTime = right.resolvedAtMs ?? right.startedAtMs;
    return rightTime - leftTime;
  });
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
      const position: ConvoyRecoveryPositionSnapshot = {
        latitude: vehicle.latitude,
        longitude: vehicle.longitude,
        receivedAtMs: vehicle.receivedAtMs,
        accuracyMeters: vehicle.accuracyMeters,
        snrDb: vehicle.snrDb,
        pathLength: vehicle.pathLength,
      };

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
            position,
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
            position,
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

  const incidents = useMemo(() => buildRecoveryIncidents(events), [events]);

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
      incidents,
      latestReacquired,
      acknowledgeReacquired,
      clearRecoveryHistory,
    }),
    [
      activeCases,
      events,
      incidents,
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
