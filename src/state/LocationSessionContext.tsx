import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {distanceMeters, getConvoyFreshness} from '../convoy/convoy';
import {getConvoyGapDecision} from '../convoy/gapMonitor';
import {androidGpsLocationProvider} from '../location/AndroidGpsLocationProvider';
import {
  BushMeshLocationProvider,
  LocationProviderStop,
  createDefaultSimulatedRoute,
} from '../location/LocationProvider';
import {
  BushMeshTrackPoint,
  BushMeshTrackRecorder,
} from '../location/TrackRecorder';
import {requestAndroidPreciseLocationPermission} from '../location/locationPermissions';
import {
  BushMeshLocationFix,
  BushMeshPositionPlanner,
  PositionPlanResult,
  validateLocationFix,
} from '../location/positionPlanner';
import {useBushMesh} from './BushMeshContext';
import {useConvoy} from './ConvoyContext';
import {useRadioSession} from './RadioSessionContext';

export type LocationSessionStatus =
  | 'stopped'
  | 'tracking'
  | 'tracking-no-link'
  | 'error';

type LocationSessionContextValue = {
  status: LocationSessionStatus;
  providerLabel: string | null;
  latestFix: BushMeshLocationFix | null;
  lastPlan: PositionPlanResult | null;
  transmittedPlanCount: number;
  rejectedFixCount: number;
  lastError: string | null;
  nativeGpsSupported: boolean;
  trackPoints: BushMeshTrackPoint[];
  trackDistanceMeters: number;
  trackStartedAtMs: number | null;
  startProvider: (provider: BushMeshLocationProvider) => void;
  startNativeGps: () => Promise<void>;
  startSimulation: () => void;
  clearTrack: () => void;
  stop: () => void;
};

const LocationSessionContext = createContext<LocationSessionContextValue | null>(
  null,
);

function parseChannelIndex(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 7 ? parsed : null;
}

