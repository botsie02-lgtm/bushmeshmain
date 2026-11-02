import {assessPhoneRuntimeHealth} from './phoneRuntimeHealth';
import {fieldReportSupportCode} from './supportCode';
import type {BushMeshSupportPackage} from './supportPackage';

export type SupportPackageIntegrityAudit = {
  consistent: boolean;
  violations: string[];
};

/**
 * Internal-consistency checks only. This is not a cryptographic signature and
 * must never be interpreted as proof of origin, device identity or tamper
 * resistance.
 */
export function auditSupportPackageIntegrity(
  supportPackage: BushMeshSupportPackage,
): SupportPackageIntegrityAudit {
  const violations: string[] = [];
  const bundle = supportPackage.bundle;
  const report = bundle.report;
  const completeness = bundle.completeness;

  if (supportPackage.supportCode !== fieldReportSupportCode(report)) {
    violations.push('Support code does not match the embedded redacted report.');
  }

  if (bundle.reportSchemaVersion !== report.schemaVersion) {
    violations.push('Bundle report schema version does not match the report.');
  }

  if (completeness.traceEventCount !== bundle.eventTrace.length) {
    violations.push('Trace event count metadata does not match the event trace.');
  }

  if (completeness.traceCapacity < completeness.traceEventCount) {
    violations.push('Trace event count exceeds the declared trace capacity.');
  }

  const expectedTruncated =
    completeness.traceEventCount >= completeness.traceCapacity;
  if (completeness.traceMayBeTruncated !== expectedTruncated) {
    violations.push('Trace truncation metadata is internally inconsistent.');
  }

  const timestamps = bundle.eventTrace
    .map(event => event.occurredAtMs)
    .filter(timestamp => Number.isFinite(timestamp));
  const expectedOldest =
    timestamps.length === 0
      ? null
      : new Date(Math.min(...timestamps)).toISOString();
  const expectedNewest =
    timestamps.length === 0
      ? null
      : new Date(Math.max(...timestamps)).toISOString();

  if (completeness.oldestTraceEventAt !== expectedOldest) {
    violations.push('Oldest trace timestamp metadata does not match the trace.');
  }
  if (completeness.newestTraceEventAt !== expectedNewest) {
    violations.push('Newest trace timestamp metadata does not match the trace.');
  }

  if (bundle.generatedAt !== supportPackage.generatedAt) {
    violations.push('Package and bundle generation timestamps do not match.');
  }

  const expectedRuntimeHealth = assessPhoneRuntimeHealth(supportPackage.runtime);
  if (
    JSON.stringify(supportPackage.runtimeHealth) !==
    JSON.stringify(expectedRuntimeHealth)
  ) {
    violations.push(
      'Runtime health assessment does not match the embedded runtime metadata.',
    );
  }

  const reportCapturedAtMs = Date.parse(report.capturedAt);
  const packageGeneratedAtMs = Date.parse(supportPackage.generatedAt);
  if (
    Number.isFinite(reportCapturedAtMs) &&
    Number.isFinite(packageGeneratedAtMs) &&
    packageGeneratedAtMs < reportCapturedAtMs
  ) {
    violations.push('Support package predates the embedded report capture.');
  }

  return {
    consistent: violations.length === 0,
    violations,
  };
}

export function assertSupportPackageIntegrity(
  supportPackage: BushMeshSupportPackage,
): void {
  const audit = auditSupportPackageIntegrity(supportPackage);
  if (!audit.consistent) {
    throw new Error(
      `Bushmesh support package failed consistency checks: ${audit.violations.join(' ')}`,
    );
  }
}
