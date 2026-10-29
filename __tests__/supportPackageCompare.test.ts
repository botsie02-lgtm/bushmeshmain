import {
  createFieldDiagnosticsReport,
  type FieldDiagnosticsInput,
} from '../src/diagnostics/fieldDiagnostics';
import {
  createBushMeshSupportPackage,
  serializeBushMeshSupportPackage,
  type BushMeshSupportPackage,
} from '../src/diagnostics/supportPackage';
import {compareBushMeshSupportPackages} from '../src/diagnostics/supportPackageCompare';
import {parseBushMeshSupportPackage} from '../src/diagnostics/supportPackageReader';
import type {SupportRuntimeMetadata} from '../src/diagnostics/runtimeMetadata';
import type {SupportBundleTraceEvent} from '../src/diagnostics/supportBundle';

const BASE_RUNTIME: SupportRuntimeMetadata = {
  platform: 'android',
  appVersion: '0.0.1',
  buildNumber: 1,
  platformApiLevel: 35,
  architecture: 'arm64-v8a',
  debugBuild: true,
  phoneBatteryPercent: 80,
  charging: true,
  powerSaveMode: false,
  thermalStatus: 0,
};

const BASE_REPORT_INPUT: FieldDiagnosticsInput = {
  capturedAtMs: 1_000,
  appConnectionStatus: 'connected',
  radioTransportReady: true,
  radioIdentityRef: '00112233445566778899AABBCCDDEEFF',
  radioProfile: {
    frequencyMhz: 915,
    spreadingFactor: 9,
    bandwidthKhz: 125,
    codingRate: 5,
    txPowerDbm: 20,
  },
  radioRuntimeRequested: true,
  nativeRuntimeRunning: true,
  nativeRuntimeOwnership: 'app',
  queuedCount: 0,
  inflightCount: 0,
  acceptedCount: 2,
  failedCount: 0,
  cancelledCount: 0,
  activeChannelIndex: '0',
  channelCount: 1,
  messageCount: 2,
  contactCount: 1,
  batteryMv: 4100,
  storagePercent: 50,
  localPosition: {latitude: -37.81, longitude: 144.96},
  convoyVehicleCount: 2,
  staleVehicleCount: 0,
  lostVehicleCount: 0,
  activeRecoveryIncidentCount: 0,
  recoveredIncidentCount: 0,
  readyMapPackCount: 1,
  tripCoverageComplete: true,
  tripCoveredPointCount: 2,
  tripTotalPointCount: 2,
  contactPersistenceStatus: 'ready',
  messagePersistenceStatus: 'ready',
  outboxPersistenceStatus: 'ready',
  mapPersistenceStatus: 'ready',
};

function supportPackage(input?: {
  report?: Partial<FieldDiagnosticsInput>;
  runtime?: SupportRuntimeMetadata | null;
  trace?: SupportBundleTraceEvent[];
}): BushMeshSupportPackage {
  const report = createFieldDiagnosticsReport({
    ...BASE_REPORT_INPUT,
    ...input?.report,
  });

  return createBushMeshSupportPackage({
    report,
    eventTrace: input?.trace ?? [],
    runtime: input?.runtime === undefined ? BASE_RUNTIME : input.runtime,
    generatedAtMs: 2_000,
  });
}

describe('support package comparison', () => {
  test('reports no tracked differences for equivalent field runs', () => {
    const comparison = compareBushMeshSupportPackages(
      supportPackage(),
      supportPackage(),
    );

    expect(comparison.sameSupportCode).toBe(true);
    expect(comparison.buildChanged).toBe(false);
    expect(comparison.runtimeChanged).toBe(false);
    expect(comparison.reportChanges.changes).toEqual([]);
    expect(comparison.scenarioChanges).toEqual([]);
    expect(comparison.summary).toBe(
      'Compared support packages show no tracked differences.',
    );
  });

  test('separates handset runtime conditions from app build changes', () => {
    const comparison = compareBushMeshSupportPackages(
      supportPackage(),
      supportPackage({
        runtime: {
          ...BASE_RUNTIME,
          phoneBatteryPercent: 31,
          charging: false,
          powerSaveMode: true,
        },
      }),
    );

    expect(comparison.buildChanged).toBe(false);
    expect(comparison.runtimeChanged).toBe(true);
    expect(comparison.summary).toBe(
      'Compared support packages: handset runtime conditions changed.',
    );
  });

  test('identifies app/runtime build changes without double-counting conditions', () => {
    const comparison = compareBushMeshSupportPackages(
      supportPackage(),
      supportPackage({
        runtime: {
          ...BASE_RUNTIME,
          appVersion: '0.0.2',
          buildNumber: 2,
        },
      }),
    );

    expect(comparison.buildChanged).toBe(true);
    expect(comparison.runtimeChanged).toBe(true);
    expect(comparison.summary).toBe(
      'Compared support packages: app/runtime build changed.',
    );
  });

  test('reports field-state and drill-state changes together', () => {
    const handoffMarker: SupportBundleTraceEvent = {
      id: 'marker-1',
      occurredAtMs: 1_500,
      category: 'test',
      severity: 'info',
      code: 'test-marker-radio-handoff',
      detail: 'Deliberate radio handoff test marker.',
    };

    const comparison = compareBushMeshSupportPackages(
      supportPackage(),
      supportPackage({
        report: {radioTransportReady: false},
        trace: [handoffMarker],
      }),
    );

    expect(comparison.sameSupportCode).toBe(false);
    expect(comparison.reportChanges.changes.map(change => change.code)).toEqual([
      'radio-transport-lost',
    ]);
    expect(comparison.scenarioChanges).toEqual([
      {
        id: 'radio-handoff-recovery',
        before: 'not-started',
        after: 'in-progress',
      },
    ]);
    expect(comparison.summary).toBe(
      'Compared support packages: 1 tracked field-state change; 1 drill-state change.',
    );
  });

  test('round-trips derived runtime health through the validated import path', () => {
    const exported = supportPackage({
      runtime: {
        ...BASE_RUNTIME,
        phoneBatteryPercent: 12,
        charging: false,
      },
    });
    const imported = parseBushMeshSupportPackage(
      serializeBushMeshSupportPackage(exported),
    );

    expect(imported.runtimeHealth.severity).toBe('action');
    expect(imported.runtimeHealth.issues.map(issue => issue.code)).toContain(
      'phone-battery-critical',
    );
    expect(imported.supportCode).toBe(exported.supportCode);
  });

  test('rejects imported runtime health that contradicts runtime metadata', () => {
    const exported = supportPackage();
    const tampered = JSON.parse(
      serializeBushMeshSupportPackage(exported),
    ) as BushMeshSupportPackage;
    tampered.runtimeHealth = {
      severity: 'action',
      issues: [],
      summary: 'Contradictory imported assessment.',
    };

    expect(() => parseBushMeshSupportPackage(JSON.stringify(tampered))).toThrow(
      'Runtime health assessment does not match the embedded runtime metadata.',
    );
  });
});