export function LocationSessionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {activeChannel} = useBushMesh();
  const {vehicles, setLocalPosition} = useConvoy();
  const {snapshot: radioSession, queuePosition, drainOnce} = useRadioSession();

  const [status, setStatus] = useState<LocationSessionStatus>('stopped');
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  const [latestFix, setLatestFix] = useState<BushMeshLocationFix | null>(null);
  const [lastPlan, setLastPlan] = useState<PositionPlanResult | null>(null);
  const [transmittedPlanCount, setTransmittedPlanCount] = useState(0);
  const [rejectedFixCount, setRejectedFixCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [trackPoints, setTrackPoints] = useState<BushMeshTrackPoint[]>([]);
  const [trackDistanceMeters, setTrackDistanceMeters] = useState(0);
  const [trackStartedAtMs, setTrackStartedAtMs] = useState<number | null>(null);

  const plannerRef = useRef(new BushMeshPositionPlanner());
  const trackRecorderRef = useRef(new BushMeshTrackRecorder());
  const stopProviderRef = useRef<LocationProviderStop | null>(null);
  const lastAcceptedFixTimestampRef = useRef<number | null>(null);
  const activeChannelRef = useRef(activeChannel);
  const vehiclesRef = useRef(vehicles);
  const radioSessionRef = useRef(radioSession);
  const queuePositionRef = useRef(queuePosition);
  const drainOnceRef = useRef(drainOnce);

  const nativeGpsSupported = androidGpsLocationProvider.isSupported();

  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);

  useEffect(() => {
    radioSessionRef.current = radioSession;
  }, [radioSession]);

  useEffect(() => {
    queuePositionRef.current = queuePosition;
    drainOnceRef.current = drainOnce;
  }, [queuePosition, drainOnce]);

  const refreshTrackSnapshot = useCallback(() => {
    const snapshot = trackRecorderRef.current.snapshot();
    setTrackPoints(snapshot.points);
    setTrackDistanceMeters(snapshot.totalDistanceMeters);
    setTrackStartedAtMs(snapshot.startedAtMs);
  }, []);

  const clearTrack = useCallback(() => {
    trackRecorderRef.current.clear();
    refreshTrackSnapshot();
  }, [refreshTrackSnapshot]);

  const stop = useCallback(() => {
    stopProviderRef.current?.();
    stopProviderRef.current = null;
    plannerRef.current.reset();
    lastAcceptedFixTimestampRef.current = null;
    setProviderLabel(null);
    setStatus('stopped');
    setLastError(null);
  }, []);

  useEffect(() => stop, [stop]);

  const handleFix = useCallback(
    (fix: BushMeshLocationFix) => {
      const validationError = validateLocationFix(fix);
      if (validationError) {
        setRejectedFixCount(count => count + 1);
        setLastError(validationError);
        return;
      }

      if (
        lastAcceptedFixTimestampRef.current !== null &&
        fix.timestampMs <= lastAcceptedFixTimestampRef.current
      ) {
        setRejectedFixCount(count => count + 1);
        setLastError('Location fix is older than the latest accepted local fix.');
        return;
      }

      lastAcceptedFixTimestampRef.current = fix.timestampMs;
      setLatestFix(fix);
      setLocalPosition({
        latitude: fix.latitude,
        longitude: fix.longitude,
      });
      setLastError(null);

      if (trackRecorderRef.current.ingest(fix)) {
        refreshTrackSnapshot();
      }

      const currentRadio = radioSessionRef.current;
      const channelIndex = parseChannelIndex(
        activeChannelRef.current?.channelIndex,
      );

      if (
        channelIndex === null ||
        !currentRadio.transportReady ||
        currentRadio.identityRef === null
      ) {
        setStatus('tracking-no-link');
        return;
      }

      const localCoordinate = {
        latitude: fix.latitude,
        longitude: fix.longitude,
      };
      const gapDecisions = vehiclesRef.current.map(vehicle => {
        const freshness = getConvoyFreshness(vehicle.receivedAtMs, fix.timestampMs);
        const distance = distanceMeters(localCoordinate, {
          latitude: vehicle.latitude,
          longitude: vehicle.longitude,
        });
        return {
          freshness,
          distance,
          decision: getConvoyGapDecision({
            distanceMeters: distance,
            freshness,
          }),
        };
      });

      const trustedDistances = gapDecisions
        .filter(
          item => item.freshness === 'live' || item.freshness === 'recent',
        )
        .map(item => item.distance);
      const convoyGapMeters =
        trustedDistances.length > 0 ? Math.max(...trustedDistances) : null;
      const recoveryUrgent = gapDecisions.some(
        item => item.decision.state === 'lost' || item.decision.state === 'unknown',
      );

      const plan = plannerRef.current.ingest(fix, {
        channelIndex,
        convoyGapMeters,
        urgent: recoveryUrgent,
      });
      setLastPlan(plan);
      setStatus('tracking');

      if (!plan.shouldTransmit || !plan.position) {
        return;
      }

      try {
        queuePositionRef.current(plan.position);
        setTransmittedPlanCount(count => count + 1);
        drainOnceRef.current().catch(error => {
          setLastError(
            error instanceof Error
              ? error.message
              : 'Position radio drain failed.',
          );
        });
      } catch (error) {
        setLastError(
          error instanceof Error
            ? error.message
            : 'Position could not be queued.',
        );
      }
    },
    [refreshTrackSnapshot, setLocalPosition],
  );

  const startProvider = useCallback(
    (provider: BushMeshLocationProvider) => {
      stopProviderRef.current?.();
      plannerRef.current.reset();
      lastAcceptedFixTimestampRef.current = null;
      setProviderLabel(provider.label);
      setLatestFix(null);
      setLastPlan(null);
      setRejectedFixCount(0);
      setTransmittedPlanCount(0);
      setLastError(null);
      setStatus('tracking-no-link');

      stopProviderRef.current = provider.start(handleFix, error => {
        setStatus('error');
        setLastError(error.message);
      });
    },
    [handleFix],
  );

  const startNativeGps = useCallback(async () => {
    if (!androidGpsLocationProvider.isSupported()) {
      setStatus('error');
      setLastError('Native Android GPS is unavailable on this device.');
      return;
    }

    try {
      const granted = await requestAndroidPreciseLocationPermission();
      if (!granted) {
        setStatus('error');
        setLastError(
          'Precise location permission is required for offline GPS tracking.',
        );
        return;
      }

      startProvider(androidGpsLocationProvider);
    } catch (error) {
      setStatus('error');
      setLastError(
        error instanceof Error
          ? error.message
          : 'Android GPS permission could not be requested.',
      );
    }
  }, [startProvider]);

  const startSimulation = useCallback(() => {
    startProvider(createDefaultSimulatedRoute());
  }, [startProvider]);

  const value = useMemo<LocationSessionContextValue>(
    () => ({
      status,
      providerLabel,
      latestFix,
      lastPlan,
      transmittedPlanCount,
      rejectedFixCount,
      lastError,
      nativeGpsSupported,
      trackPoints,
      trackDistanceMeters,
      trackStartedAtMs,
      startProvider,
      startNativeGps,
      startSimulation,
      clearTrack,
      stop,
    }),
    [
      status,
      providerLabel,
      latestFix,
      lastPlan,
      transmittedPlanCount,
      rejectedFixCount,
      lastError,
      nativeGpsSupported,
      trackPoints,
      trackDistanceMeters,
      trackStartedAtMs,
      startProvider,
      startNativeGps,
      startSimulation,
      clearTrack,
      stop,
    ],
  );

  return (
    <LocationSessionContext.Provider value={value}>
      {children}
    </LocationSessionContext.Provider>
  );
}

export function useLocationSession(): LocationSessionContextValue {
  const context = useContext(LocationSessionContext);
  if (!context) {
    throw new Error(
      'useLocationSession must be used inside LocationSessionProvider',
    );
  }
  return context;
}
