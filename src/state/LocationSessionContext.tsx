import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {BUSHMESH_POSITION_RESPONSE_FLAG} from '../bushmesh/positionRequestProtocol';
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
import {
  buildBushMeshTrackGpx,
  defaultBushMeshGpxFilename,
} from '../location/gpx';
import {requestAndroidPreciseLocationPermission} from '../location/locationPermissions';
import {
  BushMeshLocationFix,
  BushMeshPositionPlanner,
  PositionPlanResult,
  validateLocationFix,
} from '../location/positionPlanner';
import {
  NativeExportResult,
  nativeFileExport,
} from '../native/NativeFileExport';
import {androidTrackPersistence} from '../persistence/AndroidTrackPersistence';
import {createTrackSnapshot} from '../persistence/trackSnapshot';
import {useBushMesh} from './BushMeshContext';
import {useConvoy} from './ConvoyContext';
import {useRadioSession} from './RadioSessionContext';

export type LocationSessionStatus =
  | 'stopped'
  | 'tracking'
  | 'tracking-no-link'
  | 'error';

export type TrackPersistenceStatus =
  | 'restoring'
  | 'ready'
  | 'unsupported'
  | 'error';

export type RequestedPositionResponseResult = {
  queued: boolean;
  entryId: string | null;
  fixAgeMs: number | null;
  reason: string | null;
};

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
  trackExportSupported: boolean;
  trackPersistenceStatus: TrackPersistenceStatus;
  trackPersistenceError: string | null;
  startProvider: (provider: BushMeshLocationProvider) => void;
  startNativeGps: () => Promise<void>;
  startSimulation: () => void;
  respondToPositionRequest: (
    channelIndex: number,
    nowMs?: number,
  ) => RequestedPositionResponseResult;
  exportTrackGpx: () => Promise<NativeExportResult>;
  clearTrack: () => void;
  stop: () => void;
};

const LocationSessionContext = createContext<LocationSessionContextValue | null>(
  null,
);

