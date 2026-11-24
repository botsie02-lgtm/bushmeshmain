import React, {useEffect, useState} from 'react';
import {useActiveOperationalConvoy} from '../activeContext/ActiveOperationalConvoyContext';
import {useBushMesh} from '../../state/BushMeshContext';
import {useLocationSession} from '../../state/LocationSessionContext';
import {useOfflineMaps} from '../../state/OfflineMapContext';
import {useRadioSession} from '../../state/RadioSessionContext';
import {nativeOfflineTileSource} from '../../maps/nativeOfflineTileSource';
import {deriveFieldPulse, type FieldPulseKind} from './fieldPulseModel';
import {FieldPulseStrip} from './FieldPulseStrip';

export type ConnectedFieldPulseProps = {
  onOpen: (section: FieldPulseKind) => void;
  compact?: boolean;
};

/**
 * Read-only status of mounted application providers. The production session
 * owners stay in AppProviders; this does not start Bluetooth or GPS.
 */
export function ConnectedFieldPulse({
  onOpen, compact = false,
}: ConnectedFieldPulseProps): React.JSX.Element {
  const {connectionStatus, activeChannel, canSendChannelMessage} = useBushMesh();
  const {snapshot} = useRadioSession();
  const {status, latestFix, providerLabel} = useLocationSession();
  const {packCatalog, mapPersistenceStatus, coverage, requiredTripPoints} =
    useOfflineMaps();
  const {activeConvoy, status: convoyStatus} = useActiveOperationalConvoy();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const items = deriveFieldPulse({
    nowMs,
    radioConnected: connectionStatus === 'Connected',
    channelSendAvailable: canSendChannelMessage,
    channelName: activeChannel?.channelName ?? null,
    protocolTransportReady: snapshot.transportReady,
    locationStatus: status,
    locationProvider: providerLabel,
    fix: latestFix,
    packCatalog,
    tilesReaderAvailable: nativeOfflineTileSource.isAvailable(),
    mapRestore: mapPersistenceStatus,
    requiredTripPoints: requiredTripPoints.length,
    coveredTripPoints: coverage.coveredPointCount,
    activeConvoy,
    convoyStatus,
  });

  return <FieldPulseStrip items={items} onOpen={onOpen} compact={compact} />;
}
