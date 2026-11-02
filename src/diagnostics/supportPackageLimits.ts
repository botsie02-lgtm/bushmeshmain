import type {BushMeshSupportPackage} from './supportPackage';

export const BUSHMESH_SUPPORT_PACKAGE_MAX_BYTES = 256 * 1024;
export const BUSHMESH_SUPPORT_TRACE_MAX_EVENTS = 80;
export const BUSHMESH_SUPPORT_TRACE_DETAIL_MAX_CHARS = 400;
export const BUSHMESH_SUPPORT_TRACE_CODE_MAX_CHARS = 96;

export type SupportPackageLimitAudit = {
  valid: boolean;
  estimatedBytes: number;
  violations: string[];
};

function utf8ByteLength(value: string): number {
  // TextEncoder exists in modern JS runtimes, but this pure calculation keeps
  // diagnostics usable in React Native/Jest without depending on a global.
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
      index += 1;
    }
  }
  return bytes;
}

export function auditSupportPackageLimits(
  supportPackage: BushMeshSupportPackage,
): SupportPackageLimitAudit {
  const violations: string[] = [];
  const trace = supportPackage.bundle.eventTrace;

  if (trace.length > BUSHMESH_SUPPORT_TRACE_MAX_EVENTS) {
    violations.push(
      `Event trace exceeds ${BUSHMESH_SUPPORT_TRACE_MAX_EVENTS} entries.`,
    );
  }

  trace.forEach((event, index) => {
    if (event.code.length > BUSHMESH_SUPPORT_TRACE_CODE_MAX_CHARS) {
      violations.push(`Event trace item ${index} has an oversized code.`);
    }
    if (event.detail.length > BUSHMESH_SUPPORT_TRACE_DETAIL_MAX_CHARS) {
      violations.push(`Event trace item ${index} has an oversized detail string.`);
    }
    if (!Number.isFinite(event.occurredAtMs) || event.occurredAtMs < 0) {
      violations.push(`Event trace item ${index} has an invalid timestamp.`);
    }
  });

  const encoded = JSON.stringify(supportPackage);
  const estimatedBytes = utf8ByteLength(encoded);
  if (estimatedBytes > BUSHMESH_SUPPORT_PACKAGE_MAX_BYTES) {
    violations.push(
      `Support package exceeds ${BUSHMESH_SUPPORT_PACKAGE_MAX_BYTES} bytes.`,
    );
  }

  return {
    valid: violations.length === 0,
    estimatedBytes,
    violations,
  };
}

export function assertSupportPackageLimits(
  supportPackage: BushMeshSupportPackage,
): void {
  const audit = auditSupportPackageLimits(supportPackage);
  if (!audit.valid) {
    throw new Error(
      `Bushmesh support package failed size/shape limits: ${audit.violations.join(' ')}`,
    );
  }
}
