import {BushMeshSupportPackage} from './supportPackage';

function line(label: string, value: string | number): string {
  return `${label}: ${value}`;
}

export function renderBushMeshSupportSummary(
  supportPackage: BushMeshSupportPackage,
): string {
  const report = supportPackage.bundle.report;
  const health = supportPackage.bundle.health;
  const runtime = supportPackage.runtime;
  const testRun = supportPackage.testRun;

  const lines: string[] = [
    `Bushmesh Support ${supportPackage.supportCode}`,
    line('Captured', report.capturedAt),
    line('Health', health.severity.toUpperCase()),
    line('Radio', report.radio.transportReady ? 'READY' : 'OFFLINE'),
    line('Radio owner', report.radio.nativeRuntimeOwnership),
    line(
      'Outbox',
      `${report.radio.outbox.queued} queued / ${report.radio.outbox.failed} failed / ${report.radio.outbox.accepted} accepted`,
    ),
    line('GPS', report.location.available ? 'AVAILABLE' : 'UNAVAILABLE'),
    line(
      'Convoy',
      `${report.convoy.vehicleCount} vehicles / ${report.convoy.staleVehicleCount} stale / ${report.convoy.lostVehicleCount} lost`,
    ),
    line(
      'Offline maps',
      `${report.maps.coveredPointCount}/${report.maps.totalPointCount} required points`,
    ),
    line(
      'Persistence',
      `contacts ${report.persistence.contacts}, messages ${report.persistence.messages}, outbox ${report.persistence.outbox}, maps ${report.persistence.maps}`,
    ),
  ];

  if (runtime) {
    lines.push(
      line(
        'App',
        `${runtime.appVersion ?? 'unknown'} build ${runtime.buildNumber ?? 'unknown'} / API ${runtime.platformApiLevel ?? 'unknown'} / ${runtime.architecture ?? 'unknown ABI'}`,
      ),
    );
    lines.push(
      line(
        'Phone',
        `${runtime.phoneBatteryPercent ?? 'unknown'}% / charging ${runtime.charging === null ? 'unknown' : runtime.charging ? 'yes' : 'no'} / saver ${runtime.powerSaveMode === null ? 'unknown' : runtime.powerSaveMode ? 'on' : 'off'} / health ${supportPackage.runtimeHealth.severity.toUpperCase()}`,
      ),
    );
  }

  lines.push(
    line(
      'Checklist',
      `${supportPackage.checklist.passCount} pass / ${supportPackage.checklist.checkCount} check / ${supportPackage.checklist.blockedCount} blocked`,
    ),
  );

  if (testRun) {
    lines.push(
      line(
        'Field run',
        `${testRun.state} / ${Math.round(testRun.durationMs / 1000)}s / ${testRun.actionEventCount} action / ${testRun.watchEventCount} watch`,
      ),
    );
  }

  const firstTriage = supportPackage.triage.steps[0];
  if (firstTriage) {
    lines.push(line('Fix first', `${firstTriage.title} — ${firstTriage.action}`));
  }

  const scenarioSummary = supportPackage.scenarios
    .map(scenario => `${scenario.title}: ${scenario.state}`)
    .join(' | ');
  if (scenarioSummary) {
    lines.push(line('Field drills', scenarioSummary));
  }

  lines.push(
    '',
    'Privacy: no message text, channel secrets, contact names, full radio identity or exact GPS coordinates are included.',
  );

  return `${lines.join('\n')}\n`;
}