const MAX_REQUEST_RESPONSE_FIX_AGE_MS = 45_000;
const MAX_REQUEST_RESPONSE_FUTURE_SKEW_MS = 10_000;

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
  const [trackPersistenceStatus, setTrackPersistenceStatus] =
    useState<TrackPersistenceStatus>(() =>
      androidTrackPersistence.isSupported() ? 'restoring' : 'unsupported',
    );
  const [trackPersistenceError, setTrackPersistenceError] = useState<
    string | null
  >(null);

  const plannerRef = useRef(new BushMeshPositionPlanner());
  const trackRecorderRef = useRef(new BushMeshTrackRecorder());
  const stopProviderRef = useRef<LocationProviderStop | null>(null);
  const lastAcceptedFixTimestampRef = useRef<number | null>(null);
  const latestFixRef = useRef<BushMeshLocationFix | null>(null);
  const activeChannelRef = useRef(activeChannel);
  const vehiclesRef = useRef(vehicles);
  const radioSessionRef = useRef(radioSession);
  const queuePositionRef = useRef(queuePosition);
  const drainOnceRef = useRef(drainOnce);
  const trackPersistenceReadyRef = useRef(!androidTrackPersistence.isSupported());
  const trackWriteChainRef = useRef<Promise<void>>(Promise.resolve());

  const nativeGpsSupported = androidGpsLocationProvider.isSupported();
  const trackExportSupported = nativeFileExport.isSupported();

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

  useEffect(() => {
    let active = true;

    const restoreTrack = async () => {
      if (!androidTrackPersistence.isSupported()) {
        trackPersistenceReadyRef.current = true;
        if (active) {
          setTrackPersistenceStatus('unsupported');
          setTrackPersistenceError(null);
        }
        return;
      }

      try {
        const persisted = await androidTrackPersistence.load();
        if (persisted) {
          trackRecorderRef.current.restore(persisted.track);
          lastAcceptedFixTimestampRef.current = persisted.track.lastRecordedAtMs;
          refreshTrackSnapshot();
        }

        trackPersistenceReadyRef.current = true;
        if (active) {
          setTrackPersistenceStatus('ready');
          setTrackPersistenceError(null);
        }
      } catch (restoreError) {
        const restoreMessage =
          restoreError instanceof Error
            ? restoreError.message
            : 'Encrypted Bushmesh breadcrumb trail could not be restored.';

        try {
          await androidTrackPersistence.resetSecureStorage();
          trackRecorderRef.current.clear();
          lastAcceptedFixTimestampRef.current = null;
          refreshTrackSnapshot();
          trackPersistenceReadyRef.current = true;
          if (active) {
            setTrackPersistenceStatus('ready');
            setTrackPersistenceError(
              `The previous encrypted breadcrumb trail could not be authenticated and was discarded. Secure track storage was re-keyed. ${restoreMessage}`,
            );
          }
        } catch (resetError) {
          trackPersistenceReadyRef.current = true;
          if (active) {
            setTrackPersistenceStatus('error');
            setTrackPersistenceError(
              resetError instanceof Error
                ? `Track restore failed (${restoreMessage}) and secure track storage could not be reinitialized: ${resetError.message}`
                : `Track restore failed (${restoreMessage}) and secure track storage could not be reinitialized.`,
            );
          }
        }
      }
    };

    restoreTrack().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [refreshTrackSnapshot]);

  useEffect(() => {
    if (
      trackPersistenceStatus !== 'ready' ||
      !androidTrackPersistence.isSupported() ||
      !trackPersistenceReadyRef.current
    ) {
      return;
    }

    const snapshot = trackRecorderRef.current.snapshot();
    trackWriteChainRef.current = trackWriteChainRef.current
      .then(async () => {
        if (snapshot.points.length === 0) {
          await androidTrackPersistence.clear();
          return;
        }

        await androidTrackPersistence.save(createTrackSnapshot(snapshot));
      })
      .catch(error => {
        setTrackPersistenceError(
          error instanceof Error
            ? error.message
            : 'Encrypted Bushmesh breadcrumb trail could not be saved.',
        );
      });
  }, [
    trackPoints,
    trackDistanceMeters,
    trackStartedAtMs,
    trackPersistenceStatus,
  ]);

  const clearTrack = useCallback(() => {
    trackRecorderRef.current.clear();
    lastAcceptedFixTimestampRef.current = null;
    refreshTrackSnapshot();
  }, [refreshTrackSnapshot]);

  const exportTrackGpx = useCallback(async (): Promise<NativeExportResult> => {
    const snapshot = trackRecorderRef.current.snapshot();
    if (snapshot.points.length === 0) {
      throw new Error('Record at least one breadcrumb before exporting GPX.');
    }

    const gpx = buildBushMeshTrackGpx(snapshot.points, {
      name: 'Bushmesh Track',
      description: `Offline Bushmesh breadcrumb track · ${Math.round(
        snapshot.totalDistanceMeters,
      )} m recorded`,
    });
    const filename = defaultBushMeshGpxFilename(snapshot.startedAtMs);
    return nativeFileExport.saveGpx(filename, gpx);
  }, []);

  const stop = useCallback(() => {
    stopProviderRef.current?.();
    stopProviderRef.current = null;
    plannerRef.current.reset();
    latestFixRef.current = null;
    setProviderLabel(null);
    setLatestFix(null);
    setStatus('stopped');
    setLastError(null);
  }, []);

  useEffect(() => stop, [stop]);

  const respondToPositionRequest = useCallback(
    (
      channelIndex: number,
      nowMs = Date.now(),
    ): RequestedPositionResponseResult => {
      const fix = latestFixRef.current;
      if (!fix) {
        return {
          queued: false,
          entryId: null,
          fixAgeMs: null,
          reason: 'No accepted local GPS fix is available.',
        };
      }

      const currentRadio = radioSessionRef.current;
      if (!currentRadio.transportReady || currentRadio.identityRef === null) {
        return {
          queued: false,
          entryId: null,
          fixAgeMs: Math.max(0, nowMs - fix.timestampMs),
          reason: 'Radio transport or identity is unavailable.',
        };
      }

      const fixAgeMs = nowMs - fix.timestampMs;
      if (fixAgeMs < -MAX_REQUEST_RESPONSE_FUTURE_SKEW_MS) {
        return {
          queued: false,
          entryId: null,
          fixAgeMs,
          reason: 'The latest GPS fix is future-dated beyond the allowed clock skew.',
        };
      }
      if (fixAgeMs > MAX_REQUEST_RESPONSE_FIX_AGE_MS) {
        return {
          queued: false,
          entryId: null,
          fixAgeMs,
          reason: 'The latest GPS fix is too old to send as a recovery response.',
        };
      }

      try {
        const position = plannerRef.current.buildImmediateTransmission(
          fix,
          channelIndex,
          BUSHMESH_POSITION_RESPONSE_FLAG,
        );
        const entry = queuePositionRef.current(position);
        setTransmittedPlanCount(count => count + 1);
        drainOnceRef.current().catch(error => {
          setLastError(
            error instanceof Error
              ? error.message
              : 'Requested position radio drain failed.',
          );
        });
        return {
          queued: true,
          entryId: entry.id,
          fixAgeMs: Math.max(0, fixAgeMs),
          reason: null,
        };
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : 'Requested position could not be queued.';
        setLastError(reason);
        return {
          queued: false,
          entryId: null,
          fixAgeMs: Math.max(0, fixAgeMs),
          reason,
        };
      }
    },
    [],
  );

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
      latestFixRef.current = fix;
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
      lastAcceptedFixTimestampRef.current =
        trackRecorderRef.current.snapshot().lastRecordedAtMs;
      latestFixRef.current = null;
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
      trackExportSupported,
      trackPersistenceStatus,
      trackPersistenceError,
      startProvider,
      startNativeGps,
      startSimulation,
      respondToPositionRequest,
      exportTrackGpx,
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
      trackExportSupported,
      trackPersistenceStatus,
      trackPersistenceError,
      startProvider,
      startNativeGps,
      startSimulation,
      respondToPositionRequest,
      exportTrackGpx,
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
