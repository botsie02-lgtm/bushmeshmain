import {BushMeshFieldDiagnosticsReport} from './fieldDiagnostics';

/**
 * Produces a short, non-cryptographic identifier for a redacted field report.
 *
 * This is deliberately not an authenticity signature and must never be used as
 * a security decision. Its only purpose is helping a driver/support engineer
 * confirm that two references point to the same exported snapshot.
 */
export function fieldReportSupportCode(
  report: BushMeshFieldDiagnosticsReport,
): string {
  const payload = JSON.stringify(report);
  let hash = 0x811c9dc5;

  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const hex = hash.toString(16).toUpperCase().padStart(8, '0');
  return `BM-${hex.slice(0, 4)}-${hex.slice(4)}`;
}
