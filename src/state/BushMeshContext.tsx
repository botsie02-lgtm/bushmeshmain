import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {androidContactPersistence} from '../persistence/AndroidContactPersistence';
import {androidMessagePersistence} from '../persistence/AndroidMessagePersistence';
import {createContactSnapshot} from '../persistence/contactSnapshot';
import {createMessageSnapshot} from '../persistence/messageSnapshot';

export type BushMeshChannel = {
  channelIndex: string;
  channelName: string;
  secret: string;
};
export type BushMeshDeviceStatus = {
  batteryMv: number;
  batteryVolts: number;
  usedStorageKb: number | null;
  totalStorageKb: number | null;
  storagePercent: number | null;
};
export type BushMeshChannelMessage = {
  id: string;
  channelIndex: string;
  channelName: string;
  text: string;
  direction: 'sent' | 'received';
  status: 'sent' | 'failed' | 'pending';
  createdAt: string;
};
export type BushMeshContact = {
  publicKey: string;
  publicKeyPrefix: string;
  name: string;
  type: number;
  flags: number;
  outPathLength: number;
  lastAdvert: number | null;
  latitude: number | null;
  longitude: number | null;
  lastModified: number | null;
};
type BushMeshConnectionStatus = 'Disconnected' | 'Connected';
export type ContactPersistenceStatus =
  | 'restoring'
  | 'ready'
  | 'unsupported'
  | 'error';
export type MessagePersistenceStatus =
  | 'restoring'
  | 'ready'
  | 'unsupported'
  | 'error';

type SendChannelMessageHandler = (
  channelIndex: number,
  message: string,
) => Promise<void>;
type SyncContactsHandler = () => Promise<BushMeshContact[]>;

type BushMeshContextValue = {
  connectionStatus: BushMeshConnectionStatus;
  connectedDeviceName: string | null;
  channels: BushMeshChannel[];
  activeChannelIndex: string | null;
  activeChannel: BushMeshChannel | null;
  channelMessages: BushMeshChannelMessage[];
  canSendChannelMessage: boolean;
  canSyncContacts: boolean;
  deviceStatus: BushMeshDeviceStatus | null;
  contacts: BushMeshContact[];
  contactPersistenceStatus: ContactPersistenceStatus;
  contactPersistenceError: string | null;
  messagePersistenceStatus: MessagePersistenceStatus;
  messagePersistenceError: string | null;

  setContacts: (contacts: BushMeshContact[]) => void;
  setDeviceStatus: (status: BushMeshDeviceStatus | null) => void;
  setConnectionStatus: (status: BushMeshConnectionStatus) => void;
  setConnectedDeviceName: (name: string | null) => void;
  setChannels: (channels: BushMeshChannel[]) => void;
  setActiveChannelIndex: (channelIndex: string | null) => void;
  setSendChannelMessageHandler: (
    handler: SendChannelMessageHandler | null,
  ) => void;
  setSyncContactsHandler: (handler: SyncContactsHandler | null) => void;
  sendChannelMessage: (channelIndex: number, message: string) => Promise<void>;
  syncContacts: () => Promise<BushMeshContact[]>;
  addLocalChannelMessage: (
    message: Omit<BushMeshChannelMessage, 'id' | 'createdAt'>,
  ) => void;
  clearChannels: () => void;
  clearChannelMessages: () => void;
  clearContacts: () => void;
};

const BushMeshContext = createContext<BushMeshContextValue | null>(null);

