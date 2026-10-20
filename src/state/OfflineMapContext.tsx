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
  BushMeshMapPackCatalogEntry,
  applyVerifiedMapPackArtifact,
  markMapPackInstalling,
  markMapPackInvalid,
  markMapPackNotInstalled,
  offlineMapPacksFromCatalog,
  registerMapPackManifest as registerCatalogManifest,
  removeMapPackCatalogEntry,
} from '../maps/mapPackCatalog';
import {BushMeshMapPackManifestV1} from '../maps/mapPackManifest';
import {
  MapCoordinate,
  OfflineMapPack,
  TripMapCoverage,
  getTripMapCoverage,
} from '../maps/offlineMapPacks';
import {nativeMapPacks} from '../native/NativeMapPacks';
import {androidMapStatePersistence} from '../persistence/AndroidMapStatePersistence';
import {createMapStateSnapshot} from '../persistence/mapStateSnapshot';

export type MapPersistenceStatus =
  | 'restoring'
  | 'ready'
  | 'unsupported'
  | 'error';

type OfflineMapContextValue = {
  packs: OfflineMapPack[];
  packCatalog: BushMeshMapPackCatalogEntry[];
  requiredTripPoints: MapCoordinate[];
  coverage: TripMapCoverage;
  mapPersistenceStatus: MapPersistenceStatus;
  mapPersistenceError: string | null;
  mapPackInstallSupported: boolean;
  installOrUpdatePack: (pack: OfflineMapPack) => void;
  registerMapPackManifest: (manifest: BushMeshMapPackManifestV1) => void;
  installMapPack: (packId: string) => Promise<void>;
  verifyMapPack: (packId: string) => Promise<boolean>;
  removePack: (id: string) => Promise<void>;
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : fallback;
}

