import React, {useEffect, useState} from 'react';
import {useOfflineMaps} from '../../state/OfflineMapContext';
import {useLocationSession} from '../../state/LocationSessionContext';
import {
  useDriveDashboardController,
  type DriveDashboardTrustedInputs,
} from '../dashboard/useDriveDashboardController';
import {
  deriveFieldReadiness,
  type MapImageryEvidence,
} from './fieldReadinessModel';
import {
  FieldReadinessDashboard,
  type FieldReadinessDashboardProps,
} from './FieldReadinessDashboard';

export type ConnectedFieldReadinessDashboardProps =
  DriveDashboardTrustedInputs &
  Pick<FieldReadinessDashboardProps,
    'onOpenMap' | 'onManageMapPacks' | 'onOpenConvoy' |
    'onOpenRadio' | 'onOpenGpsSettings'
  > & {
    /**
     * Only actual map image-load evidence is accepted. No value is passed by
     * default because ConvoyMap does not yet publish an Image.onLoad callback.
     */
    imageryEvidence?: MapImageryEvidence;
  };

/**
 * Read-only integration host. Reuses the existing dashboard's verified
 * projection, never the legacy ConvoyContext public position/contact roster.
 * Intentionally does NOT call controller.performAction or any radio queue.
 */
export function ConnectedFieldReadinessDashboard({
  roster = null,
  verifiedAlerts = null,
  carrierBinding = null,
  imageryEvidence = null,
  onOpenMap,
  onManageMapPacks,
  onOpenConvoy,
  onOpenRadio,
  onOpenGpsSettings,
}: ConnectedFieldReadinessDashboardProps): React.JSX.Element {
  const dashboard = useDriveDashboardController({
    roster,
    verifiedAlerts,
    carrierBinding,
  });
  const {
    mapPackInstallSupported,
    mapPersistenceStatus,
    coverage,
  } = useOfflineMaps();
  const {latestFix} = useLocationSession();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const model = deriveFieldReadiness({
    dashboard: dashboard.model,
    packCatalog: dashboard.packCatalog,
    mapPackInstallSupported,
    mapPersistenceStatus,
    coverage,
    imageryEvidence,
    speedKmh: latestFix?.speedKmh ?? null,
    nowMs,
  });

  return (
    <FieldReadinessDashboard
      model={model}
      onOpenMap={onOpenMap}
      onManageMapPacks={onManageMapPacks}
      onOpenConvoy={onOpenConvoy}
      onOpenRadio={onOpenRadio}
      onOpenGpsSettings={onOpenGpsSettings}
    />
  );
}
