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
export type BushMeshMessageDeliveryStatus =
  | 'pending'
  | 'accepted'
  | 'confirmed'
  | 'failed';
export type BushMeshChannelMessage = {
  id: string;
  channelIndex: string;
  channelName: string;
  text: string;
  direction: 'sent' | 'received';
  status: BushMeshMessageDeliveryStatus;
  createdAt: string;
};
type BushMeshChannelMessageInput = Omit<
  BushMeshChannelMessage,
  'id' | 'createdAt' | 'status'
> & {
  // Compatibility with callers from the pre-delivery-state UI. Shared state
  // immediately migrates this legacy label to "accepted".
  status: BushMeshMessageDeliveryStatus | 'sent';
};
export type BushMeshDurableChannelMessageInput = BushMeshChannelMessageInput & {
  id: string;
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
  addLocalChannelMessage: (message: BushMeshChannelMessageInput) => void;
  addDurableChannelMessage: (
    message: BushMeshDurableChannelMessageInput,
  ) => Promise<boolean>;
  updateChannelMessageStatus: (
    messageId: string,
    status: BushMeshMessageDeliveryStatus,
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
  const channelMessagesRef = useRef<BushMeshChannelMessage[]>([]);
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

  const queueMessageSnapshotWrite = useCallback(
    (messages: BushMeshChannelMessage[]): Promise<void> => {
      if (!androidMessagePersistence.isSupported()) {
        return Promise.resolve();
      }

      const snapshot = createMessageSnapshot(messages, Date.now());
      const operation = messageWriteChainRef.current.then(async () => {
        if (snapshot.messages.length === 0) {
          await androidMessagePersistence.clear();
        } else {
          await androidMessagePersistence.save(snapshot);
        }
      });

      const reported = operation
        .then(() => {
          setMessagePersistenceStatus('ready');
          setMessagePersistenceError(null);
        })
        .catch(error => {
          setMessagePersistenceStatus('error');
          setMessagePersistenceError(
            error instanceof Error
              ? error.message
              : 'Encrypted Bushmesh message history could not be saved.',
          );
          throw error;
        });

      // Keep the serialization chain alive even after one failed write while
      // still returning the real failure to callers that need durability.
      messageWriteChainRef.current = reported.catch(() => undefined);
      return reported;
    },
    [],
  );

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
        if (active) {
          const restored = snapshot?.messages ?? [];
          const merged = createMessageSnapshot(
            [...channelMessagesRef.current, ...restored],
            Date.now(),
          ).messages;
          channelMessagesRef.current = merged;
          setChannelMessages(merged);
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
            channelMessagesRef.current = [];
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
    channelMessagesRef.current = channelMessages;

    if (
      !androidMessagePersistence.isSupported() ||
      !messagePersistenceReadyRef.current
    ) {
      return;
    }

    queueMessageSnapshotWrite(channelMessages).catch(() => undefined);
  }, [channelMessages, queueMessageSnapshotWrite]);

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
    channelMessagesRef.current = [];
    setChannelMessages([]);
  }, []);

  const addLocalChannelMessage = useCallback(
    (message: BushMeshChannelMessageInput) => {
      const normalizedStatus: BushMeshMessageDeliveryStatus =
        message.status === 'sent' ? 'accepted' : message.status;
      const nowMs = Date.now();
      const next = createMessageSnapshot(
        [
          {
            ...message,
            status: normalizedStatus,
            id: `${nowMs}-${Math.random().toString(16).slice(2)}`,
            createdAt: new Date(nowMs).toISOString(),
          },
          ...channelMessagesRef.current,
        ],
        nowMs,
      ).messages;
      channelMessagesRef.current = next;
      setChannelMessages(next);
    },
    [],
  );

  const addDurableChannelMessage = useCallback(
    async (message: BushMeshDurableChannelMessageInput): Promise<boolean> => {
      const id = message.id.trim();
      if (!id) {
        throw new Error('Durable Bushmesh message requires a stable id.');
      }
      if (!Number.isFinite(Date.parse(message.createdAt))) {
        throw new Error('Durable Bushmesh message has an invalid timestamp.');
      }
      if (
        androidMessagePersistence.isSupported() &&
        !messagePersistenceReadyRef.current
      ) {
        throw new Error('Encrypted message history is still restoring.');
      }

      if (channelMessagesRef.current.some(existing => existing.id === id)) {
        return false;
      }

      const normalizedStatus: BushMeshMessageDeliveryStatus =
        message.status === 'sent' ? 'accepted' : message.status;
      const durableMessage: BushMeshChannelMessage = {
        ...message,
        id,
        status: normalizedStatus,
      };

      if (!androidMessagePersistence.isSupported()) {
        const next = createMessageSnapshot(
          [durableMessage, ...channelMessagesRef.current],
          Date.now(),
        ).messages;
        channelMessagesRef.current = next;
        setChannelMessages(next);
        return true;
      }

      let inserted = false;
      const operation = messageWriteChainRef.current.then(async () => {
        if (channelMessagesRef.current.some(existing => existing.id === id)) {
          return;
        }

        const snapshot = createMessageSnapshot(
          [durableMessage, ...channelMessagesRef.current],
          Date.now(),
        );
        await androidMessagePersistence.save(snapshot);

        // Merge against the newest in-memory state after the durable write in
        // case a local message arrived while Android storage was completing.
        const latest = createMessageSnapshot(
          [durableMessage, ...channelMessagesRef.current],
          Date.now(),
        ).messages;
        channelMessagesRef.current = latest;
        setChannelMessages(latest);
        setMessagePersistenceStatus('ready');
        setMessagePersistenceError(null);
        inserted = true;
      });

      const reported = operation.catch(error => {
        setMessagePersistenceStatus('error');
        setMessagePersistenceError(
          error instanceof Error
            ? error.message
            : 'Recovered radio message could not be written to encrypted history.',
        );
        throw error;
      });
      messageWriteChainRef.current = reported.catch(() => undefined);
      await reported;
      return inserted;
    },
    [],
  );

  const updateChannelMessageStatus = useCallback(
    (messageId: string, status: BushMeshMessageDeliveryStatus) => {
      const next = channelMessagesRef.current.map(message =>
        message.id === messageId ? {...message, status} : message,
      );
      channelMessagesRef.current = next;
      setChannelMessages(next);
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
      addDurableChannelMessage,
      updateChannelMessageStatus,
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
      addDurableChannelMessage,
      updateChannelMessageStatus,
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