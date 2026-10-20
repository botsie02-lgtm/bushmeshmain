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
  MapCoordinate,
  OfflineMapPack,
  TripMapCoverage,
  getTripMapCoverage,
} from '../maps/offlineMapPacks';
import {androidMapStatePersistence} from '../persistence/AndroidMapStatePersistence';
import {createMapStateSnapshot} from '../persistence/mapStateSnapshot';

export type MapPersistenceStatus =
  | 'restoring'
  | 'ready'
  | 'unsupported'
  | 'error';

type OfflineMapContextValue = {
  packs: OfflineMapPack[];
  requiredTripPoints: MapCoordinate[];
  coverage: TripMapCoverage;
  mapPersistenceStatus: MapPersistenceStatus;
  mapPersistenceError: string | null;
  installOrUpdatePack: (pack: OfflineMapPack) => void;
  removePack: (id: string) => void;
  setRequiredTripPoints: (points: MapCoordinate[]) => void;
  loadDemoHighCountryPack: () => void;
  clearMapState: () => void;
};

const OfflineMapContext = createContext<OfflineMapContextValue | null>(null);

function clonePack(pack: OfflineMapPack): OfflineMapPack {
  return {
    ...pack,
    bounds: {...pack.bounds},
  };
}

export function OfflineMapProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [packs, setPacks] = useState<OfflineMapPack[]>([]);
  const [requiredTripPoints, setRequiredTripPointsState] = useState<
    MapCoordinate[]
  >([]);
  const [mapPersistenceStatus, setMapPersistenceStatus] =
    useState<MapPersistenceStatus>(() =>
      androidMapStatePersistence.isSupported() ? 'restoring' : 'unsupported',
    );
  const [mapPersistenceError, setMapPersistenceError] = useState<string | null>(
    null,
  );
  const persistenceReadyRef = useRef(!androidMapStatePersistence.isSupported());
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;

    const restore = async () => {
      if (!androidMapStatePersistence.isSupported()) {
        persistenceReadyRef.current = true;
        if (active) {
          setMapPersistenceStatus('unsupported');
          setMapPersistenceError(null);
        }
        return;
      }

      try {
        const persisted = await androidMapStatePersistence.load();
        if (persisted && active) {
          setPacks(persisted.packs.map(clonePack));
          setRequiredTripPointsState(
            persisted.requiredTripPoints.map(point => ({...point})),
          );
        }

        persistenceReadyRef.current = true;
        if (active) {
          setMapPersistenceStatus('ready');
          setMapPersistenceError(null);
        }
      } catch (restoreError) {
        const restoreMessage =
          restoreError instanceof Error
            ? restoreError.message
            : 'Encrypted Bushmesh map metadata could not be restored.';

        try {
          await androidMapStatePersistence.resetSecureStorage();
          persistenceReadyRef.current = true;
          if (active) {
            setPacks([]);
            setRequiredTripPointsState([]);
            setMapPersistenceStatus('ready');
            setMapPersistenceError(
              `The previous encrypted map metadata could not be authenticated and was discarded. Secure map storage was re-keyed. ${restoreMessage}`,
            );
          }
        } catch (resetError) {
          persistenceReadyRef.current = true;
          if (active) {
            setPacks([]);
            setRequiredTripPointsState([]);
            setMapPersistenceStatus('error');
            setMapPersistenceError(
              resetError instanceof Error
                ? `Map restore failed (${restoreMessage}) and secure map storage could not be reinitialized: ${resetError.message}`
                : `Map restore failed (${restoreMessage}) and secure map storage could not be reinitialized.`,
            );
          }
        }
      }
    };

    restore().catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      mapPersistenceStatus !== 'ready' ||
      !androidMapStatePersistence.isSupported() ||
      !persistenceReadyRef.current
    ) {
      return;
    }

    const snapshot = createMapStateSnapshot(packs, requiredTripPoints);
    writeChainRef.current = writeChainRef.current
      .then(async () => {
        if (snapshot.packs.length === 0 && snapshot.requiredTripPoints.length === 0) {
          await androidMapStatePersistence.clear();
          return;
        }
        await androidMapStatePersistence.save(snapshot);
      })
      .catch(error => {
        setMapPersistenceError(
          error instanceof Error
            ? error.message
            : 'Encrypted Bushmesh map metadata could not be saved.',
        );
      });
  }, [packs, requiredTripPoints, mapPersistenceStatus]);

  const installOrUpdatePack = useCallback((pack: OfflineMapPack) => {
    setPacks(current => {
      const withoutExisting = current.filter(item => item.id !== pack.id);
      return [clonePack(pack), ...withoutExisting];
    });
  }, []);

  const removePack = useCallback((id: string) => {
    setPacks(current => current.filter(pack => pack.id !== id));
  }, []);

  const setRequiredTripPoints = useCallback((points: MapCoordinate[]) => {
    setRequiredTripPointsState(points.map(point => ({...point})));
  }, []);

  const loadDemoHighCountryPack = useCallback(() => {
    installOrUpdatePack({
      id: 'demo-victoria-high-country',
      name: 'Demo Victoria High Country',
      version: 'dev-1',
      bounds: {
        south: -38.5,
        west: 145.0,
        north: -35.8,
        east: 148.7,
      },
      state: 'ready',
      downloadedBytes: 250_000_000,
      totalBytes: 250_000_000,
      checksumVerified: true,
      simulated: true,
    });

    setRequiredTripPointsState([
      {latitude: -37.5628, longitude: 146.2504},
      {latitude: -37.3, longitude: 146.6},
      {latitude: -36.9, longitude: 147.1},
    ]);
  }, [installOrUpdatePack]);

  const clearMapState = useCallback(() => {
    setPacks([]);
    setRequiredTripPointsState([]);
  }, []);

  const coverage = useMemo(
    () => getTripMapCoverage(packs, requiredTripPoints),
    [packs, requiredTripPoints],
  );

  const value = useMemo<OfflineMapContextValue>(
    () => ({
      packs,
      requiredTripPoints,
      coverage,
      mapPersistenceStatus,
      mapPersistenceError,
      installOrUpdatePack,
      removePack,
      setRequiredTripPoints,
      loadDemoHighCountryPack,
      clearMapState,
    }),
    [
      packs,
      requiredTripPoints,
      coverage,
      mapPersistenceStatus,
      mapPersistenceError,
      installOrUpdatePack,
      removePack,
      setRequiredTripPoints,
      loadDemoHighCountryPack,
      clearMapState,
    ],
  );

  return (
    <OfflineMapContext.Provider value={value}>
      {children}
    </OfflineMapContext.Provider>
  );
}

export function useOfflineMaps(): OfflineMapContextValue {
  const context = useContext(OfflineMapContext);
  if (!context) {
    throw new Error('useOfflineMaps must be used inside OfflineMapProvider');
  }
  return context;
}
