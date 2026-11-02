import {BushMeshFieldDiagnosticsReport} from './fieldDiagnostics';

export type DiagnosticHealthSeverity = 'ok' | 'watch' | 'action';

export type DiagnosticHealthIssue = {
  code: string;
  severity: Exclude<DiagnosticHealthSeverity, 'ok'>;
  title: string;
  detail: string;
};

export type DiagnosticHealthAssessment = {
  severity: DiagnosticHealthSeverity;
  issues: DiagnosticHealthIssue[];
  summary: string;
};

function persistenceIssue(
  key: string,
  label: string,
  status: string,
): DiagnosticHealthIssue | null {
  if (status === 'ready' || status === 'unsupported') {
    return null;
  }

  return {
    code: `persistence-${key}`,
    severity: status === 'error' ? 'action' : 'watch',
    title: `${label} persistence ${status}`,
    detail:
      status === 'error'
        ? `${label} durable storage reported an error. New state may not survive an app or device restart.`
        : `${label} durable storage is still ${status}; avoid assuming recovery state is safely committed yet.`,
  };
}

export function assessFieldDiagnostics(
  report: BushMeshFieldDiagnosticsReport,
): DiagnosticHealthAssessment {
  const issues: DiagnosticHealthIssue[] = [];

  if (report.radio.runtimeRequested && !report.radio.transportReady) {
    issues.push({
      code: 'radio-runtime-without-transport',
      severity: 'action',
      title: 'Radio runtime has no live transport',
      detail:
        'Bushmesh wants the radio runtime active, but the current transport is not ready. Check BLE ownership, reconnect state and the node power/link.',
    });
  } else if (!report.radio.transportReady) {
    issues.push({
      code: 'radio-offline',
      severity: 'watch',
      title: 'Radio transport is offline',
      detail:
        'No live MeshCore transport is available. Convoy traffic can remain queued but cannot transmit until the link returns.',
    });
  }

  if (report.radio.outbox.failed > 0) {
    issues.push({
      code: 'outbox-failures',
      severity: 'action',
      title: 'Radio outbox has failed traffic',
      detail: `${report.radio.outbox.failed} outbound entr${
        report.radio.outbox.failed === 1 ? 'y has' : 'ies have'
      } exhausted retry handling. Review radio availability and protocol acceptance before clearing evidence.`,
    });
  }

  if (report.radio.outbox.queued > 0 && !report.radio.transportReady) {
    issues.push({
      code: 'outbox-waiting-offline',
      severity: 'watch',
      title: 'Outbound traffic is waiting for radio',
      detail: `${report.radio.outbox.queued} packet${
        report.radio.outbox.queued === 1 ? ' is' : 's are'
      } queued while the transport is unavailable.`,
    });
  }

  if (!report.location.available) {
    issues.push({
      code: 'gps-unavailable',
      severity: 'watch',
      title: 'Local GPS fix is unavailable',
      detail:
        'Located quick actions and current self-position broadcasting cannot be trusted until a local fix is available.',
    });
  }

  if (report.convoy.lostVehicleCount > 0) {
    issues.push({
      code: 'convoy-lost',
      severity: 'action',
      title: 'Convoy member position is lost',
      detail: `${report.convoy.lostVehicleCount} vehicle${
        report.convoy.lostVehicleCount === 1 ? ' has' : 's have'
      } exceeded the LOST freshness threshold. Last-known coordinates are not current positions.`,
    });
  } else if (report.convoy.staleVehicleCount > 0) {
    issues.push({
      code: 'convoy-stale',
      severity: 'watch',
      title: 'Convoy positions are aging',
      detail: `${report.convoy.staleVehicleCount} vehicle${
        report.convoy.staleVehicleCount === 1 ? ' is' : 's are'
      } stale and should not be treated as live gap information.`,
    });
  }

  if (
    report.maps.totalPointCount > 0 &&
    !report.maps.tripCoverageComplete
  ) {
    issues.push({
      code: 'map-coverage-incomplete',
      severity: 'action',
      title: 'Offline trip map coverage is incomplete',
      detail: `${report.maps.coveredPointCount} of ${report.maps.totalPointCount} required trip points are covered by verified local map packs.`,
    });
  }

  const persistenceChecks: Array<DiagnosticHealthIssue | null> = [
    persistenceIssue('contacts', 'Contact', report.persistence.contacts),
    persistenceIssue('messages', 'Message', report.persistence.messages),
    persistenceIssue('outbox', 'Outbox', report.persistence.outbox),
    persistenceIssue('maps', 'Map', report.persistence.maps),
  ];
  persistenceChecks.forEach(issue => {
    if (issue) {
      issues.push(issue);
    }
  });

  const actionCount = issues.filter(issue => issue.severity === 'action').length;
  const watchCount = issues.length - actionCount;
  const severity: DiagnosticHealthSeverity =
    actionCount > 0 ? 'action' : watchCount > 0 ? 'watch' : 'ok';

  const summary =
    severity === 'ok'
      ? 'No immediate field-health issues are visible in this snapshot.'
      : severity === 'action'
        ? `${actionCount} issue${actionCount === 1 ? '' : 's'} need attention before relying on the affected Bushmesh functions.`
        : `${watchCount} condition${watchCount === 1 ? '' : 's'} should be monitored.`;

  return {severity, issues, summary};
}
