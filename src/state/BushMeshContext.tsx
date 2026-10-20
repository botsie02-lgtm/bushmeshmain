import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {publishBushMeshInboxFile} from '../bushmesh/runtime/BushMeshFileInboxHub';
import {
  BushMeshRuntimeSendResult,
  BushMeshRuntimeStats,
  BushMeshRuntimeTransport,
} from '../bushmesh/runtime/BushMeshNetworkRuntime';
import {
  createBushMeshNodeHelloFromPublicKey,
  deriveBushMeshNodeId,
} from '../bushmesh/runtime/BushMeshIdentity';
import {subscribeMeshCorePublicKey} from '../bushmesh/runtime/BushMeshIdentityHub';
import {
  BushMeshMessageDeliveryResult,
  BushMeshMessageDeliveryService,
} from '../bushmesh/runtime/BushMeshMessageDeliveryService';
import {BushMeshNodeRuntime} from '../bushmesh/runtime/BushMeshNodeRuntime';
import {
  bushMeshPersistentStorePlatform,
  getBushMeshPersistentStore,
  isBushMeshPersistentStoreAvailable,
} from '../bushmesh/runtime/BushMeshPersistentStore';
import {setActiveBushMeshRuntime} from '../bushmesh/runtime/BushMeshRuntimeHub';

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
  protocol?: 'meshcore-text' | 'bushmesh' | 'bushmesh-routed';
  bushMeshMessageId?: number;
  deliveryQueueId?: string;
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

export type BushMeshPeerSummary = {
  nodeId: number;
  role: number;
  capabilities: number;
  batteryPercent?: number;
  lastSeenAt: string;
};

export type BushMeshNetworkStatus = {
  active: boolean;
  detail: string;
};

export type BushMeshDeliveryStatus = {
  persistentStorageAvailable: boolean;
  storageLabel: string;
  queuedMessages: number;
  detail: string;
};

type BushMeshConnectionStatus = 'Disconnected' | 'Connected';

type SendChannelMessageHandler = (
  channelIndex: number,
  message: string,
) => Promise<void>;

type SendBushMeshMessageHandler = (
  channelIndex: number,
  message: string,
) => Promise<BushMeshRuntimeSendResult>;

type SendBushMeshRoutedMessageHandler = (
  channelIndex: number,
  message: string,
  destinationNodeId?: number,
) => Promise<BushMeshMessageDeliveryResult>;

const EMPTY_RUNTIME_STATS: BushMeshRuntimeStats = {
  sentMessages: 0,
  sentFrames: 0,
  receivedFrames: 0,
  receivedMessages: 0,
  ackFramesSent: 0,
  ackFramesReceived: 0,
  retransmittedFrames: 0,
  ignoredFrames: 0,
  decodeErrors: 0,
};

function initialDeliveryStatus(): BushMeshDeliveryStatus {
  const available = isBushMeshPersistentStoreAvailable();
  return {
    persistentStorageAvailable: available,
    storageLabel: bushMeshPersistentStorePlatform(),
    queuedMessages: 0,
    detail: available
      ? 'Persistent BushMesh delivery storage is available.'
      : 'Persistent storage is unavailable; delayed messages will only survive this app session.',
  };
}

