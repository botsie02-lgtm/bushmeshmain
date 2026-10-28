import {formatDistance} from './convoy';
import {ConvoyRecoveryIncident} from '../state/ConvoyRecoveryContext';

export type ConvoyRecoveryReport = {
  version: 1;
  incidentId: string;
  vehicleId: string;
  vehicleName: string;
  status: 'active' | 'recovered';
  worstState: 'stale' | 'lost';
  startedAtMs: number;
  escalatedToLostAtMs: number | null;
  resolvedAtMs: number | null;
  durationMs: number | null;
  lastKnown: {
    latitude: number;
    longitude: number;
    receivedAtMs: number;
    accuracyMeters: number | null;
    snrDb: number | null;
    pathLength: number | null;
  };
  reacquired: {
    latitude: number;
    longitude: number;
    receivedAtMs: number;
    accuracyMeters: number | null;
    snrDb: number | null;
    pathLength: number | null;
  } | null;
  reacquisitionOffsetMeters: number | null;
  eventCount: number;
  summary: string;
};

function formatDuration(durationMs: number | null, startedAtMs: number): string {
  const elapsedMs = durationMs ?? Math.max(0, Date.now() - startedAtMs);
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3_600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function buildConvoyRecoveryReport(
  incident: ConvoyRecoveryIncident,
): ConvoyRecoveryReport {
  const duration = formatDuration(incident.durationMs, incident.startedAtMs);
  const state = incident.worstState === 'lost' ? 'lost' : 'stale';
  const outcome =
    incident.status === 'recovered'
      ? incident.reacquisitionOffsetMeters === null
        ? `reacquired after ${duration}`
        : `reacquired after ${duration}, ${formatDistance(
            incident.reacquisitionOffsetMeters,
          )} from last known`
      : `still active after ${duration}`;

  return {
    version: 1,
    incidentId: incident.id,
    vehicleId: incident.vehicleId,
    vehicleName: incident.vehicleName,
    status: incident.status,
    worstState: incident.worstState,
    startedAtMs: incident.startedAtMs,
    escalatedToLostAtMs: incident.escalatedToLostAtMs,
    resolvedAtMs: incident.resolvedAtMs,
    durationMs: incident.durationMs,
    lastKnown: {...incident.lastKnown},
    reacquired: incident.reacquired ? {...incident.reacquired} : null,
    reacquisitionOffsetMeters: incident.reacquisitionOffsetMeters,
    eventCount: incident.eventIds.length,
    summary: `${incident.vehicleName} ${state} incident: ${outcome}.`,
  };
}

export function serializeConvoyRecoveryReport(
  report: ConvoyRecoveryReport,
): string {
  return JSON.stringify(report, null, 2);
}
