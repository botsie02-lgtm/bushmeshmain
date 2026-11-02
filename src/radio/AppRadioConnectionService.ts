import {BleManager, Device} from 'react-native-ble-plx';

import {requestBlePermissions} from '../ble/blePermissions';
import {MeshCoreClient, MeshCoreLogItem} from '../meshcore/MeshCoreClient';
import {
  MeshCoreBleDiscovery,
  discoverMeshCoreBle,
} from '../meshcore/meshcoreBle';
import {
  NativeMeshCoreResponse,
  NativeMeshCoreSession,
} from '../meshcore/NativeMeshCoreSession';
import {
  NativeMeshCoreSessionCoordinator,
  nativeMeshCoreSessionCoordinator,
} from '../meshcore/NativeMeshCoreSessionCoordinator';
import {nativeRadioService} from '../native/NativeRadioService';
import {
  BushMeshChannel,
  BushMeshContact,
  BushMeshDeviceStatus,
} from '../state/BushMeshContext';

export type AppRadioConnectionStatus =
  | 'Disconnected'
  | 'Requesting permissions'
  | 'Scanning'
  | 'Connecting'
  | 'Connected'
  | 'Error';

export type AppRadioConnectionOwner = 'none' | 'react-native' | 'android-native';

export type AppRadioLogItem = MeshCoreLogItem & {id: string};

export type AppRadioConnectionSnapshot = {
  status: AppRadioConnectionStatus;
  statusDetail: string;
  devices: Device[];
  connectedDeviceAddress: string | null;
  connectedDeviceLabel: string | null;
  connectionOwner: AppRadioConnectionOwner;
  meshCoreBle: MeshCoreBleDiscovery | null;
  txChunks: AppRadioLogItem[];
  txFrames: AppRadioLogItem[];
  rxLogs: AppRadioLogItem[];
  isWriting: boolean;
  channels: BushMeshChannel[];
  contacts: BushMeshContact[];
  deviceStatus: BushMeshDeviceStatus | null;
};

type Listener = () => void;

type BleManagerFactory = () => BleManager;
type MeshCoreClientFactory = (
  manager: BleManager,
  device: Device,
  events: ConstructorParameters<typeof MeshCoreClient>[2],
) => MeshCoreClient;

type Dependencies = {
  createBleManager: BleManagerFactory;
  createMeshCoreClient: MeshCoreClientFactory;
  requestPermissions: () => Promise<boolean>;
  discoverBle: typeof discoverMeshCoreBle;
  nativeCoordinator: NativeMeshCoreSessionCoordinator;
  nativeSupported: () => boolean;
  getNativeStatus: typeof nativeRadioService.getStatus;
};

const initialSnapshot = (): AppRadioConnectionSnapshot => ({
  status: 'Disconnected',
  statusDetail: 'No MeshCore device connected.',
  devices: [],
  connectedDeviceAddress: null,
  connectedDeviceLabel: null,
  connectionOwner: 'none',
  meshCoreBle: null,
  txChunks: [],
  txFrames: [],
  rxLogs: [],
  isWriting: false,
  channels: [],
  contacts: [],
  deviceStatus: null,
});

function channelFromParsedLines(lines?: string[]): BushMeshChannel | null {
  if (!lines?.length) return null;
  const read = (prefix: string, fallback = 'Unknown') =>
    lines.find(line => line.startsWith(prefix))?.replace(prefix, '').trim() ?? fallback;
  return {
    channelIndex: read('Channel Index:'),
    channelName: read('Channel Name:'),
    secret: read('Secret:'),
  };
}

function contactFromParsed(contact: Awaited<ReturnType<MeshCoreClient['syncContacts']>>[number]): BushMeshContact {
  return {
    publicKey: contact.publicKey,
    publicKeyPrefix: contact.publicKeyPrefix,
    name: contact.name,
    type: contact.type,
    flags: contact.flags,
    outPathLength: contact.outPathLength,
    lastAdvert: contact.lastAdvert,
    latitude: contact.latitude,
    longitude: contact.longitude,
    lastModified: contact.lastModified,
  };
}

