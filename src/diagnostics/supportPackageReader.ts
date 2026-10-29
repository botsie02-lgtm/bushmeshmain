import {
  BUSHMESH_SUPPORT_PACKAGE_VERSION,
  BushMeshSupportPackage,
} from './supportPackage';
import {
  BUSHMESH_FIELD_SUPPORT_BUNDLE_VERSION,
  BushMeshFieldSupportBundle,
} from './supportBundle';
import {assertFieldSupportBundlePrivacy} from './supportBundlePrivacy';
import {assertSupportPackageLimits} from './supportPackageLimits';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireNumber(
  value: unknown,
  label: string,
  integer = false,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`Invalid support package ${label}.`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid support package ${label}.`);
  }
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid support package ${label}.`);
  }
  return value;
}

function validateBundleShape(value: unknown): BushMeshFieldSupportBundle {
  if (!isRecord(value)) {
    throw new Error('Invalid support bundle payload.');
  }

  const bundleVersion = requireNumber(value.bundleVersion, 'bundle version', true);
  if (bundleVersion !== BUSHMESH_FIELD_SUPPORT_BUNDLE_VERSION) {
    throw new Error(
      `Unsupported Bushmesh support bundle version ${bundleVersion}.`,
    );
  }

  requireNumber(value.reportSchemaVersion, 'report schema version', true);
  requireString(value.generatedAt, 'bundle generatedAt');
  if (value.source !== 'bushmesh-field-report') {
    throw new Error('Unsupported Bushmesh support bundle source.');
  }
  if (!isRecord(value.completeness)) {
    throw new Error('Invalid support bundle completeness metadata.');
  }
  if (!isRecord(value.report)) {
    throw new Error('Invalid support bundle report.');
  }
  if (!isRecord(value.health)) {
    throw new Error('Invalid support bundle health assessment.');
  }
  requireArray(value.eventTrace, 'event trace');

  return value as unknown as BushMeshFieldSupportBundle;
}

/**
 * Parses an exported diagnostics package as untrusted input.
 *
 * This performs the structural checks needed before handing the package to
 * version-specific support tooling, then re-runs the same privacy and size
 * gates used during export. Imported diagnostics are not authenticated and do
 * not prove device identity.
 */
export function parseBushMeshSupportPackage(json: string): BushMeshSupportPackage {
  if (typeof json !== 'string' || json.trim() === '') {
    throw new Error('Bushmesh support package is empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Bushmesh support package is not valid JSON.');
  }

  if (!isRecord(parsed)) {
    throw new Error('Bushmesh support package root must be an object.');
  }

  const packageVersion = requireNumber(
    parsed.packageVersion,
    'package version',
    true,
  );
  if (packageVersion !== BUSHMESH_SUPPORT_PACKAGE_VERSION) {
    throw new Error(`Unsupported Bushmesh support package version ${packageVersion}.`);
  }

  requireString(parsed.supportCode, 'support code');
  requireString(parsed.generatedAt, 'generatedAt');
  const bundle = validateBundleShape(parsed.bundle);
  if (!isRecord(parsed.checklist)) {
    throw new Error('Invalid support package checklist.');
  }
  if (!isRecord(parsed.triage)) {
    throw new Error('Invalid support package triage plan.');
  }
  requireArray(parsed.correlations, 'correlations');
  requireArray(parsed.scenarios, 'field scenarios');
  if (parsed.testRun !== null && !isRecord(parsed.testRun)) {
    throw new Error('Invalid support package field test run.');
  }
  if (parsed.comparison !== null && !isRecord(parsed.comparison)) {
    throw new Error('Invalid support package comparison.');
  }
  if (parsed.runtime !== null && !isRecord(parsed.runtime)) {
    throw new Error('Invalid support package runtime metadata.');
  }
  if (!isRecord(parsed.runtimeHealth)) {
    throw new Error('Invalid support package runtime health assessment.');
  }

  const supportPackage = {
    ...parsed,
    bundle,
  } as unknown as BushMeshSupportPackage;

  assertFieldSupportBundlePrivacy(supportPackage.bundle);
  assertSupportPackageLimits(supportPackage);
  return supportPackage;
}
