import {DiagnosticHealthAssessment, assessFieldDiagnostics} from './diagnosticHealth';
import {
  DiagnosticEventCorrelation,
  correlateFieldEvents,
} from './eventCorrelation';
import {FieldChecklist, buildFieldChecklist} from './fieldChecklist';
import {BushMeshFieldDiagnosticsReport} from './fieldDiagnostics';
import {
  FieldScenarioResult,
  evaluateFieldScenarios,
} from './fieldScenarios';
import {
  FieldTestRunSummary,
  summarizeLatestFieldTestRun,
} from './fieldTestRun';
import {
  PhoneRuntimeHealthAssessment,
  assessPhoneRuntimeHealth,
} from './phoneRuntimeHealth';
import {SupportRuntimeMetadata} from './runtimeMetadata';
import {DiagnosticSnapshotDiff} from './snapshotDiff';
import {fieldReportSupportCode} from './supportCode';
import {
  BushMeshFieldSupportBundle,
  SupportBundleTraceEvent,
  createFieldSupportBundle,
} from './supportBundle';
import {assertFieldSupportBundlePrivacy} from './supportBundlePrivacy';
import {assertSupportPackageLimits} from './supportPackageLimits';
import {FieldTriagePlan, buildFieldTriagePlan} from './triagePlan';

export const BUSHMESH_SUPPORT_PACKAGE_VERSION = 1;

export type BushMeshSupportPackage = {
  packageVersion: number;
  supportCode: string;
  generatedAt: string;
  runtime: SupportRuntimeMetadata | null;
  runtimeHealth: PhoneRuntimeHealthAssessment;
  bundle: BushMeshFieldSupportBundle;
  checklist: FieldChecklist;
  triage: FieldTriagePlan;
  correlations: DiagnosticEventCorrelation[];
  testRun: FieldTestRunSummary | null;
  scenarios: FieldScenarioResult[];
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
  const triage = buildFieldTriagePlan(checklist);
  const correlations = correlateFieldEvents(input.eventTrace);
  const testRun = summarizeLatestFieldTestRun(input.eventTrace, generatedAtMs);
  const scenarios = evaluateFieldScenarios(input.eventTrace);
  const runtime = input.runtime ? {...input.runtime} : null;
  const runtimeHealth = assessPhoneRuntimeHealth(runtime);
  const bundle = createFieldSupportBundle({
    report: input.report,
    health,
    eventTrace: input.eventTrace,
    traceCapacity: input.traceCapacity,
    generatedAtMs,
  });

  assertFieldSupportBundlePrivacy(bundle);

  const supportPackage: BushMeshSupportPackage = {
    packageVersion: BUSHMESH_SUPPORT_PACKAGE_VERSION,
    supportCode: fieldReportSupportCode(input.report),
    generatedAt: new Date(generatedAtMs).toISOString(),
    runtime,
    runtimeHealth,
    bundle,
    checklist,
    triage,
    correlations,
    testRun,
    scenarios,
    comparison: input.comparison ?? null,
  };

  assertSupportPackageLimits(supportPackage);
  return supportPackage;
}

export function serializeBushMeshSupportPackage(
  supportPackage: BushMeshSupportPackage,
): string {
  // Re-audit immediately before serialization so callers cannot mutate the
  // embedded bundle after construction and bypass either safety boundary.
  assertFieldSupportBundlePrivacy(supportPackage.bundle);
  assertSupportPackageLimits(supportPackage);
  return `${JSON.stringify(supportPackage, null, 2)}\n`;
}