function nativeResponseLog(response: NativeMeshCoreResponse): MeshCoreLogItem {
  return {
    label: response.label,
    value: response.bytes.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' '),
    rawBytes: [...response.bytes],
    parsedLines: response.parsed?.lines,
    batteryInfo: response.parsed?.batteryInfo,
    contactInfo: response.parsed?.contactInfo,
    channelMessage: response.parsed?.channelMessage,
    contactMessage: response.parsed?.contactMessage,
    contactsStartCount: response.parsed?.contactsStartCount,
    contactsEndLastModified: response.parsed?.contactsEndLastModified,
    deviceInfo: response.deviceInfo ?? undefined,
    selfInfo: response.selfInfo ?? undefined,
    channelData: response.channelData ?? undefined,
    detail: `${response.bytes.length} byte Android-native MeshCore frame`,
  };
}

export class AppRadioConnectionService {
  private readonly listeners = new Set<Listener>();
  private readonly deps: Dependencies;
  private manager: BleManager | null = null;
  private meshCoreClient: MeshCoreClient | null = null;
  private nativeSession: NativeMeshCoreSession | null = null;
  private connectedDevice: Device | null = null;
  private snapshot = initialSnapshot();
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private initializePromise: Promise<void> | null = null;
  private disposed = false;

  constructor(deps: Partial<Dependencies> = {}) {
    this.deps = {
      createBleManager: () => new BleManager(),
      createMeshCoreClient: (manager, device, events) => new MeshCoreClient(manager, device, events),
      requestPermissions: requestBlePermissions,
      discoverBle: discoverMeshCoreBle,
      nativeCoordinator: nativeMeshCoreSessionCoordinator,
      nativeSupported: () => nativeRadioService.isSupported(),
      getNativeStatus: () => nativeRadioService.getStatus(),
      ...deps,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): AppRadioConnectionSnapshot {
    return {
      ...this.snapshot,
      devices: [...this.snapshot.devices],
      channels: this.snapshot.channels.map(channel => ({...channel})),
      contacts: this.snapshot.contacts.map(contact => ({...contact})),
      txChunks: this.snapshot.txChunks.map(log => ({...log})),
      txFrames: this.snapshot.txFrames.map(log => ({...log})),
      rxLogs: this.snapshot.rxLogs.map(log => ({...log})),
      meshCoreBle: this.snapshot.meshCoreBle ? {...this.snapshot.meshCoreBle} : null,
      deviceStatus: this.snapshot.deviceStatus ? {...this.snapshot.deviceStatus} : null,
    };
  }

  get nativeHandoffSupported(): boolean {
    return this.deps.nativeSupported();
  }

  async initialize(): Promise<void> {
    if (this.initializePromise) return this.initializePromise;
    this.disposed = false;
    this.ensureManager();
    const initialize = this.recoverNativeOwner().finally(() => {
      if (this.initializePromise === initialize) this.initializePromise = null;
    });
    this.initializePromise = initialize;
    return initialize;
  }

  async startScan(): Promise<void> {
    const manager = this.ensureManager();
    this.patch({status: 'Requesting permissions', statusDetail: 'Checking Bluetooth permissions...'});
    if (!(await this.deps.requestPermissions())) {
      this.patch({status: 'Error', statusDetail: 'Bluetooth permissions were not granted.'});
      return;
    }

    this.clearScanTimer();
    manager.stopDeviceScan();
    this.patch({devices: [], status: 'Scanning', statusDetail: 'Scanning for nearby BLE devices...'});
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        manager.stopDeviceScan();
        this.clearScanTimer();
        this.patch({status: 'Error', statusDetail: error.message});
        return;
      }
      if (device && (device.name || device.localName)) {
        const devices = [...this.snapshot.devices];
        const index = devices.findIndex(item => item.id === device.id);
        if (index >= 0) devices[index] = device;
        else devices.push(device);
        this.patch({devices});
      }
    });

    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      manager.stopDeviceScan();
      if (this.snapshot.status === 'Scanning') {
        this.patch({status: 'Disconnected', statusDetail: 'Scan finished. Select a device to connect.'});
      }
    }, 10_000);
  }

  async connectToDevice(device: Device): Promise<void> {
    const manager = this.ensureManager();
    manager.stopDeviceScan();
    this.clearScanTimer();
    this.patch({status: 'Connecting', statusDetail: `Connecting to ${device.name ?? device.localName}...`});
    try {
      const connected = await manager.connectToDevice(device.id);
      const readyDevice = await connected.discoverAllServicesAndCharacteristics();
      const discovery = await this.deps.discoverBle(readyDevice);
      const label = readyDevice.name ?? readyDevice.localName ?? 'Unknown device';
      this.connectedDevice = readyDevice;
      this.patch({
        connectedDeviceAddress: readyDevice.id,
        connectedDeviceLabel: label,
        connectionOwner: 'react-native',
        meshCoreBle: discovery,
        txChunks: [],
        txFrames: [],
        rxLogs: [],
        channels: [],
        contacts: [],
        status: 'Connected',
      });
      if (!discovery.serviceFound || !discovery.rxFound || !discovery.txFound) {
        this.patch({statusDetail: `Connected to ${label}, but the MeshCore UART service was not fully found.`});
        return;
      }

      const client = this.deps.createMeshCoreClient(manager, readyDevice, {
        onTxChunk: log => this.addChunk(log),
        onTxFrame: log => this.addFrame(log),
        onStatus: statusDetail => this.patch({statusDetail}),
        onError: message => this.patch({status: 'Error', statusDetail: message}),
        onConnectionState: (state, detail) => {
          if (state === 'connected') this.patch({status: 'Connected', statusDetail: detail});
          else if (state === 'reconnecting') this.patch({status: 'Connecting', statusDetail: detail});
          else if (state === 'disconnected') this.patch({status: 'Disconnected', statusDetail: detail});
        },
      });
      this.meshCoreClient?.stop();
      this.meshCoreClient = client;
      client.start();
      await this.runReactNativeStartupSync(client);
    } catch (error) {
      this.patch({status: 'Error', statusDetail: error instanceof Error ? error.message : 'Failed to connect.'});
    }
  }

  async handoffToAndroid(): Promise<void> {
    if (!this.snapshot.connectedDeviceAddress || this.snapshot.connectionOwner === 'android-native') return;
    if (!this.nativeHandoffSupported) {
      this.patch({status: 'Error', statusDetail: 'Android native radio ownership is unavailable in this build.'});
      return;
    }
    const address = this.snapshot.connectedDeviceAddress;
    const label = this.snapshot.connectedDeviceLabel ?? 'MeshCore radio';
    const manager = this.ensureManager();
    this.patch({isWriting: true, statusDetail: 'Handing MeshCore BLE ownership to Android...'});
    try {
      this.meshCoreClient?.stop();
      this.meshCoreClient = null;
      await manager.cancelDeviceConnection(address).catch(() => undefined);
      this.connectedDevice = null;
      const session = await this.startNativeSession(address, label);
      this.nativeSession = session;
      this.patch({connectionOwner: 'android-native', meshCoreBle: null, status: 'Connected'});
      await this.runNativeStartupSync(session);
    } catch (error) {
      this.nativeSession = null;
      this.connectedDevice = null;
      this.patch({
        status: 'Error',
        statusDetail: error instanceof Error ? `Android radio handoff failed: ${error.message}` : 'Android radio handoff failed.',
        connectedDeviceAddress: null,
        connectedDeviceLabel: null,
        connectionOwner: 'none',
        meshCoreBle: null,
      });
    } finally {
      this.patch({isWriting: false});
    }
  }

  async disconnect(): Promise<void> {
    this.patch({isWriting: true});
    try {
      if (this.snapshot.connectionOwner === 'android-native') {
        await this.deps.nativeCoordinator.stop();
        this.nativeSession = null;
      } else {
        this.meshCoreClient?.stop();
        this.meshCoreClient = null;
        const address = this.connectedDevice?.id ?? this.snapshot.connectedDeviceAddress;
        if (address) await this.ensureManager().cancelDeviceConnection(address).catch(() => undefined);
      }
    } finally {
      this.connectedDevice = null;
      this.snapshot = {...initialSnapshot(), statusDetail: 'Device disconnected.'};
      this.emit();
    }
  }

  async runActiveStartupSync(): Promise<void> {
    try {
      if (this.snapshot.connectionOwner === 'android-native' && this.nativeSession) {
        this.patch({isWriting: true});
        await this.nativeSession.sendAppStart('BushMesh');
        await this.nativeSession.sendDeviceQuery();
        await this.runNativeStartupSync(this.nativeSession);
      } else if (this.meshCoreClient) {
        await this.runReactNativeStartupSync(this.meshCoreClient);
      }
    } catch (error) {
      this.patch({status: 'Error', statusDetail: error instanceof Error ? error.message : 'Startup sync failed.', isWriting: false});
    }
  }

  async getBatteryStatus(): Promise<void> {
    this.patch({isWriting: true});
    try {
      const battery = this.snapshot.connectionOwner === 'android-native'
        ? (await this.nativeSession?.getBatteryStatus())?.parsed?.batteryInfo
        : (await this.meshCoreClient?.getBatteryStatus())?.batteryInfo;
      if (battery) {
        this.patch({deviceStatus: battery, statusDetail: `Battery ${battery.batteryVolts.toFixed(2)} V. Storage ${battery.storagePercent ?? 0}% used.`});
      } else {
        this.patch({statusDetail: 'Battery response received, but no battery info parsed.'});
      }
    } catch (error) {
      this.patch({status: 'Error', statusDetail: error instanceof Error ? error.message : 'Failed to get battery status.'});
    } finally {
      this.patch({isWriting: false});
    }
  }

  async syncContacts(): Promise<BushMeshContact[]> {
    this.patch({isWriting: true});
    try {
      const contacts = this.snapshot.connectionOwner === 'android-native'
        ? await this.nativeSession?.syncContacts()
        : await this.meshCoreClient?.syncContacts();
      const mapped = contacts?.map(contactFromParsed) ?? [];
      this.patch({contacts: mapped, statusDetail: `Contacts sync complete. Loaded ${mapped.length} contact(s).`});
      return mapped;
    } catch (error) {
      this.patch({status: 'Error', statusDetail: error instanceof Error ? error.message : 'Failed to sync contacts.'});
      return [];
    } finally {
      this.patch({isWriting: false});
    }
  }

  async sendChannelMessage(channelIndex: number, message: string): Promise<void> {
    if (this.snapshot.connectionOwner === 'android-native' && this.nativeSession) {
      await this.nativeSession.sendChannelMessage(channelIndex, message);
      return;
    }
    if (this.meshCoreClient) {
      await this.meshCoreClient.sendChannelMessage(channelIndex, message);
      return;
    }
    throw new Error('No active MeshCore radio session.');
  }

  async sendAppStart(): Promise<void> {
    await this.runCommand(async () => {
      if (this.snapshot.connectionOwner === 'android-native') await this.nativeSession?.sendAppStart('BushMesh');
      else await this.meshCoreClient?.sendAppStart('BushMesh');
    }, 'App Start failed.');
  }

  async sendDeviceQuery(): Promise<void> {
    await this.runCommand(async () => {
      if (this.snapshot.connectionOwner === 'android-native') await this.nativeSession?.sendDeviceQuery();
      else await this.meshCoreClient?.sendDeviceQuery();
    }, 'Device Query failed.');
  }

  async getChannel0(): Promise<void> {
    await this.runCommand(async () => {
      const channel = this.snapshot.connectionOwner === 'android-native'
        ? channelFromParsedLines((await this.nativeSession?.getChannel(0))?.parsed?.lines)
        : channelFromParsedLines((await this.meshCoreClient?.getChannel(0))?.parsedLines);
      if (channel) this.patch({channels: [channel]});
    }, 'Failed to get Channel 0.');
  }

  async probeChannels(): Promise<void> {
    this.patch({isWriting: true, channels: []});
    try {
      if (this.snapshot.connectionOwner === 'android-native' && this.nativeSession) {
        this.patch({channels: this.channelsFromNative(await this.nativeSession.probeChannels())});
      } else if (this.meshCoreClient) {
        const results = await this.meshCoreClient.probeChannels();
        this.patch({channels: this.channelsFromLines(results.map(result => ({parsedLines: result.parsedLines})))});
      }
    } catch (error) {
      this.patch({status: 'Error', statusDetail: error instanceof Error ? error.message : 'Failed to probe channels.'});
    } finally {
      this.patch({isWriting: false});
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clearScanTimer();
    this.manager?.stopDeviceScan();
    this.meshCoreClient?.stop();
    this.meshCoreClient = null;
    if (this.nativeSession || this.deps.nativeCoordinator.isActive()) {
      await this.deps.nativeCoordinator.stop().catch(() => undefined);
    }
    this.nativeSession = null;
    this.connectedDevice = null;
    this.manager?.destroy();
    this.manager = null;
    this.listeners.clear();
    this.snapshot = initialSnapshot();
  }

  private async recoverNativeOwner(): Promise<void> {
    if (!this.nativeHandoffSupported) return;
    try {
      const nativeStatus = await this.deps.getNativeStatus();
      const address = nativeStatus.nativeBleDeviceAddress?.trim() ?? '';
      if (nativeStatus.ownership !== 'native-service' || !address) return;
      const label = nativeStatus.nativeBleDeviceLabel ?? nativeStatus.deviceLabel ?? 'MeshCore radio';
      this.patch({status: 'Connecting', statusDetail: 'Recovering Android-owned MeshCore radio session...', connectedDeviceAddress: address, connectedDeviceLabel: label, connectionOwner: 'android-native', meshCoreBle: null});
      const session = await this.startNativeSession(address, label);
      this.nativeSession = session;
      this.patch({status: 'Connected'});
      await this.runNativeStartupSync(session);
    } catch (error) {
      this.nativeSession = null;
      this.patch({status: 'Error', statusDetail: error instanceof Error ? `Native radio recovery failed: ${error.message}` : 'Native radio recovery failed.', connectedDeviceAddress: null, connectedDeviceLabel: null, connectionOwner: 'none'});
    }
  }

  private async startNativeSession(address: string, label: string): Promise<NativeMeshCoreSession> {
    return this.deps.nativeCoordinator.start(address, label, {
      onStatus: statusDetail => this.patch({statusDetail}),
      onError: message => this.patch({status: 'Error', statusDetail: message}),
      onFrame: response => this.addFrame(nativeResponseLog(response)),
    });
  }

  private async runReactNativeStartupSync(client: MeshCoreClient): Promise<void> {
    this.patch({isWriting: true, channels: [], statusDetail: 'Startup sync: sending App Start...'});
    try {
      await client.sendAppStart('BushMesh');
      this.patch({statusDetail: 'Startup sync: querying device info...'});
      await client.sendDeviceQuery();
      this.patch({statusDetail: 'Startup sync: loading configured channels...'});
      const results = await client.probeChannels();
      const channels = this.channelsFromLines(results.map(result => ({parsedLines: result.parsedLines})));
      const named = channels.filter(channel => channel.channelName !== 'Empty');
      this.patch({channels, statusDetail: `Startup sync complete. Loaded ${named.length} named channel(s) from ${channels.length} slot(s).`});
    } finally {
      this.patch({isWriting: false});
    }
  }

  private async runNativeStartupSync(session: NativeMeshCoreSession): Promise<void> {
    this.patch({isWriting: true, channels: [], statusDetail: 'Android session: loading configured channels...'});
    try {
      const channels = this.channelsFromNative(await session.probeChannels());
      const named = channels.filter(channel => channel.channelName !== 'Empty');
      this.patch({channels, statusDetail: `Android owns the radio. Loaded ${named.length} named channel(s) from ${channels.length} slot(s).`});
    } finally {
      this.patch({isWriting: false});
    }
  }

  private channelsFromLines(responses: Array<{parsedLines?: string[]}>): BushMeshChannel[] {
    return responses.map(response => channelFromParsedLines(response.parsedLines)).filter((channel): channel is BushMeshChannel => channel !== null);
  }

  private channelsFromNative(responses: NativeMeshCoreResponse[]): BushMeshChannel[] {
    return responses.map(response => channelFromParsedLines(response.parsed?.lines)).filter((channel): channel is BushMeshChannel => channel !== null);
  }

  private async runCommand(task: () => Promise<void>, fallback: string): Promise<void> {
    this.patch({isWriting: true});
    try {
      await task();
    } catch (error) {
      this.patch({status: 'Error', statusDetail: error instanceof Error ? error.message : fallback});
    } finally {
      this.patch({isWriting: false});
    }
  }

  private ensureManager(): BleManager {
    if (!this.manager) this.manager = this.deps.createBleManager();
    return this.manager;
  }

  private clearScanTimer(): void {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
  }

  private makeLogItem(log: MeshCoreLogItem): AppRadioLogItem {
    return {...log, id: `${Date.now()}-${Math.random().toString(16).slice(2)}`};
  }

  private addChunk(log: MeshCoreLogItem): void {
    if (log.label === 'RX_WRITE') this.patch({rxLogs: [this.makeLogItem(log), ...this.snapshot.rxLogs.slice(0, 39)]});
    else this.patch({txChunks: [this.makeLogItem(log), ...this.snapshot.txChunks.slice(0, 39)]});
  }

  private addFrame(log: MeshCoreLogItem): void {
    this.patch({txFrames: [this.makeLogItem(log), ...this.snapshot.txFrames.slice(0, 39)]});
  }

  private patch(patch: Partial<AppRadioConnectionSnapshot>): void {
    this.snapshot = {...this.snapshot, ...patch};
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach(listener => listener());
  }
}

export const appRadioConnectionService = new AppRadioConnectionService();