export function OfflineMapProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [packCatalog, setPackCatalog] = useState<BushMeshMapPackCatalogEntry[]>(
    [],
  );
  const [simulatedPacks, setSimulatedPacks] = useState<OfflineMapPack[]>([]);
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

  const mapPackInstallSupported = nativeMapPacks.isSupported();
  const packs = useMemo(
    () => [
      ...offlineMapPacksFromCatalog(packCatalog),
      ...simulatedPacks.map(clonePack),
    ],
    [packCatalog, simulatedPacks],
  );

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
          setPackCatalog(persisted.catalog);
          setSimulatedPacks(persisted.simulatedPacks.map(clonePack));
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
        const restoreMessage = errorMessage(
          restoreError,
          'Encrypted Bushmesh map metadata could not be restored.',
        );

        try {
          await androidMapStatePersistence.resetSecureStorage();
          persistenceReadyRef.current = true;
          if (active) {
            setPackCatalog([]);
            setSimulatedPacks([]);
            setRequiredTripPointsState([]);
            setMapPersistenceStatus('ready');
            setMapPersistenceError(
              `The previous encrypted map metadata could not be authenticated and was discarded. Secure map storage was re-keyed. ${restoreMessage}`,
            );
          }
        } catch (resetError) {
          persistenceReadyRef.current = true;
          if (active) {
            setPackCatalog([]);
            setSimulatedPacks([]);
            setRequiredTripPointsState([]);
            setMapPersistenceStatus('error');
            setMapPersistenceError(
              `Map restore failed (${restoreMessage}) and secure map storage could not be reinitialized: ${errorMessage(
                resetError,
                'unknown secure-storage failure',
              )}`,
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

    const snapshot = createMapStateSnapshot(
      packCatalog,
      simulatedPacks,
      requiredTripPoints,
    );
    writeChainRef.current = writeChainRef.current
      .then(async () => {
        if (
          snapshot.catalog.length === 0 &&
          snapshot.simulatedPacks.length === 0 &&
          snapshot.requiredTripPoints.length === 0
        ) {
          await androidMapStatePersistence.clear();
          return;
        }
        await androidMapStatePersistence.save(snapshot);
      })
      .catch(error => {
        setMapPersistenceError(
          errorMessage(
            error,
            'Encrypted Bushmesh map metadata could not be saved.',
          ),
        );
      });
  }, [
    packCatalog,
    simulatedPacks,
    requiredTripPoints,
    mapPersistenceStatus,
  ]);

  const installOrUpdatePack = useCallback((pack: OfflineMapPack) => {
    if (pack.simulated !== true) {
      throw new Error(
        'Real Bushmesh map packs must be registered from an authenticated manifest.',
      );
    }

    setSimulatedPacks(current => {
      const withoutExisting = current.filter(item => item.id !== pack.id);
      return [clonePack(pack), ...withoutExisting];
    });
  }, []);

  const registerMapPackManifest = useCallback(
    (manifest: BushMeshMapPackManifestV1) => {
      setPackCatalog(current => registerCatalogManifest(current, manifest));
      setSimulatedPacks(current =>
        current.filter(pack => pack.id !== manifest.id),
      );
    },
    [],
  );

  const installMapPack = useCallback(
    async (packId: string): Promise<void> => {
      const entry = packCatalog.find(item => item.manifest.id === packId);
      if (!entry) {
        throw new Error(`Unknown Bushmesh map pack ${packId}.`);
      }
      if (entry.manifest.source.kind !== 'remote') {
        throw new Error('Imported map packs require the local import workflow.');
      }
      if (!mapPackInstallSupported) {
        throw new Error('Native Bushmesh map-pack installation is unavailable.');
      }

      setPackCatalog(current => markMapPackInstalling(current, packId));
      try {
        const artifact = await nativeMapPacks.download(entry.manifest);
        setPackCatalog(current =>
          applyVerifiedMapPackArtifact(current, packId, artifact),
        );
        setMapPersistenceError(null);
      } catch (error) {
        const message = errorMessage(error, 'Map-pack installation failed.');
        setPackCatalog(current => markMapPackInvalid(current, packId, message));
        throw error;
      }
    },
    [mapPackInstallSupported, packCatalog],
  );

  const verifyMapPack = useCallback(
    async (packId: string): Promise<boolean> => {
      const entry = packCatalog.find(item => item.manifest.id === packId);
      if (!entry) {
        throw new Error(`Unknown Bushmesh map pack ${packId}.`);
      }
      if (!mapPackInstallSupported) {
        return false;
      }

      try {
        const artifact = await nativeMapPacks.verify(entry.manifest);
        if (artifact === null) {
          setPackCatalog(current => markMapPackNotInstalled(current, packId));
          return false;
        }
        setPackCatalog(current =>
          applyVerifiedMapPackArtifact(current, packId, artifact),
        );
        return true;
      } catch (error) {
        const message = errorMessage(error, 'Map-pack verification failed.');
        setPackCatalog(current => markMapPackInvalid(current, packId, message));
        throw error;
      }
    },
    [mapPackInstallSupported, packCatalog],
  );

  const removePack = useCallback(
    async (id: string): Promise<void> => {
      const isRealPack = packCatalog.some(entry => entry.manifest.id === id);
      if (isRealPack && mapPackInstallSupported) {
        await nativeMapPacks.remove(id);
      }
      setPackCatalog(current => removeMapPackCatalogEntry(current, id));
      setSimulatedPacks(current => current.filter(pack => pack.id !== id));
    },
    [mapPackInstallSupported, packCatalog],
  );

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
    const realPackIds = packCatalog.map(entry => entry.manifest.id);
    setPackCatalog([]);
    setSimulatedPacks([]);
    setRequiredTripPointsState([]);

    if (mapPackInstallSupported && realPackIds.length > 0) {
      Promise.all(realPackIds.map(id => nativeMapPacks.remove(id))).catch(error => {
        setMapPersistenceError(
          `Map metadata was cleared, but one or more local pack files could not be removed: ${errorMessage(
            error,
            'unknown removal failure',
          )}`,
        );
      });
    }
  }, [mapPackInstallSupported, packCatalog]);

  const coverage = useMemo(
    () => getTripMapCoverage(packs, requiredTripPoints),
    [packs, requiredTripPoints],
  );

  const value = useMemo<OfflineMapContextValue>(
    () => ({
      packs,
      packCatalog,
      requiredTripPoints,
      coverage,
      mapPersistenceStatus,
      mapPersistenceError,
      mapPackInstallSupported,
      installOrUpdatePack,
      registerMapPackManifest,
      installMapPack,
      verifyMapPack,
      removePack,
      setRequiredTripPoints,
      loadDemoHighCountryPack,
      clearMapState,
    }),
    [
      packs,
      packCatalog,
      requiredTripPoints,
      coverage,
      mapPersistenceStatus,
      mapPersistenceError,
      mapPackInstallSupported,
      installOrUpdatePack,
      registerMapPackManifest,
      installMapPack,
      verifyMapPack,
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
