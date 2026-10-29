import {diffFieldDiagnostics} from './snapshotDiff';
import type {BushMeshSupportPackage} from './supportPackage';

export type SupportPackageComparison = {
  sameSupportCode: boolean;
  buildChanged: boolean;
  runtimeChanged: boolean;
  reportChanges: ReturnType<typeof diffFieldDiagnostics>;
  scenarioChanges: Array<{
    id: string;
    before: string | null;
    after: string | null;
  }>;
  summary: string;
};

function runtimeSignature(value: BushMeshSupportPackage['runtime']): string {
  if (!value) {
    return 'none';
  }
  return JSON.stringify({
    platform: value.platform,
    appVersion: value.appVersion,
    buildNumber: value.buildNumber,
    platformApiLevel: value.platformApiLevel,
    architecture: value.architecture,
    debugBuild: value.debugBuild,
    phoneBatteryPercent: value.phoneBatteryPercent,
    charging: value.charging,
    powerSaveMode: value.powerSaveMode,
    thermalStatus: value.thermalStatus,
  });
}

function buildSignature(value: BushMeshSupportPackage['runtime']): string {
  if (!value) {
    return 'none';
  }
  return JSON.stringify({
    platform: value.platform,
    appVersion: value.appVersion,
    buildNumber: value.buildNumber,
    platformApiLevel: value.platformApiLevel,
    architecture: value.architecture,
    debugBuild: value.debugBuild,
  });
}

export function compareBushMeshSupportPackages(
  before: BushMeshSupportPackage,
  after: BushMeshSupportPackage,
): SupportPackageComparison {
  const beforeScenarios = new Map(
    before.scenarios.map(scenario => [scenario.id, scenario.state]),
  );
  const afterScenarios = new Map(
    after.scenarios.map(scenario => [scenario.id, scenario.state]),
  );
  const scenarioIds = new Set([
    ...beforeScenarios.keys(),
    ...afterScenarios.keys(),
  ]);
  const scenarioChanges = [...scenarioIds]
    .map(id => ({
      id,
      before: beforeScenarios.get(id) ?? null,
      after: afterScenarios.get(id) ?? null,
    }))
    .filter(change => change.before !== change.after);

  const reportChanges = diffFieldDiagnostics(
    before.bundle.report,
    after.bundle.report,
  );
  const buildChanged =
    buildSignature(before.runtime) !== buildSignature(after.runtime);
  const runtimeChanged =
    runtimeSignature(before.runtime) !== runtimeSignature(after.runtime);

  const changeParts: string[] = [];
  if (buildChanged) {
    changeParts.push('app/runtime build changed');
  }
  if (reportChanges.changes.length > 0) {
    changeParts.push(
      `${reportChanges.changes.length} tracked field-state change${
        reportChanges.changes.length === 1 ? '' : 's'
      }`,
    );
  }
  if (scenarioChanges.length > 0) {
    changeParts.push(
      `${scenarioChanges.length} drill-state change${
        scenarioChanges.length === 1 ? '' : 's'
      }`,
    );
  }
  if (!buildChanged && runtimeChanged) {
    changeParts.push('handset runtime conditions changed');
  }

  return {
    sameSupportCode: before.supportCode === after.supportCode,
    buildChanged,
    runtimeChanged,
    reportChanges,
    scenarioChanges,
    summary:
      changeParts.length > 0
        ? `Compared support packages: ${changeParts.join('; ')}.`
        : 'Compared support packages show no tracked differences.',
  };
}
