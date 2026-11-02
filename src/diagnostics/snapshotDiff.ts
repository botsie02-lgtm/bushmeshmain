import {BushMeshFieldDiagnosticsReport} from './fieldDiagnostics';

export type DiagnosticChangeSeverity = 'info' | 'watch' | 'action';

export type DiagnosticSnapshotChange = {
  code: string;
  severity: DiagnosticChangeSeverity;
  title: string;
  detail: string;
};

export type DiagnosticSnapshotDiff = {
  beforeCapturedAt: string;
  afterCapturedAt: string;
  changes: DiagnosticSnapshotChange[];
  actionCount: number;
  watchCount: number;
  infoCount: number;
};

function pushCountChange(
  changes: DiagnosticSnapshotChange[],
  input: {
    code: string;
    label: string;
    before: number;
    after: number;
    increaseSeverity: DiagnosticChangeSeverity;
    decreaseSeverity?: DiagnosticChangeSeverity;
  },
): void {
  if (input.before === input.after) {
    return;
  }

  const delta = input.after - input.before;
  changes.push({
    code: input.code,
    severity:
      delta > 0
        ? input.increaseSeverity
        : input.decreaseSeverity ?? 'info',
    title: `${input.label} ${delta > 0 ? 'increased' : 'decreased'}`,
    detail: `${input.label} changed from ${input.before} to ${input.after} (${delta > 0 ? '+' : ''}${delta}).`,
  });
}

export function diffFieldDiagnostics(
  before: BushMeshFieldDiagnosticsReport,
  after: BushMeshFieldDiagnosticsReport,
): DiagnosticSnapshotDiff {
  const changes: DiagnosticSnapshotChange[] = [];

  if (before.radio.transportReady !== after.radio.transportReady) {
    changes.push({
      code: after.radio.transportReady
        ? 'radio-transport-restored'
        : 'radio-transport-lost',
      severity: after.radio.transportReady ? 'info' : 'action',
      title: after.radio.transportReady
        ? 'Radio transport restored'
        : 'Radio transport lost',
      detail: after.radio.transportReady
        ? 'A live radio transport became available between snapshots.'
        : 'The live radio transport became unavailable between snapshots.',
    });
  }

  if (before.radio.nativeRuntimeOwnership !== after.radio.nativeRuntimeOwnership) {
    changes.push({
      code: 'native-ownership-changed',
      severity: 'info',
      title: 'Android radio ownership changed',
      detail: `Ownership changed from ${before.radio.nativeRuntimeOwnership} to ${after.radio.nativeRuntimeOwnership}.`,
    });
  }

  pushCountChange(changes, {
    code: 'outbox-queued-changed',
    label: 'Queued outbound traffic',
    before: before.radio.outbox.queued,
    after: after.radio.outbox.queued,
    increaseSeverity: after.radio.transportReady ? 'watch' : 'action',
  });
  pushCountChange(changes, {
    code: 'outbox-failed-changed',
    label: 'Failed outbound traffic',
    before: before.radio.outbox.failed,
    after: after.radio.outbox.failed,
    increaseSeverity: 'action',
  });

  if (before.location.available !== after.location.available) {
    changes.push({
      code: after.location.available ? 'gps-restored' : 'gps-lost',
      severity: after.location.available ? 'info' : 'watch',
      title: after.location.available ? 'GPS fix restored' : 'GPS fix lost',
      detail: after.location.available
        ? 'A local GPS fix became available between snapshots.'
        : 'The local GPS fix became unavailable between snapshots.',
    });
  }

  pushCountChange(changes, {
    code: 'convoy-stale-changed',
    label: 'Stale convoy vehicles',
    before: before.convoy.staleVehicleCount,
    after: after.convoy.staleVehicleCount,
    increaseSeverity: 'watch',
  });
  pushCountChange(changes, {
    code: 'convoy-lost-changed',
    label: 'Lost convoy vehicles',
    before: before.convoy.lostVehicleCount,
    after: after.convoy.lostVehicleCount,
    increaseSeverity: 'action',
  });
  pushCountChange(changes, {
    code: 'recovery-active-changed',
    label: 'Active recovery incidents',
    before: before.convoy.activeRecoveryIncidentCount,
    after: after.convoy.activeRecoveryIncidentCount,
    increaseSeverity: 'action',
  });

  if (before.maps.tripCoverageComplete !== after.maps.tripCoverageComplete) {
    changes.push({
      code: after.maps.tripCoverageComplete
        ? 'trip-coverage-restored'
        : 'trip-coverage-lost',
      severity: after.maps.tripCoverageComplete ? 'info' : 'action',
      title: after.maps.tripCoverageComplete
        ? 'Offline trip coverage restored'
        : 'Offline trip coverage became incomplete',
      detail: `${after.maps.coveredPointCount}/${after.maps.totalPointCount} required trip points are covered in the newer snapshot.`,
    });
  } else if (
    before.maps.coveredPointCount !== after.maps.coveredPointCount ||
    before.maps.totalPointCount !== after.maps.totalPointCount
  ) {
    changes.push({
      code: 'trip-coverage-count-changed',
      severity: after.maps.tripCoverageComplete ? 'info' : 'watch',
      title: 'Offline trip coverage changed',
      detail: `Coverage changed from ${before.maps.coveredPointCount}/${before.maps.totalPointCount} to ${after.maps.coveredPointCount}/${after.maps.totalPointCount} required trip points.`,
    });
  }

  const persistenceKeys = ['contacts', 'messages', 'outbox', 'maps'] as const;
  persistenceKeys.forEach(key => {
    const previous = before.persistence[key];
    const current = after.persistence[key];
    if (previous === current) {
      return;
    }

    changes.push({
      code: `persistence-${key}-changed`,
      severity:
        current === 'error'
          ? 'action'
          : current === 'ready'
            ? 'info'
            : 'watch',
      title: `${key} persistence changed`,
      detail: `${key} persistence changed from ${previous} to ${current}.`,
    });
  });

  const actionCount = changes.filter(change => change.severity === 'action').length;
  const watchCount = changes.filter(change => change.severity === 'watch').length;
  const infoCount = changes.length - actionCount - watchCount;

  return {
    beforeCapturedAt: before.capturedAt,
    afterCapturedAt: after.capturedAt,
    changes,
    actionCount,
    watchCount,
    infoCount,
  };
}
