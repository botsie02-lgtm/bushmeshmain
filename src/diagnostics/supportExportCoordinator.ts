import {FieldTraceEvent} from '../state/FieldEventTraceContext';
import {fieldDiagnosticSession} from './diagnosticSession';
import {BushMeshFieldDiagnosticsReport} from './fieldDiagnostics';
import {loadSupportRuntimeMetadata} from './runtimeMetadata';
import {
  BushMeshSupportPackage,
  createBushMeshSupportPackage,
  serializeBushMeshSupportPackage,
} from './supportPackage';

export type PreparedFieldSupportExport = {
  supportPackage: BushMeshSupportPackage;
  serialized: string;
  supportCode: string;
  filename: string;
};

function exportFilename(capturedAt: string, supportCode: string): string {
  const safeTimestamp = capturedAt.replace(/[:.]/g, '-');
  const safeCode = supportCode.replace(/[^A-Z0-9-]/gi, '');
  return `Bushmesh_Field_Report_${safeTimestamp}_${safeCode}.json`;
}

export async function prepareFieldSupportExport(input: {
  report: BushMeshFieldDiagnosticsReport;
  eventTrace: FieldTraceEvent[];
}): Promise<PreparedFieldSupportExport> {
  const session = fieldDiagnosticSession.capture(input.report);
  const runtime = await loadSupportRuntimeMetadata();
  const supportPackage = createBushMeshSupportPackage({
    report: input.report,
    eventTrace: input.eventTrace.map(event => ({...event})),
    comparison: session.diff,
    runtime,
    traceCapacity: 80,
  });
  const serialized = serializeBushMeshSupportPackage(supportPackage);

  return {
    supportPackage,
    serialized,
    supportCode: supportPackage.supportCode,
    filename: exportFilename(input.report.capturedAt, supportPackage.supportCode),
  };
}
