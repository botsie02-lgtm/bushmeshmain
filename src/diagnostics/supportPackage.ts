import {DiagnosticHealthAssessment, assessFieldDiagnostics} from './diagnosticHealth';
import {FieldChecklist, buildFieldChecklist} from './fieldChecklist';
import {BushMeshFieldDiagnosticsReport} from './fieldDiagnostics';
import {SupportRuntimeMetadata} from './runtimeMetadata';
import {DiagnosticSnapshotDiff} from './snapshotDiff';
import {fieldReportSupportCode} from './supportCode';
import {
  BushMeshFieldSupportBundle,
  SupportBundleTraceEvent,
  createFieldSupportBundle,
} from './supportBundle';
import {assertFieldSupportBundlePrivacy} from './supportBundlePrivacy';

export const BUSHMESH_SUPPORT_PACKAGE_VERSION = 1;

export type BushMeshSupportPackage = {
  packageVersion: number;
  supportCode: string;
  generatedAt: string;
  runtime: SupportRuntimeMetadata | null;
  bundle: BushMeshFieldSupportBundle;
  checklist: FieldChecklist;
  comparison: DiagnosticSnapshotDiff | null;
};

export function createBushMeshSupportPackage(input: {
  report: BushMeshFieldDiagnosticsReport;
  eventTrace: SupportBundleTraceEvent[];
  comparison?: DiagnosticSnapshotDiff | null;
  health?: DiagnosticHealthAssessment;
  runtime?: SupportRuntimeMetadata | null;
  traceCapacity?: number;
  generatedAtMs?: number;
}): BushMeshSupportPackage {
  const generatedAtMs = input.generatedAtMs ?? Date.now();
  const health = input.health ?? assessFieldDiagnostics(input.report);
  const checklist = buildFieldChecklist(input.report, health);
  const bundle = createFieldSupportBundle({
    report: input.report,
    health,
    eventTrace: input.eventTrace,
    traceCapacity: input.traceCapacity,
    generatedAtMs,
  });

  assertFieldSupportBundlePrivacy(bundle);

  return {
    packageVersion: BUSHMESH_SUPPORT_PACKAGE_VERSION,
    supportCode: fieldReportSupportCode(input.report),
    generatedAt: new Date(generatedAtMs).toISOString(),
    runtime: input.runtime ? {...input.runtime} : null,
    bundle,
    checklist,
    comparison: input.comparison ?? null,
  };
}

export function serializeBushMeshSupportPackage(
  supportPackage: BushMeshSupportPackage,
): string {
  // Re-audit immediately before serialization so callers cannot mutate the
  // embedded bundle after construction and bypass the export privacy gate.
  assertFieldSupportBundlePrivacy(supportPackage.bundle);
  return `${JSON.stringify(supportPackage, null, 2)}\n`;
}
