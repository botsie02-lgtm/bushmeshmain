import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

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

type BushMeshConnectionStatus = 'Disconnected' | 'Connected';

type SendChannelMessageHandler = (
  channelIndex: number,
  message: string,
) => Promise<void>;

type BushMeshContextValue = {
  connectionStatus: BushMeshConnectionStatus;
  connectedDeviceName: string | null;
  channels: BushMeshChannel[];
  activeChannelIndex: string | null;
  activeChannel: BushMeshChannel | null;
  channelMessages: BushMeshChannelMessage[];
  canSendChannelMessage: boolean;
  deviceStatus: BushMeshDeviceStatus | null;

  setConnectionStatus: (status: BushMeshConnectionStatus) => void;
  setConnectedDeviceName: (name: string | null) => void;
  setChannels: (channels: BushMeshChannel[]) => void;
  setActiveChannelIndex: (channelIndex: string | null) => void;
  setSendChannelMessageHandler: (
    handler: SendChannelMessageHandler | null,
  ) => void;
  sendChannelMessage: (channelIndex: number, message: string) => Promise<void>;
  addLocalChannelMessage: (
    message: Omit<BushMeshChannelMessage, 'id' | 'createdAt'>,
  ) => void;
  clearChannels: () => void;
  clearChannelMessages: () => void;
  setDeviceStatus: (status: BushMeshDeviceStatus | null) => void;
};

const BushMeshContext = createContext<BushMeshContextValue | null>(null);

export function BushMeshProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
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

  const [sendChannelMessageHandlerState, setSendChannelMessageHandlerState] =
    useState<SendChannelMessageHandler | null>(null);

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

  const clearChannels = () => {
    setChannelsState([]);
    setActiveChannelIndex(null);
  };

  const clearChannelMessages = () => {
    setChannelMessages([]);
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

  const sendChannelMessage = useCallback(
  async (channelIndex: number, message: string): Promise<void> => {
    if (!sendChannelMessageHandlerState) {
      throw new Error('No connected MeshCore client is ready for messaging.');
    }

    await sendChannelMessageHandlerState(channelIndex, message);
  },
  [sendChannelMessageHandlerState],
);

  const value = useMemo<BushMeshContextValue>(
    () => ({
      connectionStatus,
      connectedDeviceName,
      channels,
      activeChannelIndex,
      activeChannel,
      channelMessages,
      deviceStatus,
      canSendChannelMessage: sendChannelMessageHandlerState !== null,
      setDeviceStatus,

      setConnectionStatus,
      setConnectedDeviceName,
      setChannels,
      setActiveChannelIndex,
      setSendChannelMessageHandler,
      sendChannelMessage,
      addLocalChannelMessage,
      clearChannels,
      clearChannelMessages,
    }),
    [
      connectionStatus,
      connectedDeviceName,
      channels,
      activeChannelIndex,
      activeChannel,
      channelMessages,
      deviceStatus,
      sendChannelMessageHandlerState,
      sendChannelMessage,
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