type BushMeshContextValue = {
  connectionStatus: BushMeshConnectionStatus;
  connectedDeviceName: string | null;
  meshCorePublicKey: string | null;
  localBushMeshNodeId: number | null;
  knownBushMeshPeers: BushMeshPeerSummary[];
  bushMeshRuntimeStats: BushMeshRuntimeStats;
  bushMeshDeliveryStatus: BushMeshDeliveryStatus;
  channels: BushMeshChannel[];
  activeChannelIndex: string | null;
  activeChannel: BushMeshChannel | null;
  channelMessages: BushMeshChannelMessage[];
  canSendChannelMessage: boolean;
  canSendBushMeshMessage: boolean;
  canSendBushMeshRoutedMessage: boolean;
  bushMeshNetworkStatus: BushMeshNetworkStatus;
  deviceStatus: BushMeshDeviceStatus | null;
  contacts: BushMeshContact[];

  setContacts: (contacts: BushMeshContact[]) => void;
  setDeviceStatus: (status: BushMeshDeviceStatus | null) => void;
  setConnectionStatus: (status: BushMeshConnectionStatus) => void;
  setConnectedDeviceName: (name: string | null) => void;
  setMeshCorePublicKey: (publicKey: string | null) => void;
  setChannels: (channels: BushMeshChannel[]) => void;
  setActiveChannelIndex: (channelIndex: string | null) => void;
  setBushMeshNetworkStatus: (status: BushMeshNetworkStatus) => void;
  setSendChannelMessageHandler: (
    handler: SendChannelMessageHandler | null,
  ) => void;
  setSendBushMeshMessageHandler: (
    handler: SendBushMeshMessageHandler | null,
  ) => void;
  sendChannelMessage: (channelIndex: number, message: string) => Promise<void>;
  sendBushMeshMessage: (
    channelIndex: number,
    message: string,
  ) => Promise<BushMeshRuntimeSendResult>;
  sendBushMeshRoutedMessage: (
    channelIndex: number,
    message: string,
    destinationNodeId?: number,
  ) => Promise<BushMeshMessageDeliveryResult>;
  refreshBushMeshDiscovery: () => Promise<void>;
  flushBushMeshQueuedMessages: () => Promise<void>;
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
  const [contacts, setContacts] = useState<BushMeshContact[]>([]);
  const [connectionStatus, setConnectionStatus] =
    useState<BushMeshConnectionStatus>('Disconnected');
  const [connectedDeviceName, setConnectedDeviceName] = useState<string | null>(
    null,
  );
  const [meshCorePublicKeyState, setMeshCorePublicKeyState] = useState<
    string | null
  >(null);
  const [knownBushMeshPeers, setKnownBushMeshPeers] = useState<
    BushMeshPeerSummary[]
  >([]);
  const [bushMeshRuntimeStats, setBushMeshRuntimeStats] =
    useState<BushMeshRuntimeStats>(EMPTY_RUNTIME_STATS);
  const [bushMeshDeliveryStatus, setBushMeshDeliveryStatus] =
    useState<BushMeshDeliveryStatus>(() => initialDeliveryStatus());
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
  const [bushMeshNetworkStatus, setBushMeshNetworkStatus] =
    useState<BushMeshNetworkStatus>({
      active: false,
      detail: 'BushMesh protocol runtime is not connected.',
    });

  const [sendChannelMessageHandlerState, setSendChannelMessageHandlerState] =
    useState<SendChannelMessageHandler | null>(null);
  const [sendBushMeshMessageHandlerState, setSendBushMeshMessageHandlerState] =
    useState<SendBushMeshMessageHandler | null>(null);
  const [sendBushMeshRoutedMessageHandlerState, setSendBushMeshRoutedMessageHandlerState] =
    useState<SendBushMeshRoutedMessageHandler | null>(null);
  const bushMeshNodeRuntimeRef = useRef<BushMeshNodeRuntime | null>(null);
  const bushMeshDeliveryRef = useRef<BushMeshMessageDeliveryService | null>(null);
  const meshCorePublicKeyRef = useRef<string | null>(null);

  const activeChannel =
    channels.find(channel => channel.channelIndex === activeChannelIndex) ??
    null;
  const localBushMeshNodeId = meshCorePublicKeyState
    ? deriveBushMeshNodeId(meshCorePublicKeyState)
    : null;

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

  const addLocalChannelMessage = useCallback(
    (message: Omit<BushMeshChannelMessage, 'id' | 'createdAt'>) => {
      setChannelMessages(currentMessages => [
        {
          ...message,
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          createdAt: new Date().toISOString(),
        },
        ...currentMessages,
      ]);
    },
    [],
  );

  const setSendBushMeshMessageHandler = useCallback(
    (handler: SendBushMeshMessageHandler | null) => {
      setSendBushMeshMessageHandlerState(() => handler);
    },
    [],
  );

  const configureNodeIdentity = useCallback((publicKey: string | null) => {
    meshCorePublicKeyRef.current = publicKey;
    setMeshCorePublicKeyState(publicKey);

    if (!publicKey) {
      return;
    }

    bushMeshNodeRuntimeRef.current?.configureLocalNode(
      createBushMeshNodeHelloFromPublicKey(publicKey),
    );
  }, []);

  useEffect(() => {
    return subscribeMeshCorePublicKey(publicKey => {
      configureNodeIdentity(publicKey);
    });
  }, [configureNodeIdentity]);

  const updateDeliveryStatus = useCallback((detail?: string) => {
    const delivery = bushMeshDeliveryRef.current;
    const available = isBushMeshPersistentStoreAvailable();
    setBushMeshDeliveryStatus({
      persistentStorageAvailable: available,
      storageLabel: bushMeshPersistentStorePlatform(),
      queuedMessages: delivery?.snapshot().queuedMessages ?? 0,
      detail:
        detail ??
        (available
          ? 'Persistent routed delivery is active.'
          : 'Routed delivery queue is memory-only on this platform/build.'),
    });
  }, []);

  const setSendChannelMessageHandler = useCallback(
    (handler: SendChannelMessageHandler | null) => {
      setSendChannelMessageHandlerState(() => handler);

      bushMeshDeliveryRef.current?.stop();
      bushMeshDeliveryRef.current = null;
      bushMeshNodeRuntimeRef.current?.stop();
      bushMeshNodeRuntimeRef.current = null;
      setActiveBushMeshRuntime(null);

      if (!handler) {
        setSendBushMeshMessageHandlerState(null);
        setSendBushMeshRoutedMessageHandlerState(null);
        setKnownBushMeshPeers([]);
        setBushMeshRuntimeStats({...EMPTY_RUNTIME_STATS});
        meshCorePublicKeyRef.current = null;
        setMeshCorePublicKeyState(null);
        setBushMeshNetworkStatus({
          active: false,
          detail: 'BushMesh protocol runtime is not connected.',
        });
        updateDeliveryStatus('BushMesh delivery runtime is disconnected.');
        return;
      }

      const transport: BushMeshRuntimeTransport = {
        sendTextChannelMessage: async (channelIndex, message) => {
          await handler(channelIndex, message);
        },
      };

      const runtime = new BushMeshNodeRuntime(transport, {
        onStatus: detail => {
          setBushMeshNetworkStatus({active: true, detail});
        },
        onError: detail => {
          setBushMeshNetworkStatus({active: true, detail});
        },
        onStats: stats => {
          setBushMeshRuntimeStats(stats);
        },
        onMessage: received => {
          const text = received.decoded.renderedText;

          if (!text) {
            return;
          }

          setChannelMessages(currentMessages => [
            {
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              channelIndex: String(received.channelIndex),
              channelName: `Channel #${received.channelIndex}`,
              text,
              direction: 'received',
              status: 'sent',
              protocol: 'bushmesh',
              createdAt: new Date().toISOString(),
            },
            ...currentMessages,
          ]);
        },
        onPeerHello: hello => {
          const now = new Date().toISOString();
          setKnownBushMeshPeers(current => {
            const next = current.filter(peer => peer.nodeId !== hello.nodeId);
            next.push({
              nodeId: hello.nodeId,
              role: hello.role,
              capabilities: hello.capabilities,
              batteryPercent: hello.batteryPercent,
              lastSeenAt: now,
            });
            return next.sort((a, b) =>
              b.lastSeenAt.localeCompare(a.lastSeenAt),
            );
          });
          setBushMeshNetworkStatus({
            active: true,
            detail: `BushMesh peer ${hello.nodeId.toString(16).padStart(8, '0')} discovered.`,
          });
        },
        onForwarded: (sourceNodeId, messageId, _channelIndex, nextTtlHops) => {
          setBushMeshNetworkStatus({
            active: true,
            detail: `Forwarded ${sourceNodeId.toString(16).padStart(8, '0')}:${messageId} with ${nextTtlHops} hop(s) remaining.`,
          });
        },
        onFileComplete: (file, channelIndex) => {
          const stored = publishBushMeshInboxFile({
            transferId: file.transferId,
            channelIndex,
            fileName: file.fileName,
            contentType: file.contentType,
            data: file.data,
          });
          setChannelMessages(currentMessages => [
            {
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              channelIndex: String(channelIndex),
              channelName: `Channel #${channelIndex}`,
              text: stored.stored
                ? `Received ${file.fileName ?? 'BushMesh file'} (${file.data.length} bytes) and saved it to the local BushMesh inbox.`
                : `Received ${file.fileName ?? 'BushMesh file'} (${file.data.length} bytes), but it was not persisted${stored.reason ? `: ${stored.reason}` : '.'}`,
              direction: 'received',
              status: 'sent',
              protocol: 'bushmesh',
              createdAt: new Date().toISOString(),
            },
            ...currentMessages,
          ]);
        },
      });

      bushMeshNodeRuntimeRef.current = runtime;
      setActiveBushMeshRuntime(runtime.network);

      if (meshCorePublicKeyRef.current) {
        runtime.configureLocalNode(
          createBushMeshNodeHelloFromPublicKey(meshCorePublicKeyRef.current),
        );
      }

      runtime.start();

      const persistentStore = getBushMeshPersistentStore() ?? undefined;
      const delivery = new BushMeshMessageDeliveryService(
        runtime,
        persistentStore,
        {
          onQueued: (_queueId, messageId) => {
            updateDeliveryStatus(
              `Routed message ${messageId} is waiting for transport retry.`,
            );
          },
          onFlush: event => {
            if (
              event.sentMessageIds.length > 0 ||
              event.expiredMessageIds.length > 0
            ) {
              const sent = new Set(event.sentMessageIds);
              const expired = new Set(event.expiredMessageIds);
              setChannelMessages(currentMessages =>
                currentMessages.map(message => {
                  const messageId = message.bushMeshMessageId;
                  if (messageId === undefined) {
                    return message;
                  }
                  if (sent.has(messageId)) {
                    return {
                      ...message,
                      status: 'sent' as const,
                      deliveryQueueId: undefined,
                    };
                  }
                  if (expired.has(messageId)) {
                    return {
                      ...message,
                      status: 'failed' as const,
                      deliveryQueueId: undefined,
                    };
                  }
                  return message;
                }),
              );
            }

            updateDeliveryStatus(
              `Background delivery: ${event.sentMessageIds.length} sent, ${event.failedMessageIds.length} waiting, ${event.expiredMessageIds.length} expired.`,
            );
          },
        },
      );
      bushMeshDeliveryRef.current = delivery;
      void delivery
        .start({flushIntervalMs: 5000})
        .then(restored => {
          updateDeliveryStatus(
            restored > 0
              ? `Restored ${restored} queued routed message(s); automatic retry is active.`
              : persistentStore
                ? 'Persistent routed delivery is active; no queued messages were restored.'
                : 'Routed delivery is active with an in-memory retry queue.',
          );
        })
        .catch(error => {
          updateDeliveryStatus(
            error instanceof Error
              ? `Persistent delivery initialization failed: ${error.message}`
              : 'Persistent delivery initialization failed.',
          );
        });

      setSendBushMeshMessageHandlerState(
        () =>
          async (
            channelIndex: number,
            message: string,
          ): Promise<BushMeshRuntimeSendResult> =>
            runtime.sendText(channelIndex, message),
      );
      setSendBushMeshRoutedMessageHandlerState(
        () =>
          async (
            channelIndex: number,
            message: string,
            destinationNodeId?: number,
          ): Promise<BushMeshMessageDeliveryResult> => {
            const result = await delivery.sendRoutedText(
              channelIndex,
              message,
              destinationNodeId,
            );
            updateDeliveryStatus(
              result.state === 'queued'
                ? `Routed message ${result.messageId} saved for retry as ${result.queueId}.`
                : `Routed message ${result.messageId} transmitted.`,
            );
            return result;
          },
      );
      setBushMeshNetworkStatus({
        active: true,
        detail: meshCorePublicKeyRef.current
          ? 'BushMesh node runtime ready (text-safe transport).'
          : 'BushMesh transport ready; waiting for MeshCore node identity.',
      });
    },
    [updateDeliveryStatus],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      if (bushMeshDeliveryRef.current) {
        updateDeliveryStatus();
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [updateDeliveryStatus]);

  useEffect(() => {
    const runtime = bushMeshNodeRuntimeRef.current;

    if (!runtime) {
      return;
    }

    if (activeChannelIndex === null) {
      runtime.setDiscoveryChannel(null);
      return;
    }

    const channelIndex = Number(activeChannelIndex);
    if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 255) {
      runtime.setDiscoveryChannel(null);
      return;
    }

    runtime.setDiscoveryChannel(channelIndex);
    setBushMeshNetworkStatus({
      active: true,
      detail: `BushMesh discovery active on channel ${channelIndex}.`,
    });
  }, [activeChannelIndex, sendBushMeshMessageHandlerState]);

  useEffect(() => {
    return () => {
      bushMeshDeliveryRef.current?.stop();
      bushMeshDeliveryRef.current = null;
      bushMeshNodeRuntimeRef.current?.stop();
      bushMeshNodeRuntimeRef.current = null;
      setActiveBushMeshRuntime(null);
    };
  }, []);

  const clearChannels = () => {
    setChannelsState([]);
    setActiveChannelIndex(null);
  };

  const clearChannelMessages = () => {
    setChannelMessages([]);
  };

  const clearContacts = () => {
    setContacts([]);
  };

  const sendChannelMessage = useCallback(
    async (channelIndex: number, message: string): Promise<void> => {
      if (!sendChannelMessageHandlerState) {
        throw new Error('No connected MeshCore client is ready for messaging.');
      }

      await sendChannelMessageHandlerState(channelIndex, message);
    },
    [sendChannelMessageHandlerState],
  );

  const sendBushMeshMessage = useCallback(
    async (
      channelIndex: number,
      message: string,
    ): Promise<BushMeshRuntimeSendResult> => {
      if (!sendBushMeshMessageHandlerState) {
        throw new Error('BushMesh protocol runtime is not ready for messaging.');
      }

      return sendBushMeshMessageHandlerState(channelIndex, message);
    },
    [sendBushMeshMessageHandlerState],
  );

  const sendBushMeshRoutedMessage = useCallback(
    async (
      channelIndex: number,
      message: string,
      destinationNodeId?: number,
    ): Promise<BushMeshMessageDeliveryResult> => {
      if (!sendBushMeshRoutedMessageHandlerState) {
        throw new Error('BushMesh routed mesh runtime is not ready for messaging.');
      }

      return sendBushMeshRoutedMessageHandlerState(
        channelIndex,
        message,
        destinationNodeId,
      );
    },
    [sendBushMeshRoutedMessageHandlerState],
  );

  const refreshBushMeshDiscovery = useCallback(async (): Promise<void> => {
    const runtime = bushMeshNodeRuntimeRef.current;
    if (!runtime) {
      throw new Error('BushMesh runtime is not ready.');
    }
    if (activeChannelIndex === null) {
      throw new Error('Select an active channel before refreshing discovery.');
    }

    const channelIndex = Number(activeChannelIndex);
    if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 255) {
      throw new Error('Active BushMesh discovery channel is invalid.');
    }

    runtime.setDiscoveryChannel(channelIndex);
    await runtime.broadcastNodeHello(channelIndex);
    setBushMeshNetworkStatus({
      active: true,
      detail: `BushMesh HELLO broadcast on channel ${channelIndex}.`,
    });
  }, [activeChannelIndex]);

  const flushBushMeshQueuedMessages = useCallback(async (): Promise<void> => {
    const delivery = bushMeshDeliveryRef.current;
    if (!delivery) {
      throw new Error('BushMesh delivery runtime is not ready.');
    }

    const result = await delivery.flush();
    updateDeliveryStatus(
      `Queue flush: ${result.sentIds.length} sent, ${result.failedIds.length} still waiting, ${result.expiredIds.length} expired.`,
    );
  }, [updateDeliveryStatus]);

  const value = useMemo<BushMeshContextValue>(
    () => ({
      connectionStatus,
      connectedDeviceName,
      meshCorePublicKey: meshCorePublicKeyState,
      localBushMeshNodeId,
      knownBushMeshPeers,
      bushMeshRuntimeStats,
      bushMeshDeliveryStatus,
      channels,
      activeChannelIndex,
      activeChannel,
      channelMessages,
      deviceStatus,
      contacts,
      bushMeshNetworkStatus,
      canSendChannelMessage: sendChannelMessageHandlerState !== null,
      canSendBushMeshMessage: sendBushMeshMessageHandlerState !== null,
      canSendBushMeshRoutedMessage:
        sendBushMeshRoutedMessageHandlerState !== null &&
        localBushMeshNodeId !== null,
      setDeviceStatus,
      setContacts,
      setConnectionStatus,
      setConnectedDeviceName,
      setMeshCorePublicKey: configureNodeIdentity,
      setChannels,
      setActiveChannelIndex,
      setBushMeshNetworkStatus,
      setSendChannelMessageHandler,
      setSendBushMeshMessageHandler,
      sendChannelMessage,
      sendBushMeshMessage,
      sendBushMeshRoutedMessage,
      refreshBushMeshDiscovery,
      flushBushMeshQueuedMessages,
      addLocalChannelMessage,
      clearChannels,
      clearChannelMessages,
      clearContacts,
    }),
    [
      connectionStatus,
      connectedDeviceName,
      meshCorePublicKeyState,
      localBushMeshNodeId,
      knownBushMeshPeers,
      bushMeshRuntimeStats,
      bushMeshDeliveryStatus,
      channels,
      activeChannelIndex,
      activeChannel,
      channelMessages,
      deviceStatus,
      contacts,
      bushMeshNetworkStatus,
      sendChannelMessageHandlerState,
      sendBushMeshMessageHandlerState,
      sendBushMeshRoutedMessageHandlerState,
      configureNodeIdentity,
      setSendChannelMessageHandler,
      setSendBushMeshMessageHandler,
      sendChannelMessage,
      sendBushMeshMessage,
      sendBushMeshRoutedMessage,
      refreshBushMeshDiscovery,
      flushBushMeshQueuedMessages,
      addLocalChannelMessage,
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
