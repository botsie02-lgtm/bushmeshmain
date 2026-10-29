import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {diagnosticIdentityHint} from '../diagnostics/fieldDiagnostics';
import {useBushMesh} from './BushMeshContext';
import {useConvoy} from './ConvoyContext';
import {useConvoyRecovery} from './ConvoyRecoveryContext';
import {useOfflineMaps} from './OfflineMapContext';
import {useRadioSession} from './RadioSessionContext';

export type FieldTraceSeverity = 'info' | 'watch' | 'action';
export type FieldTraceCategory =
  | 'radio'
  | 'location'
  | 'convoy'
  | 'maps'
  | 'persistence'
  | 'test';

export type FieldTestMarker =
  | 'test-start'
  | 'airplane-mode-on'
  | 'airplane-mode-off'
  | 'radio-handoff'
  | 'node-power-cycle'
  | 'test-end';

export type FieldTraceEvent = {
  id: string;
  occurredAtMs: number;
  category: FieldTraceCategory;
  severity: FieldTraceSeverity;
  code: string;
  detail: string;
};

type FieldEventTraceContextValue = {
  events: FieldTraceEvent[];
  addTestMarker: (marker: FieldTestMarker) => void;
  clearTrace: () => void;
};

const FieldEventTraceContext = createContext<FieldEventTraceContextValue | null>(null);
const MAX_TRACE_EVENTS = 80;

const TEST_MARKER_DETAILS: Record<FieldTestMarker, string> = {
  'test-start': 'Operator marked the start of a field verification run.',
  'airplane-mode-on': 'Operator marked airplane mode enabled for an offline verification step.',
  'airplane-mode-off': 'Operator marked airplane mode disabled after an offline verification step.',
  'radio-handoff': 'Operator marked an intentional radio ownership/handoff step.',
  'node-power-cycle': 'Operator marked an intentional MeshCore node power cycle.',
  'test-end': 'Operator marked the end of a field verification run.',
};

function traceId(code: string, nowMs: number): string {
  return `${nowMs}:${code}:${Math.random().toString(16).slice(2, 8)}`;
}

