import {DiagnosticHealthAssessment} from './diagnosticHealth';
import {BushMeshFieldDiagnosticsReport} from './fieldDiagnostics';
import {assertFieldSupportBundlePrivacy} from './supportBundlePrivacy';

export const BUSHMESH_FIELD_SUPPORT_BUNDLE_VERSION = 1;

export type SupportBundleTraceEvent = {
  id: string;
  occurredAtMs: number;
  category: string;
  severity: string;
  code: string;
  detail: string;
};

export type BushMeshFieldSupportBundle = {
  bundleVersion: number;
  reportSchemaVersion: number;
  generatedAt: string;
  source: 'bushmesh-field-report';
  completeness: {
    traceEventCount: number;
    traceCapacity: number;
    traceMayBeTruncated: boolean;
    oldestTraceEventAt: string | null;
    newestTraceEventAt: string | null;
  };
  report: BushMeshFieldDiagnosticsReport;
  health: DiagnosticHealthAssessment;
  eventTrace: SupportBundleTraceEvent[];
};

export function createFieldSupportBundle(input: {
  report: BushMeshFieldDiagnosticsReport;
  health: DiagnosticHealthAssessment;
  eventTrace: SupportBundleTraceEvent[];
  traceCapacity?: number;
  generatedAtMs?: number;
}): BushMeshFieldSupportBundle {
  const traceCapacity = Math.max(1, Math.floor(input.traceCapacity ?? 80));
  const eventTrace = input.eventTrace
    .filter(event => Number.isFinite(event.occurredAtMs))
    .slice(0, traceCapacity)
    .map(event => ({...event}));
  const timestamps = eventTrace.map(event => event.occurredAtMs);
  const oldest = timestamps.length > 0 ? Math.min(...timestamps) : null;
  const newest = timestamps.length > 0 ? Math.max(...timestamps) : null;
  const generatedAtMs = input.generatedAtMs ?? Date.now();

  return {
    bundleVersion: BUSHMESH_FIELD_SUPPORT_BUNDLE_VERSION,
    reportSchemaVersion: input.report.schemaVersion,
    generatedAt: new Date(generatedAtMs).toISOString(),
    source: 'bushmesh-field-report',
    completeness: {
      traceEventCount: eventTrace.length,
      traceCapacity,
      traceMayBeTruncated: eventTrace.length >= traceCapacity,
      oldestTraceEventAt: oldest === null ? null : new Date(oldest).toISOString(),
      newestTraceEventAt: newest === null ? null : new Date(newest).toISOString(),
    },
    report: input.report,
    health: {
      ...input.health,
      issues: input.health.issues.map(issue => ({...issue})),
    },
    eventTrace,
  };
}

export function serializeFieldSupportBundle(
  bundle: BushMeshFieldSupportBundle,
): string {
  assertFieldSupportBundlePrivacy(bundle);
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
