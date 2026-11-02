import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  AppRadioConnectionSnapshot,
  appRadioConnectionService,
} from '../radio/AppRadioConnectionService';
import {useBushMesh} from './BushMeshContext';

type RadioConnectionContextValue = {
  snapshot: AppRadioConnectionSnapshot;
  nativeHandoffSupported: boolean;
  startScan: () => Promise<void>;
  connectToDevice: typeof appRadioConnectionService.connectToDevice;
  handoffToAndroid: () => Promise<void>;
  disconnect: () => Promise<void>;
  runActiveStartupSync: () => Promise<void>;
  getBatteryStatus: () => Promise<void>;
  syncContacts: () => ReturnType<typeof appRadioConnectionService.syncContacts>;
  sendAppStart: () => Promise<void>;
  sendDeviceQuery: () => Promise<void>;
  getChannel0: () => Promise<void>;
  probeChannels: () => Promise<void>;
};

const RadioConnectionContext = createContext<RadioConnectionContextValue | null>(null);

export function RadioConnectionProvider({children}: {children: React.ReactNode}): React.JSX.Element {
  const {
    setChannels,
    setConnectionStatus,
    setConnectedDeviceName,
    setSendChannelMessageHandler,
    setSyncContactsHandler,
    setDeviceStatus,
    setContacts,
  } = useBushMesh();
  const [snapshot, setSnapshot] = useState(() => appRadioConnectionService.getSnapshot());
  const channelsKey = JSON.stringify(snapshot.channels);
  const contactsKey = JSON.stringify(snapshot.contacts);
  const deviceStatusKey = JSON.stringify(snapshot.deviceStatus);

  useEffect(() => {
    const refresh = () => setSnapshot(appRadioConnectionService.getSnapshot());
    refresh();
    const unsubscribe = appRadioConnectionService.subscribe(refresh);
    appRadioConnectionService.initialize().catch(() => undefined);

    return () => {
      unsubscribe();
      setSendChannelMessageHandler(null);
      setSyncContactsHandler(null);
      appRadioConnectionService.dispose().catch(() => undefined);
    };
  }, [setSendChannelMessageHandler, setSyncContactsHandler]);

  useEffect(() => {
    setChannels(snapshot.channels);
  }, [channelsKey, setChannels, snapshot.channels]);

  useEffect(() => {
    setContacts(snapshot.contacts);
  }, [contactsKey, setContacts, snapshot.contacts]);

  useEffect(() => {
    setDeviceStatus(snapshot.deviceStatus);
  }, [deviceStatusKey, setDeviceStatus, snapshot.deviceStatus]);

  useEffect(() => {
    setConnectedDeviceName(snapshot.connectedDeviceLabel);
    setConnectionStatus(
      snapshot.status === 'Connected' ? 'Connected' : 'Disconnected',
    );

    if (snapshot.status === 'Connected') {
      setSendChannelMessageHandler((channelIndex, message) =>
        appRadioConnectionService.sendChannelMessage(channelIndex, message),
      );
      setSyncContactsHandler(() => appRadioConnectionService.syncContacts());
    } else {
      setSendChannelMessageHandler(null);
      setSyncContactsHandler(null);
    }
  }, [
    snapshot.connectedDeviceLabel,
    snapshot.status,
    setConnectionStatus,
    setConnectedDeviceName,
    setSendChannelMessageHandler,
    setSyncContactsHandler,
  ]);

  const value = useMemo<RadioConnectionContextValue>(
    () => ({
      snapshot,
      nativeHandoffSupported: appRadioConnectionService.nativeHandoffSupported,
      startScan: () => appRadioConnectionService.startScan(),
      connectToDevice: device => appRadioConnectionService.connectToDevice(device),
      handoffToAndroid: () => appRadioConnectionService.handoffToAndroid(),
      disconnect: () => appRadioConnectionService.disconnect(),
      runActiveStartupSync: () => appRadioConnectionService.runActiveStartupSync(),
      getBatteryStatus: () => appRadioConnectionService.getBatteryStatus(),
      syncContacts: () => appRadioConnectionService.syncContacts(),
      sendAppStart: () => appRadioConnectionService.sendAppStart(),
      sendDeviceQuery: () => appRadioConnectionService.sendDeviceQuery(),
      getChannel0: () => appRadioConnectionService.getChannel0(),
      probeChannels: () => appRadioConnectionService.probeChannels(),
    }),
    [snapshot],
  );

  return (
    <RadioConnectionContext.Provider value={value}>
      {children}
    </RadioConnectionContext.Provider>
  );
}

export function useRadioConnection(): RadioConnectionContextValue {
  const context = useContext(RadioConnectionContext);
  if (!context) {
    throw new Error('useRadioConnection must be used inside RadioConnectionProvider');
  }
  return context;
}
