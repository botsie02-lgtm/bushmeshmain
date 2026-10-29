import {useMemo} from 'react';

import {getConvoyFreshness} from '../convoy/convoy';
import {useBushMesh} from '../state/BushMeshContext';
import {useConvoy} from '../state/ConvoyContext';
import {useConvoyRecovery} from '../state/ConvoyRecoveryContext';
import {useOfflineMaps} from '../state/OfflineMapContext';
import {useRadioSession} from '../state/RadioSessionContext';
import {
  BushMeshFieldDiagnosticsReport,
  createFieldDiagnosticsReport,
} from './fieldDiagnostics';

export function useFieldDiagnosticsReport(
  capturedAtMs: number,
): BushMeshFieldDiagnosticsReport {
  const {
    connectionStatus,
    channels,
    activeChannelIndex,
    channelMessages,
    contacts,
    deviceStatus,
    contactPersistenceStatus,
    messagePersistenceStatus,
  } = useBushMesh();
  const {vehicles, localPosition} = useConvoy();
  const {incidents} = useConvoyRecovery();
  const {
    snapshot: radio,
    nativeRuntime,
    persistenceStatus: outboxPersistenceStatus,
  } = useRadioSession();
  const {coverage, mapPersistenceStatus} = useOfflineMaps();

  return useMemo(() => {
    let staleVehicleCount = 0;
    let lostVehicleCount = 0;
    vehicles.forEach(vehicle => {
      const freshness = getConvoyFreshness(vehicle.receivedAtMs, capturedAtMs);
      if (freshness === 'stale') {
        staleVehicleCount += 1;
      } else if (freshness === 'lost') {
        lostVehicleCount += 1;
      }
    });

    const activeRecoveryIncidentCount = incidents.filter(
      incident => incident.status === 'active',
    ).length;

    return createFieldDiagnosticsReport({
      capturedAtMs,
      appConnectionStatus: connectionStatus,
      radioTransportReady: radio.transportReady,
      radioIdentityRef: radio.identityRef,
      radioProfile: radio.radioProfile
        ? {
            frequencyMhz: radio.radioProfile.frequencyMhz,
            spreadingFactor: radio.radioProfile.modem?.spreadingFactor ?? null,
            bandwidthKhz: radio.radioProfile.modem?.bandwidthKhz ?? null,
            codingRate: radio.radioProfile.modem?.codingRate ?? null,
            txPowerDbm: radio.radioProfile.txPower,
          }
        : null,
      radioRuntimeRequested: radio.runtimeRequested,
      nativeRuntimeRunning: nativeRuntime.running,
      nativeRuntimeOwnership: nativeRuntime.ownership,
      queuedCount: radio.queuedCount,
      inflightCount: radio.inflightCount,
      acceptedCount: radio.acceptedCount,
      failedCount: radio.failedCount,
      cancelledCount: radio.cancelledCount,
      activeChannelIndex,
      channelCount: channels.length,
      messageCount: channelMessages.length,
      contactCount: contacts.length,
      batteryMv: deviceStatus?.batteryMv ?? null,
      storagePercent: deviceStatus?.storagePercent ?? null,
      localPosition,
      convoyVehicleCount: vehicles.length,
      staleVehicleCount,
      lostVehicleCount,
      activeRecoveryIncidentCount,
      recoveredIncidentCount: incidents.length - activeRecoveryIncidentCount,
      readyMapPackCount: coverage.readyPackIds.length,
      tripCoverageComplete: coverage.complete,
      tripCoveredPointCount: coverage.coveredPointCount,
      tripTotalPointCount: coverage.totalPointCount,
      contactPersistenceStatus,
      messagePersistenceStatus,
      outboxPersistenceStatus,
      mapPersistenceStatus,
    });
  }, [
    activeChannelIndex,
    capturedAtMs,
    channelMessages.length,
    channels.length,
    connectionStatus,
    contactPersistenceStatus,
    contacts.length,
    coverage.complete,
    coverage.coveredPointCount,
    coverage.readyPackIds.length,
    coverage.totalPointCount,
    deviceStatus?.batteryMv,
    deviceStatus?.storagePercent,
    incidents,
    localPosition,
    mapPersistenceStatus,
    messagePersistenceStatus,
    nativeRuntime.ownership,
    nativeRuntime.running,
    outboxPersistenceStatus,
    radio,
    vehicles,
  ]);
}
