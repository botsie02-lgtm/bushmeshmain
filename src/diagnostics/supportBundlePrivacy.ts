import type {BushMeshFieldSupportBundle} from './supportBundle';

export type SupportBundlePrivacyAudit = {
  safe: boolean;
  violations: string[];
};

const FORBIDDEN_KEY_PATTERNS = [
  /(^|_)secret$/i,
  /channelSecret/i,
  /messageText/i,
  /messageBody/i,
  /contactName/i,
  /fullPublicKey/i,
  /privateKey/i,
  /password/i,
  /token$/i,
];

function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const text = value.toString().toLowerCase();
  if (text.includes('e-')) {
    const exponent = Number(text.split('e-')[1]);
    return Number.isFinite(exponent) ? exponent : 0;
  }
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function walkKeys(value: unknown, path: string, violations: string[]): void {
  if (value === null || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, `${path}[${index}]`, violations));
    return;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    if (FORBIDDEN_KEY_PATTERNS.some(pattern => pattern.test(key))) {
      violations.push(`Forbidden field ${path}.${key}`);
    }
    walkKeys(child, `${path}.${key}`, violations);
  });
}

/**
 * Performs a final export-time privacy audit of a Bushmesh support bundle.
 *
 * It is intentionally conservative and complements, rather than replaces, the
 * typed redacted report builder. A future schema change that accidentally adds
 * sensitive fields should fail export until explicitly reviewed.
 */
export function auditFieldSupportBundlePrivacy(
  bundle: BushMeshFieldSupportBundle,
): SupportBundlePrivacyAudit {
  const violations: string[] = [];

  if (
    bundle.report.privacy.exactLocationIncluded ||
    bundle.report.privacy.messageContentIncluded ||
    bundle.report.privacy.channelSecretsIncluded ||
    bundle.report.privacy.contactNamesIncluded ||
    bundle.report.privacy.fullRadioIdentityIncluded
  ) {
    violations.push('Report privacy declaration permits sensitive content.');
  }

  const coarse = bundle.report.location.coarse;
  if (coarse) {
    if (decimalPlaces(coarse.latitude) > 2 || decimalPlaces(coarse.longitude) > 2) {
      violations.push('Coarse diagnostic location exceeds 0.01-degree precision.');
    }
  }

  const identityHint = bundle.report.radio.identityHint;
  if (identityHint && !/^…[A-Z0-9]{1,6}$/.test(identityHint)) {
    violations.push('Radio identity hint is more detailed than the approved suffix format.');
  }

  walkKeys(bundle, 'bundle', violations);

  return {
    safe: violations.length === 0,
    violations,
  };
}

export function assertFieldSupportBundlePrivacy(
  bundle: BushMeshFieldSupportBundle,
): void {
  const audit = auditFieldSupportBundlePrivacy(bundle);
  if (!audit.safe) {
    throw new Error(
      `Bushmesh field support bundle failed privacy audit: ${audit.violations.join(' ')}`,
    );
  }
}
