import {BushMeshQuickActionCode} from '../bushmesh/protocol';
import {DriveAlert} from '../state/DriveContext';

export const SPOKEN_CRITICAL_ACTIONS = new Set<BushMeshQuickActionCode>([
  BushMeshQuickActionCode.Stop,
  BushMeshQuickActionCode.Hazard,
  BushMeshQuickActionCode.Regroup,
  BushMeshQuickActionCode.Help,
]);

export function isSpeakableCriticalAlert(
  alert: DriveAlert,
  nowMs = Date.now(),
): boolean {
  return (
    alert.source === 'radio' &&
    SPOKEN_CRITICAL_ACTIONS.has(alert.action) &&
    (alert.expiresAtMs === null || alert.expiresAtMs > nowMs)
  );
}

export function speechForCriticalAlert(alert: DriveAlert): string {
  switch (alert.action) {
    case BushMeshQuickActionCode.Stop:
      return 'Bushmesh stop. Convoy stop requested.';
    case BushMeshQuickActionCode.Hazard:
      return 'Bushmesh hazard. Hazard reported ahead.';
    case BushMeshQuickActionCode.Regroup:
      return 'Bushmesh regroup. Regroup requested.';
    case BushMeshQuickActionCode.Help:
      return 'Bushmesh help. Assistance requested.';
    default:
      return `Bushmesh alert. ${alert.label}.`;
  }
}
