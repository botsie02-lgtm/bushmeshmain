import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {NativeSpeechStatus, nativeSpeech} from '../native/NativeSpeech';

export type SpeechRuntimeState =
  | 'loading'
  | 'ready'
  | 'initializing'
  | 'unavailable'
  | 'error';

type SpeechContextValue = {
  supported: boolean;
  criticalAlertsEnabled: boolean;
  radioMessagesEnabled: boolean;
  runtimeState: SpeechRuntimeState;
  languageTag: string | null;
  errorMessage: string | null;
  setCriticalAlertsEnabled: (enabled: boolean) => Promise<void>;
  setRadioMessagesEnabled: (enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
};

const SpeechContext = createContext<SpeechContextValue | null>(null);

function runtimeStateFromStatus(status: NativeSpeechStatus): SpeechRuntimeState {
  if (status.initialized && !status.failed) {
    return 'ready';
  }
  if (status.initializing) {
    return 'initializing';
  }
  return 'unavailable';
}

export function SpeechProvider({children}: {children: React.ReactNode}): React.JSX.Element {
  const supported = nativeSpeech.isSupported();
  const [criticalAlertsEnabled, setCriticalEnabledState] = useState(false);
  const [radioMessagesEnabled, setRadioMessagesEnabledState] = useState(false);
  const [runtimeState, setRuntimeState] =
    useState<SpeechRuntimeState>(supported ? 'loading' : 'unavailable');
  const [languageTag, setLanguageTag] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) {
      setCriticalEnabledState(false);
      setRadioMessagesEnabledState(false);
      setRuntimeState('unavailable');
      setLanguageTag(null);
      setErrorMessage(null);
      return;
    }

    try {
      const status = await nativeSpeech.getStatus();
      setCriticalEnabledState(status.criticalAlertsEnabled);
      setRadioMessagesEnabledState(status.radioMessagesEnabled);
      setRuntimeState(runtimeStateFromStatus(status));
      setLanguageTag(status.languageTag);
      setErrorMessage(null);
    } catch (error) {
      setRuntimeState('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not read speech status.',
      );
    }
  }, [supported]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const setCriticalAlertsEnabled = useCallback(
    async (enabled: boolean) => {
      if (!supported) {
        setCriticalEnabledState(false);
        return;
      }

      try {
        const persisted = await nativeSpeech.setCriticalAlertsEnabled(enabled);
        setCriticalEnabledState(persisted);
        setErrorMessage(null);
        if (!persisted) {
          await nativeSpeech.stop();
        }
        await refresh();
      } catch (error) {
        setRuntimeState('error');
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Could not update speech alert preference.',
        );
      }
    },
    [refresh, supported],
  );

  const setRadioMessagesEnabled = useCallback(
    async (enabled: boolean) => {
      if (!supported) {
        setRadioMessagesEnabledState(false);
        return;
      }

      try {
        const persisted = await nativeSpeech.setRadioMessagesEnabled(enabled);
        setRadioMessagesEnabledState(persisted);
        setErrorMessage(null);
        await refresh();
      } catch (error) {
        setRuntimeState('error');
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Could not update radio read-aloud preference.',
        );
      }
    },
    [refresh, supported],
  );

  const value = useMemo<SpeechContextValue>(
    () => ({
      supported,
      criticalAlertsEnabled,
      radioMessagesEnabled,
      runtimeState,
      languageTag,
      errorMessage,
      setCriticalAlertsEnabled,
      setRadioMessagesEnabled,
      refresh,
    }),
    [
      supported,
      criticalAlertsEnabled,
      radioMessagesEnabled,
      runtimeState,
      languageTag,
      errorMessage,
      setCriticalAlertsEnabled,
      setRadioMessagesEnabled,
      refresh,
    ],
  );

  return <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>;
}

export function useSpeech(): SpeechContextValue {
  const context = useContext(SpeechContext);
  if (!context) {
    throw new Error('useSpeech must be used inside SpeechProvider');
  }
  return context;
}