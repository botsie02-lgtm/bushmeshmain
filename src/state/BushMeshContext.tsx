import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  BushMeshRuntimeSendResult,
  BushMeshRuntimeTransport,
} from '../bushmesh/runtime/BushMeshNetworkRuntime';
import {
  createBushMeshNodeHelloFromPublicKey,
  deriveBushMeshNodeId,
} from '../bushmesh/runtime/BushMeshIdentity';
import {BushMeshNodeRuntime} from '../bushmesh/runtime/BushMeshNodeRuntime';
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
  protocol?: 'meshcore-text' | 'bushmesh';
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

export type BushMeshNetworkStatus = {
  active: boolean;
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

type BushMeshContextValue = {
  connectionStatus: BushMeshConnectionStatus;
  connectedDeviceName: string | null;
  meshCorePublicKey: string | null;
  localBushMeshNodeId: number | null;
  channels: BushMeshChannel[];
  activeChannelIndex: string | null;
  activeChannel: BushMeshChannel | null;
  channelMessages: BushMeshChannelMessage[];
  canSendChannelMessage: boolean;
  canSendBushMeshMessage: boolean;
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
  const bushMeshNodeRuntimeRef = useRef<BushMeshNodeRuntime | null>(null);

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
    setMeshCorePublicKeyState(publicKey);

    if (!publicKey) {
      return;
    }

    const runtime = bushMeshNodeRuntimeRef.current;
    if (runtime) {
      runtime.configureLocalNode(createBushMeshNodeHelloFromPublicKey(publicKey));
    }
  }, []);

  const setSendChannelMessageHandler = useCallback(
    (handler: SendChannelMessageHandler | null) => {
      setSendChannelMessageHandlerState(() => handler);

      bushMeshNodeRuntimeRef.current?.stop();
      bushMeshNodeRuntimeRef.current = null;
      setActiveBushMeshRuntime(null);

      if (!handler) {
        setSendBushMeshMessageHandlerState(null);
        setBushMeshNetworkStatus({
          active: false,
          detail: 'BushMesh protocol runtime is not connected.',
        });
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
          setBushMeshNetworkStatus({
            active: true,
            detail: `BushMesh peer ${hello.nodeId.toString(16).padStart(8, '0')} discovered.`,
          });
        },
      });

      bushMeshNodeRuntimeRef.current = runtime;
      setActiveBushMeshRuntime(runtime.network);

      if (meshCorePublicKeyState) {
        runtime.configureLocalNode(
          createBushMeshNodeHelloFromPublicKey(meshCorePublicKeyState),
        );
      }

      runtime.start();
      setSendBushMeshMessageHandlerState(
        () =>
          async (
            channelIndex: number,
            message: string,
          ): Promise<BushMeshRuntimeSendResult> =>
            runtime.sendText(channelIndex, message),
      );
      setBushMeshNetworkStatus({
        active: true,
        detail: meshCorePublicKeyState
          ? 'BushMesh node runtime ready (text-safe transport).'
          : 'BushMesh transport ready; waiting for MeshCore node identity.',
      });
    },
    [meshCorePublicKeyState],
  );

  useEffect(() => {
    return () => {
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

  const value = useMemo<BushMeshContextValue>(
    () => ({
      connectionStatus,
      connectedDeviceName,
      meshCorePublicKey: meshCorePublicKeyState,
      localBushMeshNodeId,
      channels,
      activeChannelIndex,
      activeChannel,
      channelMessages,
      deviceStatus,
      contacts,
      bushMeshNetworkStatus,
      canSendChannelMessage: sendChannelMessageHandlerState !== null,
      canSendBushMeshMessage: sendBushMeshMessageHandlerState !== null,
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
      channels,
      activeChannelIndex,
      activeChannel,
      channelMessages,
      deviceStatus,
      contacts,
      bushMeshNetworkStatus,
      sendChannelMessageHandlerState,
      sendBushMeshMessageHandlerState,
      configureNodeIdentity,
      setSendChannelMessageHandler,
      setSendBushMeshMessageHandler,
      sendChannelMessage,
      sendBushMeshMessage,
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
