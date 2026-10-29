import {BushMeshFieldDiagnosticsReport} from './fieldDiagnostics';
import {
  DiagnosticSnapshotDiff,
  diffFieldDiagnostics,
} from './snapshotDiff';

export type DiagnosticCapture = {
  report: BushMeshFieldDiagnosticsReport;
  capturedAtMs: number;
};

export type DiagnosticSessionSnapshot = {
  previous: DiagnosticCapture | null;
  current: DiagnosticCapture | null;
  diff: DiagnosticSnapshotDiff | null;
  captureCount: number;
};

function parseCapturedAt(report: BushMeshFieldDiagnosticsReport): number {
  const value = Date.parse(report.capturedAt);
  return Number.isFinite(value) ? value : Date.now();
}

function cloneReport(
  report: BushMeshFieldDiagnosticsReport,
): BushMeshFieldDiagnosticsReport {
  return {
    ...report,
    privacy: {...report.privacy},
    radio: {
      ...report.radio,
      profile: report.radio.profile ? {...report.radio.profile} : null,
      outbox: {...report.radio.outbox},
    },
    data: {...report.data},
    location: {
      ...report.location,
      coarse: report.location.coarse ? {...report.location.coarse} : null,
    },
    convoy: {...report.convoy},
    maps: {...report.maps},
    persistence: {...report.persistence},
  };
}

/**
 * In-memory field-diagnostics capture session.
 *
 * Only redacted reports enter this class. It intentionally retains just two
 * captures so comparing state does not become a hidden long-term telemetry
 * store. Export/persistence remains an explicit user action.
 */
export class FieldDiagnosticSession {
  private previous: DiagnosticCapture | null = null;
  private current: DiagnosticCapture | null = null;
  private captureCount = 0;

  capture(report: BushMeshFieldDiagnosticsReport): DiagnosticSessionSnapshot {
    const capture: DiagnosticCapture = {
      report: cloneReport(report),
      capturedAtMs: parseCapturedAt(report),
    };

    this.previous = this.current;
    this.current = capture;
    this.captureCount += 1;
    return this.getSnapshot();
  }

  clear(): DiagnosticSessionSnapshot {
    this.previous = null;
    this.current = null;
    this.captureCount = 0;
    return this.getSnapshot();
  }

  getSnapshot(): DiagnosticSessionSnapshot {
    const previous = this.previous
      ? {
          report: cloneReport(this.previous.report),
          capturedAtMs: this.previous.capturedAtMs,
        }
      : null;
    const current = this.current
      ? {
          report: cloneReport(this.current.report),
          capturedAtMs: this.current.capturedAtMs,
        }
      : null;

    return {
      previous,
      current,
      diff:
        previous && current
          ? diffFieldDiagnostics(previous.report, current.report)
          : null,
      captureCount: this.captureCount,
    };
  }
}

export const fieldDiagnosticSession = new FieldDiagnosticSession();
