import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {Coordinate} from '../convoy/convoy';
import {
  BushMeshOfflineRouteEngine,
  BushMeshRouteAvoidance,
  BushMeshRoutePlan,
  BushMeshRouteProfile,
  BushMeshRouteWaypoint,
  routeCoveragePoints,
  validateRoutePlan,
  validateRouteRequest,
} from '../navigation/offlineRouting';
import {
  BushMeshRouteProgress,
  calculateRouteProgress,
} from '../navigation/routeProgress';
import {
  MapCoordinate,
  TripMapCoverage,
  getTripMapCoverage,
} from '../maps/offlineMapPacks';
import {useLocationSession} from './LocationSessionContext';
import {useOfflineMaps} from './OfflineMapContext';

export type RouteSessionStatus =
  | 'idle'
  | 'engine-unavailable'
  | 'planning'
  | 'ready'
  | 'off-route'
  | 'arrived'
  | 'error';

type RouteEngineInfo = {
  id: string;
  version: string;
  profiles: BushMeshRouteProfile[];
  avoidances: BushMeshRouteAvoidance[];
};

type RouteSessionContextValue = {
  status: RouteSessionStatus;
  engineInfo: RouteEngineInfo | null;
  activePlan: BushMeshRoutePlan | null;
  progress: BushMeshRouteProgress | null;
  coveragePoints: MapCoordinate[];
  mapCoverage: TripMapCoverage;
  profile: BushMeshRouteProfile;
  avoidances: BushMeshRouteAvoidance[];
  errorMessage: string | null;
  attachEngine: (engine: BushMeshOfflineRouteEngine | null) => void;
  setProfile: (profile: BushMeshRouteProfile) => void;
  setAvoidances: (avoidances: BushMeshRouteAvoidance[]) => void;
  planTo: (
    destination: Coordinate,
    via?: BushMeshRouteWaypoint[],
  ) => Promise<BushMeshRoutePlan | null>;
  clearRoute: () => Promise<void>;
};

const RouteSessionContext = createContext<RouteSessionContextValue | null>(null);

function statusFromProgress(progress: BushMeshRouteProgress): RouteSessionStatus {
  switch (progress.status) {
    case 'arrived':
      return 'arrived';
    case 'off-route':
      return 'off-route';
    case 'on-route':
    default:
      return 'ready';
  }
}

function messageForError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : fallback;
}