export function BushMeshProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [contacts, setContactsState] = useState<BushMeshContact[]>([]);
  const [contactPersistenceStatus, setContactPersistenceStatus] =
    useState<ContactPersistenceStatus>(() =>
      androidContactPersistence.isSupported() ? 'restoring' : 'unsupported',
    );
  const [contactPersistenceError, setContactPersistenceError] = useState<
    string | null
  >(null);
  const contactWriteChainRef = useRef<Promise<void>>(Promise.resolve());

  const [connectionStatus, setConnectionStatus] =
    useState<BushMeshConnectionStatus>('Disconnected');
  const [connectedDeviceName, setConnectedDeviceName] = useState<string | null>(
    null,
  );
  const [channels, setChannelsState] = useState<BushMeshChannel[]>([]);
  const [activeChannelIndex, setActiveChannelIndex] = useState<string | null>(
    null,
  );
  const [deviceStatus, setDeviceStatus] = useState<BushMeshDeviceStatus | null>(
    null,
  );
  const [channelMessages, setChannelMessages] = useState<
    BushMeshChannelMessage[]
  >([]);
  const [messagePersistenceStatus, setMessagePersistenceStatus] =
    useState<MessagePersistenceStatus>(() =>
      androidMessagePersistence.isSupported() ? 'restoring' : 'unsupported',
    );
  const [messagePersistenceError, setMessagePersistenceError] = useState<
    string | null
  >(null);
  const messagePersistenceReadyRef = useRef(
    !androidMessagePersistence.isSupported(),
  );
  const messageWriteChainRef = useRef<Promise<void>>(Promise.resolve());

  const [sendChannelMessageHandlerState, setSendChannelMessageHandlerState] =
    useState<SendChannelMessageHandler | null>(null);
  const [syncContactsHandlerState, setSyncContactsHandlerState] =
    useState<SyncContactsHandler | null>(null);

  useEffect(() => {
    let active = true;

    const restoreContactBook = async () => {
      if (!androidContactPersistence.isSupported()) {
        if (active) {
          setContactPersistenceStatus('unsupported');
        }
        return;
      }

      try {
        const snapshot = await androidContactPersistence.load();
        if (snapshot && active) {
          setContactsState(snapshot.contacts);
        }
        if (active) {
          setContactPersistenceStatus('ready');
          setContactPersistenceError(null);
        }
      } catch (restoreError) {
        const restoreMessage =
          restoreError instanceof Error
            ? restoreError.message
            : 'Encrypted Bushmesh contacts could not be restored.';

        try {
          await androidContactPersistence.resetSecureStorage();
          if (active) {
            setContactsState([]);
            setContactPersistenceStatus('ready');
            setContactPersistenceError(
              `The previous encrypted contact book could not be authenticated and was discarded. Secure contact storage was re-keyed. ${restoreMessage}`,
            );
          }
        } catch (resetError) {
          if (active) {
            setContactPersistenceStatus('error');
            setContactPersistenceError(
              resetError instanceof Error
                ? `Contact restore failed (${restoreMessage}) and secure storage could not be reinitialized: ${resetError.message}`
                : `Contact restore failed (${restoreMessage}) and secure storage could not be reinitialized.`,
            );
          }
        }
      }
    };

    restoreContactBook().catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const restoreMessageHistory = async () => {
      if (!androidMessagePersistence.isSupported()) {
        messagePersistenceReadyRef.current = true;
        if (active) {
          setMessagePersistenceStatus('unsupported');
        }
        return;
      }

      try {
        const snapshot = await androidMessagePersistence.load();
        if (snapshot && active) {
          setChannelMessages(snapshot.messages);
        }
        messagePersistenceReadyRef.current = true;
        if (active) {
          setMessagePersistenceStatus('ready');
          setMessagePersistenceError(null);
        }
      } catch (restoreError) {
        const restoreMessage =
          restoreError instanceof Error
            ? restoreError.message
            : 'Encrypted Bushmesh message history could not be restored.';

        try {
          await androidMessagePersistence.resetSecureStorage();
          messagePersistenceReadyRef.current = true;
          if (active) {
            setChannelMessages([]);
            setMessagePersistenceStatus('ready');
            setMessagePersistenceError(
              `The previous encrypted radio history could not be authenticated and was discarded. Secure message storage was re-keyed. ${restoreMessage}`,
            );
          }
        } catch (resetError) {
          messagePersistenceReadyRef.current = true;
          if (active) {
            setMessagePersistenceStatus('error');
            setMessagePersistenceError(
              resetError instanceof Error
                ? `Message restore failed (${restoreMessage}) and secure storage could not be reinitialized: ${resetError.message}`
                : `Message restore failed (${restoreMessage}) and secure storage could not be reinitialized.`,
            );
          }
        }
      }
    };

    restoreMessageHistory().catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      messagePersistenceStatus !== 'ready' ||
      !androidMessagePersistence.isSupported() ||
      !messagePersistenceReadyRef.current
    ) {
      return;
    }

    const snapshot = createMessageSnapshot(channelMessages, Date.now());
    messageWriteChainRef.current = messageWriteChainRef.current
      .then(async () => {
        if (snapshot.messages.length === 0) {
          await androidMessagePersistence.clear();
          return;
        }
        await androidMessagePersistence.save(snapshot);
      })
      .then(() => setMessagePersistenceError(null))
      .catch(error => {
        setMessagePersistenceStatus('error');
        setMessagePersistenceError(
          error instanceof Error
            ? error.message
            : 'Encrypted Bushmesh message history could not be saved.',
        );
      });
  }, [channelMessages, messagePersistenceStatus]);

  const persistContacts = useCallback((nextContacts: BushMeshContact[]) => {
    if (!androidContactPersistence.isSupported()) {
      return;
    }

    const snapshot = createContactSnapshot(nextContacts, Date.now());
    contactWriteChainRef.current = contactWriteChainRef.current
      .then(() => androidContactPersistence.save(snapshot))
      .then(() => {
        setContactPersistenceStatus('ready');
        setContactPersistenceError(null);
      })
      .catch(error => {
        setContactPersistenceStatus('error');
        setContactPersistenceError(
          error instanceof Error
            ? error.message
            : 'Encrypted Bushmesh contacts could not be saved.',
        );
      });
  }, []);

  const setContacts = useCallback(
    (nextContacts: BushMeshContact[]) => {
      const normalized = createContactSnapshot(nextContacts, Date.now()).contacts;
      setContactsState(normalized);
      persistContacts(normalized);
    },
    [persistContacts],
  );

  /**
   * A radio disconnect is not a request to forget known people/nodes. Existing
   * DeviceScreen session cleanup calls this method, so it deliberately retains
   * the durable contact book. A future explicit "erase contact book" action can
   * clear both state and encrypted storage with a separate user-facing command.
   */
  const clearContacts = useCallback(() => undefined, []);

  const activeChannel =
    channels.find(channel => channel.channelIndex === activeChannelIndex) ??
    null;

  const setChannels = (nextChannels: BushMeshChannel[]) => {
    setChannelsState(nextChannels);

    setActiveChannelIndex(currentActiveIndex => {
      if (
        currentActiveIndex &&
        nextChannels.some(channel => channel.channelIndex === currentActiveIndex)
      ) {
        return currentActiveIndex;
      }

      const firstNamedChannel = nextChannels.find(
        channel => channel.channelName && channel.channelName !== 'Empty',
      );

      return firstNamedChannel?.channelIndex ?? null;
    });
  };

  const setSendChannelMessageHandler = (
    handler: SendChannelMessageHandler | null,
  ) => {
    setSendChannelMessageHandlerState(() => handler);
  };

  const setSyncContactsHandler = (handler: SyncContactsHandler | null) => {
    setSyncContactsHandlerState(() => handler);
  };

  const clearChannels = () => {
    setChannelsState([]);
    setActiveChannelIndex(null);
  };

  const clearChannelMessages = useCallback(() => {
    setChannelMessages([]);
  }, []);

  const addLocalChannelMessage = useCallback(
    (message: Omit<BushMeshChannelMessage, 'id' | 'createdAt'>) => {
      setChannelMessages(currentMessages =>
        createMessageSnapshot(
          [
            {
              ...message,
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              createdAt: new Date().toISOString(),
            },
            ...currentMessages,
          ],
          Date.now(),
        ).messages,
      );
    },
    [],
  );

  const sendChannelMessage = useCallback(
    async (channelIndex: number, message: string): Promise<void> => {
      if (!sendChannelMessageHandlerState) {
        throw new Error('No connected MeshCore client is ready for messaging.');
      }

      await sendChannelMessageHandlerState(channelIndex, message);
    },
    [sendChannelMessageHandlerState],
  );

  const syncContacts = useCallback(async (): Promise<BushMeshContact[]> => {
    if (!syncContactsHandlerState) {
      throw new Error('No connected MeshCore client is ready to sync contacts.');
    }

    const nextContacts = await syncContactsHandlerState();
    setContacts(nextContacts);
    return nextContacts;
  }, [setContacts, syncContactsHandlerState]);

  const value = useMemo<BushMeshContextValue>(
    () => ({
      connectionStatus,
      connectedDeviceName,
      channels,
      activeChannelIndex,
      activeChannel,
      channelMessages,
      deviceStatus,
      contacts,
      contactPersistenceStatus,
      contactPersistenceError,
      messagePersistenceStatus,
      messagePersistenceError,
      canSendChannelMessage: sendChannelMessageHandlerState !== null,
      canSyncContacts: syncContactsHandlerState !== null,
      setDeviceStatus,
      setContacts,
      setConnectionStatus,
      setConnectedDeviceName,
      setChannels,
      setActiveChannelIndex,
      setSendChannelMessageHandler,
      setSyncContactsHandler,
      sendChannelMessage,
      syncContacts,
      addLocalChannelMessage,
      clearChannels,
      clearChannelMessages,
      clearContacts,
    }),
    [
      connectionStatus,
      connectedDeviceName,
      channels,
      activeChannelIndex,
      activeChannel,
      channelMessages,
      deviceStatus,
      contacts,
      contactPersistenceStatus,
      contactPersistenceError,
      messagePersistenceStatus,
      messagePersistenceError,
      sendChannelMessageHandlerState,
      syncContactsHandlerState,
      setContacts,
      sendChannelMessage,
      syncContacts,
      addLocalChannelMessage,
      clearChannelMessages,
      clearContacts,
    ],
  );

  return (
    <BushMeshContext.Provider value={value}>
      {children}
    </BushMeshContext.Provider>
  );
}

export function useBushMesh(): BushMeshContextValue {
  const context = useContext(BushMeshContext);

  if (!context) {
    throw new Error('useBushMesh must be used inside BushMeshProvider');
  }

  return context;
}
