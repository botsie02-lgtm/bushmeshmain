import {DiagnosticHealthAssessment} from './diagnosticHealth';
import {BushMeshFieldDiagnosticsReport} from './fieldDiagnostics';

export type FieldChecklistState = 'pass' | 'check' | 'blocked';

export type FieldChecklistItem = {
  id: string;
  order: number;
  state: FieldChecklistState;
  title: string;
  expected: string;
  observed: string;
  nextAction: string | null;
};

export type FieldChecklist = {
  generatedAt: string;
  blockedCount: number;
  checkCount: number;
  passCount: number;
  items: FieldChecklistItem[];
};

export function buildFieldChecklist(
  report: BushMeshFieldDiagnosticsReport,
  health: DiagnosticHealthAssessment,
): FieldChecklist {
  const items: FieldChecklistItem[] = [];

  items.push({
    id: 'radio-transport',
    order: 10,
    state: report.radio.transportReady ? 'pass' : 'blocked',
    title: 'Radio transport',
    expected: 'MeshCore transport ready with an active Bushmesh identity.',
    observed: report.radio.transportReady
      ? `Ready${report.radio.identityHint ? ` as ${report.radio.identityHint}` : ''}.`
      : 'No live MeshCore transport.',
    nextAction: report.radio.transportReady
      ? null
      : 'Confirm node power, Bluetooth connection/ownership and reconnect state.',
  });

  items.push({
    id: 'rf-profile',
    order: 20,
    state:
      report.radio.profile &&
      report.radio.profile.frequencyMhz !== null &&
      report.radio.profile.spreadingFactor !== null &&
      report.radio.profile.bandwidthKhz !== null &&
      report.radio.profile.codingRate !== null
        ? 'pass'
        : 'check',
    title: 'RF profile',
    expected: 'Frequency, spreading factor, bandwidth and coding rate reported by the radio.',
    observed: report.radio.profile
      ? `${report.radio.profile.frequencyMhz ?? '—'} MHz · SF${report.radio.profile.spreadingFactor ?? '—'} · ${report.radio.profile.bandwidthKhz ?? '—'} kHz · CR ${report.radio.profile.codingRate ?? '—'}`
      : 'RF profile unavailable.',
    nextAction: report.radio.profile
      ? null
      : 'Reconnect and confirm SELF_INFO is received before relying on airtime diagnostics.',
  });

  items.push({
    id: 'outbox',
    order: 30,
    state:
      report.radio.outbox.failed > 0
        ? 'blocked'
        : report.radio.outbox.queued > 0
          ? 'check'
          : 'pass',
    title: 'Outbound queue',
    expected: 'No failed traffic; queued traffic drains when the radio is ready.',
    observed: `${report.radio.outbox.queued} queued · ${report.radio.outbox.inflight} in flight · ${report.radio.outbox.failed} failed.`,
    nextAction:
      report.radio.outbox.failed > 0
        ? 'Inspect radio acceptance/retry failures before clearing the failed entries.'
        : report.radio.outbox.queued > 0
          ? 'Watch the queue while restoring transport and confirm it drains without replaying stale positions.'
          : null,
  });

  items.push({
    id: 'gps',
    order: 40,
    state: report.location.available ? 'pass' : 'blocked',
    title: 'Local GPS',
    expected: 'A current local fix is available for POSITION and located actions.',
    observed: report.location.available
      ? 'Fix available; diagnostics retain only coarse coordinates.'
      : 'No local fix.',
    nextAction: report.location.available
      ? null
      : 'Enable location, move to open sky if necessary, and wait for a real fix before convoy testing.',
  });

  items.push({
    id: 'durable-storage',
    order: 50,
    state: Object.values(report.persistence).some(status => status === 'error')
      ? 'blocked'
      : Object.values(report.persistence).some(
            status => status !== 'ready' && status !== 'unsupported',
          )
        ? 'check'
        : 'pass',
    title: 'Durable storage',
    expected: 'Supported stores are ready and authenticated.',
    observed: `contacts ${report.persistence.contacts} · messages ${report.persistence.messages} · outbox ${report.persistence.outbox} · maps ${report.persistence.maps}.`,
    nextAction: Object.values(report.persistence).some(status => status === 'error')
      ? 'Resolve the failing secure store before testing process-death recovery.'
      : null,
  });

  const mapNeeded = report.maps.totalPointCount > 0;
  items.push({
    id: 'offline-maps',
    order: 60,
    state: !mapNeeded
      ? 'check'
      : report.maps.tripCoverageComplete
        ? 'pass'
        : 'blocked',
    title: 'Offline trip map coverage',
    expected: 'Every required trip point is covered by a verified local pack.',
    observed: mapNeeded
      ? `${report.maps.coveredPointCount}/${report.maps.totalPointCount} trip points covered by ${report.maps.readyPackCount} verified pack(s).`
      : `${report.maps.readyPackCount} verified pack(s); no required trip points defined.`,
    nextAction: !mapNeeded
      ? 'Define a test route/trip footprint before the final offline-navigation field run.'
      : report.maps.tripCoverageComplete
        ? null
        : 'Install or verify map packs covering the missing trip points before going offline.',
  });

  items.push({
    id: 'convoy-freshness',
    order: 70,
    state:
      report.convoy.lostVehicleCount > 0
        ? 'blocked'
        : report.convoy.staleVehicleCount > 0
          ? 'check'
          : report.convoy.vehicleCount > 0
            ? 'pass'
            : 'check',
    title: 'Convoy freshness',
    expected: 'Peer positions arrive and remain LIVE/RECENT during the test.',
    observed: `${report.convoy.vehicleCount} peers · ${report.convoy.staleVehicleCount} stale · ${report.convoy.lostVehicleCount} lost.`,
    nextAction:
      report.convoy.lostVehicleCount > 0
        ? 'Recover or explicitly request the missing vehicle position before treating convoy geometry as current.'
        : report.convoy.vehicleCount === 0
          ? 'Bring the second Bushmesh node online and confirm POSITION traffic reaches this phone.'
          : report.convoy.staleVehicleCount > 0
            ? 'Watch position cadence and link quality; stale coordinates are not current gap measurements.'
            : null,
  });

  items.push({
    id: 'field-health',
    order: 80,
    state:
      health.severity === 'action'
        ? 'blocked'
        : health.severity === 'watch'
          ? 'check'
          : 'pass',
    title: 'Overall field health',
    expected: 'No unresolved ACTION-level health findings.',
    observed: health.summary,
    nextAction:
      health.severity === 'ok'
        ? null
        : 'Work through the health findings above before declaring the field configuration ready.',
  });

  const sorted = items.sort((left, right) => left.order - right.order);
  const blockedCount = sorted.filter(item => item.state === 'blocked').length;
  const checkCount = sorted.filter(item => item.state === 'check').length;
  const passCount = sorted.length - blockedCount - checkCount;

  return {
    generatedAt: new Date().toISOString(),
    blockedCount,
    checkCount,
    passCount,
    items: sorted,
  };
}
