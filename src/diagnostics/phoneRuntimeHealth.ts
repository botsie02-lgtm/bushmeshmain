import {SupportRuntimeMetadata} from './runtimeMetadata';

export type PhoneRuntimeSeverity = 'ok' | 'watch' | 'action';

export type PhoneRuntimeIssue = {
  code: string;
  severity: Exclude<PhoneRuntimeSeverity, 'ok'>;
  title: string;
  detail: string;
};

export type PhoneRuntimeHealthAssessment = {
  severity: PhoneRuntimeSeverity;
  issues: PhoneRuntimeIssue[];
  summary: string;
};

export function thermalStatusLabel(status: number | null): string {
  switch (status) {
    case 0:
      return 'NONE';
    case 1:
      return 'LIGHT';
    case 2:
      return 'MODERATE';
    case 3:
      return 'SEVERE';
    case 4:
      return 'CRITICAL';
    case 5:
      return 'EMERGENCY';
    case 6:
      return 'SHUTDOWN';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Advisory handset-health assessment only. Android power/thermal policies vary
 * by device and OS build, so WATCH/ACTION levels mean "inspect this before
 * relying on long-running field behavior", not a guaranteed cause of failure.
 */
export function assessPhoneRuntimeHealth(
  runtime: SupportRuntimeMetadata | null,
): PhoneRuntimeHealthAssessment {
  if (!runtime || runtime.platform === 'unknown') {
    return {
      severity: 'watch',
      issues: [
        {
          code: 'runtime-metadata-unavailable',
          severity: 'watch',
          title: 'Phone runtime metadata unavailable',
          detail:
            'Bushmesh could not read non-identifying handset battery/power/thermal metadata on this platform.',
        },
      ],
      summary: 'Phone runtime health could not be assessed from this capture.',
    };
  }

  const issues: PhoneRuntimeIssue[] = [];
  const battery = runtime.phoneBatteryPercent;

  if (battery !== null && runtime.charging !== true) {
    if (battery <= 15) {
      issues.push({
        code: 'phone-battery-critical',
        severity: 'action',
        title: 'Phone battery is low',
        detail: `Handset battery is ${battery}% and not reported as charging. Long-running GPS/BLE/background operation may not be dependable for the planned field window.`,
      });
    } else if (battery <= 30) {
      issues.push({
        code: 'phone-battery-watch',
        severity: 'watch',
        title: 'Phone battery should be monitored',
        detail: `Handset battery is ${battery}% and not reported as charging. Consider external power before a long off-grid run.`,
      });
    }
  }

  if (runtime.powerSaveMode === true) {
    issues.push({
      code: 'phone-power-saver',
      severity: 'watch',
      title: 'Android battery saver is enabled',
      detail:
        'Battery saver may change background scheduling or location behavior depending on the handset and Android build. Verify the background-radio drill under the actual setting you plan to use.',
    });
  }

  if (runtime.thermalStatus !== null) {
    if (runtime.thermalStatus >= 3) {
      issues.push({
        code: 'phone-thermal-severe',
        severity: 'action',
        title: `Phone thermal state is ${thermalStatusLabel(runtime.thermalStatus)}`,
        detail:
          'Android reports a severe-or-higher thermal condition. The OS may throttle work or protect the device; cool the handset before relying on extended navigation/radio behavior.',
      });
    } else if (runtime.thermalStatus === 2) {
      issues.push({
        code: 'phone-thermal-moderate',
        severity: 'watch',
        title: 'Phone thermal state is MODERATE',
        detail:
          'The handset is already thermally constrained. Watch for worsening temperature during continuous GPS, maps, BLE and speech use.',
      });
    }
  }

  const actionCount = issues.filter(issue => issue.severity === 'action').length;
  const watchCount = issues.length - actionCount;
  const severity: PhoneRuntimeSeverity =
    actionCount > 0 ? 'action' : watchCount > 0 ? 'watch' : 'ok';

  return {
    severity,
    issues,
    summary:
      severity === 'ok'
        ? 'No handset power or thermal conditions need attention in this reading.'
        : severity === 'action'
          ? `${actionCount} handset condition${actionCount === 1 ? '' : 's'} should be addressed before relying on extended field operation.`
          : `${watchCount} handset condition${watchCount === 1 ? '' : 's'} should be monitored during the field run.`,
  };
}