export function FieldEventTraceProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {contactPersistenceStatus, messagePersistenceStatus} = useBushMesh();
  const {localPosition} = useConvoy();
  const {events: recoveryEvents} = useConvoyRecovery();
  const {coverage, mapPersistenceStatus} = useOfflineMaps();
  const {
    snapshot: radio,
    nativeRuntime,
    persistenceStatus: outboxPersistenceStatus,
  } = useRadioSession();
  const [events, setEvents] = useState<FieldTraceEvent[]>([]);

  const previousTransportRef = useRef<boolean | null>(null);
  const previousRuntimeOwnershipRef = useRef<string | null>(null);
  const previousGpsAvailableRef = useRef<boolean | null>(null);
  const previousFailedCountRef = useRef<number | null>(null);
  const previousCoverageRef = useRef<boolean | null>(null);
  const previousPersistenceRef = useRef<Record<string, string>>({});
  const seenRecoveryEventIdsRef = useRef(new Set<string>());

  const append = useCallback(
    (
      category: FieldTraceCategory,
      severity: FieldTraceSeverity,
      code: string,
      detail: string,
      occurredAtMs = Date.now(),
    ) => {
      const event: FieldTraceEvent = {
        id: traceId(code, occurredAtMs),
        occurredAtMs,
        category,
        severity,
        code,
        detail,
      };
      setEvents(current => [event, ...current].slice(0, MAX_TRACE_EVENTS));
    },
    [],
  );

  const addTestMarker = useCallback(
    (marker: FieldTestMarker) => {
      append(
        'test',
        'info',
        `test-marker-${marker}`,
        TEST_MARKER_DETAILS[marker],
      );
    },
    [append],
  );

  useEffect(() => {
    const current = radio.transportReady;
    const previous = previousTransportRef.current;
    previousTransportRef.current = current;
    if (previous === null || previous === current) {
      return;
    }

    append(
      'radio',
      current ? 'info' : radio.runtimeRequested ? 'action' : 'watch',
      current ? 'radio-transport-ready' : 'radio-transport-lost',
      current
        ? `Radio transport became ready${radio.identityRef ? ` for ${diagnosticIdentityHint(radio.identityRef)}` : ''}.`
        : 'Radio transport became unavailable; outbound traffic may remain queued.',
    );
  }, [append, radio.identityRef, radio.runtimeRequested, radio.transportReady]);

  useEffect(() => {
    const current = nativeRuntime.ownership;
    const previous = previousRuntimeOwnershipRef.current;
    previousRuntimeOwnershipRef.current = current;
    if (previous === null || previous === current) {
      return;
    }

    append(
      'radio',
      'info',
      'radio-ownership-changed',
      `Android radio ownership changed from ${previous} to ${current}.`,
    );
  }, [append, nativeRuntime.ownership]);

  useEffect(() => {
    const current = localPosition !== null;
    const previous = previousGpsAvailableRef.current;
    previousGpsAvailableRef.current = current;
    if (previous === null || previous === current) {
      return;
    }

    append(
      'location',
      current ? 'info' : 'watch',
      current ? 'gps-fix-acquired' : 'gps-fix-lost',
      current
        ? 'A local GPS fix became available.'
        : 'The local GPS fix became unavailable; located actions should be held.',
    );
  }, [append, localPosition]);

  useEffect(() => {
    const current = radio.failedCount;
    const previous = previousFailedCountRef.current;
    previousFailedCountRef.current = current;
    if (previous === null || current <= previous) {
      return;
    }

    append(
      'radio',
      'action',
      'outbox-failure-increased',
      `${current - previous} additional outbound entr${current - previous === 1 ? 'y' : 'ies'} exhausted retry handling.`,
    );
  }, [append, radio.failedCount]);

  useEffect(() => {
    if (coverage.totalPointCount === 0) {
      previousCoverageRef.current = null;
      return;
    }

    const current = coverage.complete;
    const previous = previousCoverageRef.current;
    previousCoverageRef.current = current;
    if (previous === null || previous === current) {
      return;
    }

    append(
      'maps',
      current ? 'info' : 'action',
      current ? 'trip-map-coverage-ready' : 'trip-map-coverage-incomplete',
      current
        ? 'Verified offline map coverage now includes every required trip point.'
        : `Verified offline map coverage fell to ${coverage.coveredPointCount}/${coverage.totalPointCount} required trip points.`,
    );
  }, [append, coverage.complete, coverage.coveredPointCount, coverage.totalPointCount]);

  useEffect(() => {
    const current: Record<string, string> = {
      contacts: contactPersistenceStatus,
      messages: messagePersistenceStatus,
      outbox: outboxPersistenceStatus,
      maps: mapPersistenceStatus,
    };

    Object.entries(current).forEach(([key, status]) => {
      const previous = previousPersistenceRef.current[key];
      if (previous !== undefined && previous !== status) {
        if (status === 'error') {
          append(
            'persistence',
            'action',
            `persistence-${key}-error`,
            `${key} persistence entered an error state.`,
          );
        } else if (previous === 'error' && status === 'ready') {
          append(
            'persistence',
            'info',
            `persistence-${key}-recovered`,
            `${key} persistence returned to ready.`,
          );
        }
      }
    });

    previousPersistenceRef.current = current;
  }, [
    append,
    contactPersistenceStatus,
    messagePersistenceStatus,
    outboxPersistenceStatus,
    mapPersistenceStatus,
  ]);

  useEffect(() => {
    const unseen = recoveryEvents
      .filter(event => !seenRecoveryEventIdsRef.current.has(event.id))
      .sort((left, right) => left.occurredAtMs - right.occurredAtMs);

    unseen.forEach(event => {
      seenRecoveryEventIdsRef.current.add(event.id);
      const vehicleHint = diagnosticIdentityHint(event.vehicleId) ?? 'unknown vehicle';
      if (event.type === 'reacquired') {
        append(
          'convoy',
          'info',
          'convoy-reacquired',
          `${vehicleHint} was reacquired${event.position.requestDriven ? ' after an explicit position request' : ''}.`,
          event.occurredAtMs,
        );
      } else {
        append(
          'convoy',
          event.type === 'lost' ? 'action' : 'watch',
          event.type === 'lost' ? 'convoy-lost' : 'convoy-stale',
          `${vehicleHint} transitioned to ${event.type.toUpperCase()}; its last-known coordinate is not a current position.`,
          event.occurredAtMs,
        );
      }
    });
  }, [append, recoveryEvents]);

  const clearTrace = useCallback(() => {
    setEvents([]);
  }, []);

  const value = useMemo<FieldEventTraceContextValue>(
    () => ({events, addTestMarker, clearTrace}),
    [events, addTestMarker, clearTrace],
  );

  return (
    <FieldEventTraceContext.Provider value={value}>
      {children}
    </FieldEventTraceContext.Provider>
  );
}

export function useFieldEventTrace(): FieldEventTraceContextValue {
  const context = useContext(FieldEventTraceContext);
  if (!context) {
    throw new Error('useFieldEventTrace must be used inside FieldEventTraceProvider');
  }
  return context;
}