export function RouteSessionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {latestFix} = useLocationSession();
  const {packs} = useOfflineMaps();
  const [status, setStatus] = useState<RouteSessionStatus>('idle');
  const [engineInfo, setEngineInfo] = useState<RouteEngineInfo | null>(null);
  const [activePlan, setActivePlan] = useState<BushMeshRoutePlan | null>(null);
  const [progress, setProgress] = useState<BushMeshRouteProgress | null>(null);
  const [coveragePoints, setCoveragePoints] = useState<MapCoordinate[]>([]);
  const [profile, setProfileState] =
    useState<BushMeshRouteProfile>('4wd-standard');
  const [avoidances, setAvoidancesState] = useState<BushMeshRouteAvoidance[]>([
    'private-road',
  ]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const engineRef = useRef<BushMeshOfflineRouteEngine | null>(null);
  const generationRef = useRef(0);

  const mapCoverage = useMemo(
    () => getTripMapCoverage(packs, coveragePoints),
    [packs, coveragePoints],
  );

  const attachEngine = useCallback((engine: BushMeshOfflineRouteEngine | null) => {
    generationRef.current += 1;
    engineRef.current = engine;
    setActivePlan(null);
    setProgress(null);
    setCoveragePoints([]);
    setErrorMessage(null);

    if (engine === null) {
      setEngineInfo(null);
      setStatus('idle');
      return;
    }

    setEngineInfo({
      id: engine.id,
      version: engine.version,
      profiles: [...engine.capabilities.profiles],
      avoidances: [...engine.capabilities.supportedAvoidances],
    });
    setStatus('idle');
  }, []);

  const setProfile = useCallback((next: BushMeshRouteProfile) => {
    setProfileState(next);
  }, []);

  const setAvoidances = useCallback((next: BushMeshRouteAvoidance[]) => {
    setAvoidancesState([...new Set(next)]);
  }, []);

  const planTo = useCallback(
    async (
      destination: Coordinate,
      via: BushMeshRouteWaypoint[] = [],
    ): Promise<BushMeshRoutePlan | null> => {
      const engine = engineRef.current;
      if (engine === null) {
        setStatus('engine-unavailable');
        setErrorMessage(
          'No offline routing engine is attached. Direct-bearing navigation remains available.',
        );
        return null;
      }
      if (latestFix === null) {
        setStatus('error');
        setErrorMessage('A current GPS fix is required before planning a route.');
        return null;
      }
      if (!engine.capabilities.profiles.includes(profile)) {
        setStatus('error');
        setErrorMessage(`The active routing engine does not support ${profile}.`);
        return null;
      }

      const unsupportedAvoidance = avoidances.find(
        avoidance =>
          !engine.capabilities.supportedAvoidances.includes(avoidance),
      );
      if (unsupportedAvoidance) {
        setStatus('error');
        setErrorMessage(
          `The active routing engine does not support avoiding ${unsupportedAvoidance}.`,
        );
        return null;
      }

      const request = {
        start: {
          latitude: latestFix.latitude,
          longitude: latestFix.longitude,
        },
        destination: {...destination},
        via: via.map(point => ({...point})),
        profile,
        avoid: [...avoidances],
      };
      validateRouteRequest(request);

      const generation = generationRef.current + 1;
      generationRef.current = generation;
      setStatus('planning');
      setErrorMessage(null);

      try {
        const ready = await engine.isReady();
        if (generationRef.current !== generation) {
          return null;
        }
        if (!ready) {
          setStatus('engine-unavailable');
          setErrorMessage(
            'The offline routing engine is installed but its local routing data is not ready.',
          );
          return null;
        }

        const plan = await engine.route(request);
        if (generationRef.current !== generation) {
          return null;
        }
        validateRoutePlan(plan);

        const nextProgress = calculateRouteProgress(
          plan,
          {latitude: latestFix.latitude, longitude: latestFix.longitude},
          {horizontalAccuracyMeters: latestFix.accuracyMeters},
        );
        setActivePlan(plan);
        setProgress(nextProgress);
        setCoveragePoints(routeCoveragePoints(plan.geometry));
        setStatus(statusFromProgress(nextProgress));
        setErrorMessage(null);
        return plan;
      } catch (error) {
        if (generationRef.current !== generation) {
          return null;
        }
        setActivePlan(null);
        setProgress(null);
        setCoveragePoints([]);
        setStatus('error');
        setErrorMessage(messageForError(error, 'Offline route planning failed.'));
        return null;
      }
    },
    [avoidances, latestFix, profile],
  );

  const clearRoute = useCallback(async (): Promise<void> => {
    generationRef.current += 1;
    const engine = engineRef.current;
    setActivePlan(null);
    setProgress(null);
    setCoveragePoints([]);
    setErrorMessage(null);
    setStatus('idle');

    if (engine !== null) {
      try {
        await engine.cancelActiveRoute();
      } catch {
        // Route state is already cleared locally; engine cancellation is best effort.
      }
    }
  }, []);

  useEffect(() => {
    if (activePlan === null || latestFix === null) {
      return;
    }

    try {
      const next = calculateRouteProgress(
        activePlan,
        {latitude: latestFix.latitude, longitude: latestFix.longitude},
        {horizontalAccuracyMeters: latestFix.accuracyMeters},
      );
      setProgress(next);
      setStatus(statusFromProgress(next));
    } catch (error) {
      setStatus('error');
      setErrorMessage(messageForError(error, 'Route progress could not be updated.'));
    }
  }, [activePlan, latestFix]);

  const value = useMemo<RouteSessionContextValue>(
    () => ({
      status,
      engineInfo,
      activePlan,
      progress,
      coveragePoints,
      mapCoverage,
      profile,
      avoidances,
      errorMessage,
      attachEngine,
      setProfile,
      setAvoidances,
      planTo,
      clearRoute,
    }),
    [
      status,
      engineInfo,
      activePlan,
      progress,
      coveragePoints,
      mapCoverage,
      profile,
      avoidances,
      errorMessage,
      attachEngine,
      setProfile,
      setAvoidances,
      planTo,
      clearRoute,
    ],
  );

  return (
    <RouteSessionContext.Provider value={value}>
      {children}
    </RouteSessionContext.Provider>
  );
}

export function useRouteSession(): RouteSessionContextValue {
  const context = useContext(RouteSessionContext);
  if (!context) {
    throw new Error('useRouteSession must be used inside RouteSessionProvider');
  }
  return context;
}
