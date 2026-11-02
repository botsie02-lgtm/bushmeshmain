import type {BushMeshSupportPackage} from './supportPackage';
import {auditSupportPackageIntegrity} from './supportPackageIntegrity';
import {auditSupportPackageLimits} from './supportPackageLimits';
import {auditFieldSupportBundlePrivacy} from './supportBundlePrivacy';

export type SupportPackageValidationResult = {
  valid: boolean;
  privacyViolations: string[];
  limitViolations: string[];
  integrityViolations: string[];
};

export function validateBushMeshSupportPackage(
  supportPackage: BushMeshSupportPackage,
): SupportPackageValidationResult {
  const privacy = auditFieldSupportBundlePrivacy(supportPackage.bundle);
  const limits = auditSupportPackageLimits(supportPackage);
  const integrity = auditSupportPackageIntegrity(supportPackage);

  return {
    valid: privacy.safe && limits.valid && integrity.consistent,
    privacyViolations: [...privacy.violations],
    limitViolations: [...limits.violations],
    integrityViolations: [...integrity.violations],
  };
}

export function assertBushMeshSupportPackageValid(
  supportPackage: BushMeshSupportPackage,
): void {
  const validation = validateBushMeshSupportPackage(supportPackage);
  if (validation.valid) {
    return;
  }

  const reasons = [
    ...validation.privacyViolations.map(reason => `privacy: ${reason}`),
    ...validation.limitViolations.map(reason => `limits: ${reason}`),
    ...validation.integrityViolations.map(reason => `consistency: ${reason}`),
  ];

  throw new Error(
    `Bushmesh support package validation failed: ${reasons.join(' ')}`,
  );
}
