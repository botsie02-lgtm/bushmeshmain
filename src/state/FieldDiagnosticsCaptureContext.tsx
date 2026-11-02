import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {fieldDiagnosticSession} from '../diagnostics/diagnosticSession';
import {BushMeshFieldDiagnosticsReport} from '../diagnostics/fieldDiagnostics';
import {DiagnosticSnapshotDiff} from '../diagnostics/snapshotDiff';
import {useFieldDiagnosticsReport} from '../diagnostics/useFieldDiagnosticsReport';

type FieldDiagnosticsCaptureContextValue = {
  report: BushMeshFieldDiagnosticsReport;
  comparison: DiagnosticSnapshotDiff | null;
  captureCount: number;
  capture: () => void;
  resetComparisonHistory: () => void;
};

const FieldDiagnosticsCaptureContext =
  createContext<FieldDiagnosticsCaptureContextValue | null>(null);

export function FieldDiagnosticsCaptureProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [captureClockMs, setCaptureClockMs] = useState(Date.now());
  const liveReport = useFieldDiagnosticsReport(captureClockMs);
  const liveReportRef = useRef(liveReport);
  liveReportRef.current = liveReport;

  const [capturedReport, setCapturedReport] =
    useState<BushMeshFieldDiagnosticsReport>(liveReport);
  const [comparison, setComparison] = useState<DiagnosticSnapshotDiff | null>(null);
  const [captureCount, setCaptureCount] = useState(0);

  useEffect(() => {
    const report = liveReportRef.current;
    setCapturedReport(report);
    const snapshot = fieldDiagnosticSession.capture(report);
    setComparison(snapshot.diff);
    setCaptureCount(snapshot.captureCount);
  }, [captureClockMs]);

  const capture = useCallback(() => {
    setCaptureClockMs(previous => Math.max(Date.now(), previous + 1));
  }, []);

  const resetComparisonHistory = useCallback(() => {
    const reset = fieldDiagnosticSession.clear();
    setComparison(reset.diff);
    setCaptureCount(reset.captureCount);
    setCaptureClockMs(previous => Math.max(Date.now(), previous + 1));
  }, []);

  const value = useMemo<FieldDiagnosticsCaptureContextValue>(
    () => ({
      report: capturedReport,
      comparison,
      captureCount,
      capture,
      resetComparisonHistory,
    }),
    [capturedReport, comparison, captureCount, capture, resetComparisonHistory],
  );

  return (
    <FieldDiagnosticsCaptureContext.Provider value={value}>
      {children}
    </FieldDiagnosticsCaptureContext.Provider>
  );
}

export function useFieldDiagnosticsCapture(): FieldDiagnosticsCaptureContextValue {
  const context = useContext(FieldDiagnosticsCaptureContext);
  if (!context) {
    throw new Error(
      'useFieldDiagnosticsCapture must be used inside FieldDiagnosticsCaptureProvider',
    );
  }
  return context;
}
