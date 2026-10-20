import React, {useEffect, useMemo, useRef} from 'react';

import {BushMeshQuickActionCode} from '../bushmesh/protocol';
import {nativeSpeech} from '../native/NativeSpeech';
import {DriveAlert, useDrive} from '../state/DriveContext';

const SPOKEN_ACTIONS = new Set<BushMeshQuickActionCode>([
  BushMeshQuickActionCode.Stop,
  BushMeshQuickActionCode.Hazard,
  BushMeshQuickActionCode.Regroup,
  BushMeshQuickActionCode.Help,
]);

function speechForAlert(alert: DriveAlert): string {
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

/**
 * Speaks only fresh radio-originated driver alerts that have already passed the
 * DriveContext replay/TTL filter. This deliberately excludes local previews,
 * local sends, position packets and routine acknowledgements.
 */
export function SpeechAlertBridge(): null {
  const {alerts} = useDrive();
  const lastSpokenIdRef = useRef<string | null>(null);

  const newestSpeakable = useMemo(
    () =>
      alerts.find(
        alert =>
          alert.source === 'radio' &&
          SPOKEN_ACTIONS.has(alert.action) &&
          (alert.expiresAtMs === null || alert.expiresAtMs > Date.now()),
      ) ?? null,
    [alerts],
  );

  useEffect(() => {
    if (!newestSpeakable || newestSpeakable.id === lastSpokenIdRef.current) {
      return;
    }

    lastSpokenIdRef.current = newestSpeakable.id;
    if (!nativeSpeech.isSupported()) {
      return;
    }

    nativeSpeech.speak(speechForAlert(newestSpeakable), true).catch(() => {
      // Spoken alerts supplement the visible alert card. A missing or failed
      // Android voice must never suppress the primary visual safety path.
    });
  }, [newestSpeakable]);

  return null;
}
