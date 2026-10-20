import React, {useEffect, useMemo, useRef} from 'react';

import {nativeSpeech} from '../native/NativeSpeech';
import {
  isSpeakableCriticalAlert,
  speechForCriticalAlert,
} from '../speech/criticalAlertSpeech';
import {useDrive} from '../state/DriveContext';
import {useSpeech} from '../state/SpeechContext';

/**
 * Speaks only fresh radio-originated driver alerts that have already passed the
 * DriveContext replay/TTL filter. This deliberately excludes local previews,
 * local sends, position packets and routine acknowledgements.
 */
export function SpeechAlertBridge(): null {
  const {alerts} = useDrive();
  const {criticalAlertsEnabled, runtimeState} = useSpeech();
  const lastSpokenIdRef = useRef<string | null>(null);

  const newestSpeakable = useMemo(
    () => alerts.find(alert => isSpeakableCriticalAlert(alert)) ?? null,
    [alerts],
  );

  useEffect(() => {
    if (
      !criticalAlertsEnabled ||
      runtimeState !== 'ready' ||
      !newestSpeakable ||
      newestSpeakable.id === lastSpokenIdRef.current
    ) {
      return;
    }

    lastSpokenIdRef.current = newestSpeakable.id;
    nativeSpeech
      .speak(speechForCriticalAlert(newestSpeakable), true)
      .catch(() => {
        // Spoken alerts supplement the visible alert card. A missing or failed
        // Android voice must never suppress the primary visual safety path.
      });
  }, [criticalAlertsEnabled, newestSpeakable, runtimeState]);

  return null;
}
