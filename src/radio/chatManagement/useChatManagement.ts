import {useCallback, useEffect, useRef, useState} from 'react';
import {useRadioConnection} from '../../state/RadioConnectionContext';
import {
  ChatConfiguration, ChatPreferencePatch, ChatPreferenceSnapshot, chatPreferenceStore,
} from './chatPreferences';

/** Mount once in the messenger; use the returned controller for inbox and rooms. */
export function useChatManagement() {
  const connection = useRadioConnection();
  const radio = connection.getChatRadio();
  const live = useRef(connection);
  live.current = connection;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedRadio, setLoadedRadio] = useState<string | null>(null);
  const [configs, setConfigs] = useState<ChatConfiguration[]>([]);
  const [preferences, setPreferences] = useState<ChatPreferenceSnapshot>({});
  const [ready, setReady] = useState(false);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    if (busyRef.current) throw new Error('Chat management is busy.');
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (failure) {
      // Do not surface raw bridge errors: some inputs are channel credentials.
      setError('Chat operation could not be confirmed. Refresh chats before retrying.');
      throw failure;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const reload = useCallback(async (expected: string) => {
    setReady(false);
    const entries = await chatPreferenceStore.load();
    const next = await live.current.listChatConfigurations(expected);
    if (live.current.getChatRadio() !== expected) throw new Error('Radio changed.');
    setPreferences(entries);
    setConfigs(next);
    setLoadedRadio(expected);
    setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    const expected = live.current.getChatRadio();
    if (!expected) throw new Error('Connect a radio and sync its identity first.');
    await run(() => reload(expected));
  }, [reload, run]);

  useEffect(() => {
    setReady(false);
    setLoadedRadio(null);
    setConfigs([]);
    setPreferences({});
    setError(null);
    // Explicit refresh avoids an automatic provisioning scan racing startup sync.
  }, [radio]);

  const requireCurrent = (chat: ChatConfiguration) => {
    if (!ready || loadedRadio !== chat.radio ||
        live.current.getChatRadio() !== chat.radio ||
        !configs.some(c => c.id === chat.id)) {
      throw new Error('Chat changed. Refresh chats.');
    }
  };

  const update = (chat: ChatConfiguration, patch: ChatPreferencePatch) =>
    run(async () => {
      requireCurrent(chat);
      // Purely local changes are keyed to the selected configuration, not a slot.
      const entries = await chatPreferenceStore.update(chat.id, patch);
      if (live.current.getChatRadio() === chat.radio) setPreferences(entries);
    });

  const provision = (expectedRadio: string, input: {name: string; secretHex?: string}) =>
    run(async () => {
      if (live.current.getChatRadio() !== expectedRadio) throw new Error('Radio changed.');
      const chat = await live.current.provisionChat(expectedRadio, input);
      await reload(expectedRadio);
      return chat;
    });

  const leave = (chat: ChatConfiguration) => run(async () => {
    requireCurrent(chat);
    await live.current.leaveChat(chat);
    await reload(chat.radio);
  });

  const credential = (chat: ChatConfiguration) => run(async () => {
    requireCurrent(chat);
    const value = await live.current.revealChatCredential(chat);
    if (live.current.getChatRadio() !== chat.radio) throw new Error('Radio changed.');
    return value;
  });

  return {
    radio, busy, error, ready: ready && radio === loadedRadio,
    chats: ready && radio === loadedRadio ? configs : [],
    preferences: ready && radio === loadedRadio ? preferences : {},
    refresh, update, provision, leave, credential,
    isCurrentRadio: (expected: string) => live.current.getChatRadio() === expected,
    radioBusy: connection.snapshot.isWriting,
  };
}

export type ChatManagementController = ReturnType<typeof useChatManagement>;
