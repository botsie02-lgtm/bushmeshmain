import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import {
  MapCoordinate,
  OfflineMapPack,
  TripMapCoverage,
  getTripMapCoverage,
} from '../maps/offlineMapPacks';

type OfflineMapContextValue = {
  packs: OfflineMapPack[];
  requiredTripPoints: MapCoordinate[];
  coverage: TripMapCoverage;
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
