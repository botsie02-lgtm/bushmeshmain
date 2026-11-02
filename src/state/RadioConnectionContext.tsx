import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AppRadioConnectionService,
  AppRadioConnectionSnapshot,
  appRadioConnectionService,
} from '../radio/AppRadioConnectionService';
import {useBushMesh} from './BushMeshContext';

type RadioConnectionContextValue = {
  snapshot: AppRadioConnectionSnapshot;
  nativeHandoffSupported: boolean;
  startScan: () => Promise<void>;
  stopScan: () => void;
  connectToDevice: AppRadioConnectionService['connectToDevice'];
  handoffDiscoveredDeviceToAndroid: AppRadioConnectionService['handoffDiscoveredDeviceToAndroid'];
  handoffToAndroid: () => Promise<void>;
  disconnect: () => Promise<void>;
  runActiveStartupSync: () => Promise<void>;
  getBatteryStatus: () => Promise<void>;
  syncContacts: () => ReturnType<AppRadioConnectionService['syncContacts']>;
  sendAppStart: () => Promise<void>;
  sendDeviceQuery: () => Promise<void>;
  getChannel0: () => Promise<void>;
  probeChannels: () => Promise<void>;
};

const RadioConnectionContext = createContext<RadioConnectionContextValue | null>(null);

export function RadioConnectionProvider({
  children,
  service = appRadioConnectionService,
}: {
  children: React.ReactNode;
  service?: AppRadioConnectionService;
}): React.JSX.Element {
  const {
    setChannels,
    setConnectionStatus,
    setConnectedDeviceName,
    setSendChannelMessageHandler,
    setSyncContactsHandler,
    setDeviceStatus,
    setContacts,
  } = useBushMesh();
  const [snapshot, setSnapshot] = useState(() => service.getSnapshot());
  const lastChannelsKeyRef = useRef<string | null>(null);
  const lastContactsKeyRef = useRef<string | null>(null);
  const lastDeviceStatusKeyRef = useRef<string | null>(null);

  // The BLE service is an application-lifetime resource. This effect is keyed
  // only by the service instance, so BushMesh state/handler updates can never
  // tear down its BleManager.
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) setSnapshot(service.getSnapshot());
    };
    refresh();
    const unsubscribe = service.subscribe(refresh);
    service.initialize().catch(() => undefined);

    return () => {
      active = false;
      unsubscribe();
      service.dispose().catch(() => undefined);
    };
  }, [service]);

  useEffect(() => {
    const channelsKey = JSON.stringify(snapshot.channels);
    if (channelsKey !== lastChannelsKeyRef.current) {
      lastChannelsKeyRef.current = channelsKey;
      setChannels(snapshot.channels);
    }

    const contactsKey = JSON.stringify(snapshot.contacts);
    if (contactsKey !== lastContactsKeyRef.current) {
      lastContactsKeyRef.current = contactsKey;
      setContacts(snapshot.contacts);
    }

    const deviceStatusKey = JSON.stringify(snapshot.deviceStatus);
    if (deviceStatusKey !== lastDeviceStatusKeyRef.current) {
      lastDeviceStatusKeyRef.current = deviceStatusKey;
      setDeviceStatus(snapshot.deviceStatus);
    }
  }, [snapshot, setChannels, setContacts, setDeviceStatus]);

  // Command registration is deliberately separate from BLE ownership. A status
  // transition may replace application handlers, but it must never dispose the
  // application radio service.
  useEffect(() => {
    setConnectedDeviceName(snapshot.connectedDeviceLabel);
    setConnectionStatus(
      snapshot.status === 'Connected' ? 'Connected' : 'Disconnected',
    );

    if (snapshot.status === 'Connected') {
      setSendChannelMessageHandler((channelIndex, message) =>
        service.sendChannelMessage(channelIndex, message),
      );
      setSyncContactsHandler(() => service.syncContacts());
    } else {
      setSendChannelMessageHandler(null);
      setSyncContactsHandler(null);
    }
  }, [
    service,
    snapshot.connectedDeviceLabel,
    snapshot.status,
    setConnectionStatus,
    setConnectedDeviceName,
    setSendChannelMessageHandler,
    setSyncContactsHandler,
  ]);

  useEffect(
    () => () => {
      setSendChannelMessageHandler(null);
      setSyncContactsHandler(null);
    },
    [setSendChannelMessageHandler, setSyncContactsHandler],
  );

  const value = useMemo<RadioConnectionContextValue>(
    () => ({
      snapshot,
      nativeHandoffSupported: service.nativeHandoffSupported,
      startScan: () => service.startScan(),
      stopScan: () => service.stopScan(),
      connectToDevice: device => service.connectToDevice(device),
      handoffDiscoveredDeviceToAndroid: device =>
        service.handoffDiscoveredDeviceToAndroid(device),
      handoffToAndroid: () => service.handoffToAndroid(),
      disconnect: () => service.disconnect(),
      runActiveStartupSync: () => service.runActiveStartupSync(),
      getBatteryStatus: () => service.getBatteryStatus(),
      syncContacts: () => service.syncContacts(),
      sendAppStart: () => service.sendAppStart(),
      sendDeviceQuery: () => service.sendDeviceQuery(),
      getChannel0: () => service.getChannel0(),
      probeChannels: () => service.probeChannels(),
    }),
    [service, snapshot],
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