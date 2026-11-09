import {useCallback, useEffect, useRef, useState} from 'react';
import {BushMeshQuickActionCode} from '../../bushmesh/legacyProtocol';
import {useActiveOperationalConvoy} from '../../app/activeContext/ActiveOperationalConvoyContext';
import {useBushMesh} from '../../state/BushMeshContext';
import {useDrive} from '../../state/DriveContext';
import {useLocationSession} from '../../state/LocationSessionContext';
import {useOfflineMaps} from '../../state/OfflineMapContext';
import {useRadioSession} from '../../state/RadioSessionContext';
import {nativeOfflineTileSource} from '../../maps/nativeOfflineTileSource';
import {
  deriveDriveDashboard,
  type AuthorisedCarrierBinding,
  type DriveDashboardModel,
  type VerifiedConvoyAlerts,
  type VerifiedConvoyRoster,
} from './driveDashboardModel';
import {
  performDashboardAction,
  type DashboardActionResult,
} from './quickActionController';

export type DriveDashboardTrustedInputs = {
  roster?: VerifiedConvoyRoster | null;
  verifiedAlerts?: VerifiedConvoyAlerts | null;
  carrierBinding?: AuthorisedCarrierBinding | null;
};

export type DriveDashboardController = {
  model: DriveDashboardModel;
  packCatalog: ReturnType<typeof useOfflineMaps>['packCatalog'];
  busyAction: BushMeshQuickActionCode | null;
  actionResult: DashboardActionResult | null;
  performAction: (action: BushMeshQuickActionCode) => Promise<DashboardActionResult | null>;
};

export function useDriveDashboardController({
  roster = null,
  verifiedAlerts = null,
  carrierBinding = null,
}: DriveDashboardTrustedInputs = {}): DriveDashboardController {
  const {activeConvoy} = useActiveOperationalConvoy();
  const {
    connectionStatus, activeChannelIndex, channelMessages,
  } = useBushMesh();
  const {
    status: locationStatus, providerLabel,
    latestFix,
  } = useLocationSession();
  const {
    coverage, requiredTripPoints, packCatalog,
  } = useOfflineMaps();
  const {
    snapshot: radioSession, queueDriverAction, drainOnce,
  } = useRadioSession();
  const {
    previewQuickAction, recordLocalQuickAction,
  } = useDrive();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyAction, setBusyAction] = useState<BushMeshQuickActionCode | null>(null);
  const [actionResult, setActionResult] = useState<DashboardActionResult | null>(null);
  const inFlightRef = useRef(false);
  const sequenceRef = useRef(1);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  // Keep local state isolated. No contact directory or unscoped ConvoyContext
  // vehicle is ever promoted into an authorised operational member.
  const model = deriveDriveDashboard({
    nowMs,
    activeConvoy,
    roster,
    verifiedAlerts,
    carrierBinding,
    radioConnectionStatus: connectionStatus,
    activeCarrierChannelIndex: activeChannelIndex,
    radioSession,
    locationStatus,
    locationProviderLabel: providerLabel,
    latestFix,
    mapCoverage: coverage,
    requiredTripPointCount: requiredTripPoints.length,
    packCatalog,
    offlineTilesAvailable: nativeOfflineTileSource.isAvailable(),
    channelMessages,
  });

  const performAction = useCallback(async (
    action: BushMeshQuickActionCode,
  ): Promise<DashboardActionResult | null> => {
    if (inFlightRef.current) {
      return null;
    }
    inFlightRef.current = true;
    setBusyAction(action);
    setActionResult(null);
    const sequence = sequenceRef.current;
    sequenceRef.current = sequence >= 0xffff ? 1 : sequence + 1;
    try {
      const outcome = await performDashboardAction(action, model, sequence, {
        identityRef: radioSession.identityRef,
        previewQuickAction,
        recordLocalQuickAction,
        queueDriverAction,
        drainOnce,
      });
      setActionResult(outcome);
      return outcome;
    } catch {
      const failed: DashboardActionResult = {
        kind: 'failed',
        message: 'Quick action was not submitted. No radio delivery confirmed.',
      };
      setActionResult(failed);
      return failed;
    } finally {
      inFlightRef.current = false;
      setBusyAction(null);
    }
  }, [
    model,
    radioSession.identityRef,
    previewQuickAction,
    recordLocalQuickAction,
    queueDriverAction,
    drainOnce,
  ]);

  return {model, packCatalog, busyAction, actionResult, performAction};
}
