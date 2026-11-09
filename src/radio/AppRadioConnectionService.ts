import {Buffer} from 'buffer';
import {BleManager, Device} from 'react-native-ble-plx';

import {requestBlePermissions} from '../ble/blePermissions';
import {
  BushMeshConvoyEnrollment,
  createBushMeshConvoy,
  joinBushMeshConvoy,
} from '../convoy/convoyProvisioning';
import {
  meshCoreSecretFromHex,
  meshCoreSecretToHex,
  safeMeshCoreChannel,
} from '../meshcore/meshcoreChannelInfo';
import {MeshCoreClient, MeshCoreLogItem} from '../meshcore/MeshCoreClient';
import {meshCoreInboundInbox} from '../meshcore/meshcoreInboundInbox';
import {nativeOutboundDiagnostics} from '../meshcore/nativeOutboundDiagnostics';
import {
  MeshCoreBleDiscovery,
  discoverMeshCoreBle,
} from '../meshcore/meshcoreBle';
import {MeshCoreDeviceInfo} from '../meshcore/meshcoreDeviceInfo';
import {
  redactMeshCoreDiagnosticBytes,
  redactMeshCoreParsedLines,
} from '../meshcore/meshcoreDiagnostics';
import {
  MeshCoreChannelProvisioningPort,
  clearMeshCoreChannel,
  provisionMeshCoreChannel,
  readAllMeshCoreChannels,
} from '../meshcore/meshcoreProvisioning';
import {MeshCoreSelfInfo} from '../meshcore/meshcoreSelfInfo';
import {
  NativeMeshCoreResponse,
  NativeMeshCoreSession,
} from '../meshcore/NativeMeshCoreSession';
import {
  NativeMeshCoreSessionCoordinator,
  nativeMeshCoreSessionCoordinator,
} from '../meshcore/NativeMeshCoreSessionCoordinator';
import {
  NativeRadioServiceStatus,
  isNativeRadioShutdownConfirmed,
  nativeRadioService,
  waitForNativeRadioShutdown,
} from '../native/NativeRadioService';
import {
  BushMeshChannel,
  BushMeshContact,
  BushMeshDeviceStatus,
} from '../state/BushMeshContext';
import {
  AppRadioSettingsInput,
  AppVerifiedRadioSettings,
  applyAndVerifyMeshCoreRadioSettings,
  refreshMeshCoreRadioSettings,
} from './appRadioSettings';

export type AppRadioConnectionStatus =
  | 'Disconnected'
  | 'Requesting permissions'
  | 'Scanning'
  | 'Connecting'
  | 'Connected'
  | 'Error';

export type AppRadioConnectionOwner = 'none' | 'react-native' | 'android-native';

export type AppRadioLogItem = MeshCoreLogItem & {id: string};

export type AppProvisionedChannel = {
  channelIndex: number;
  channelName: string;
  /** Sensitive: returned only to an explicit create/join/reveal UI flow. */
  secretHex: string;
};

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
  deviceInfo: MeshCoreDeviceInfo | null;
  selfInfo: MeshCoreSelfInfo | null;
  deviceTimeSeconds: number | null;
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
  stopNativeRadio: typeof nativeRadioService.stop;
  waitForNativeShutdown: typeof waitForNativeRadioShutdown;
  randomBytes: (length: number) => Promise<Uint8Array>;
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
  deviceInfo: null,
  selfInfo: null,
  deviceTimeSeconds: null,
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

function contactFromParsed(
  contact: Awaited<ReturnType<MeshCoreClient['syncContacts']>>[number],
): BushMeshContact {
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
  const diagnosticBytes = redactMeshCoreDiagnosticBytes(response.bytes);
  const parsedLines = redactMeshCoreParsedLines(
    response.packetType,
    response.parsed?.lines,
  );
  return {
    label: response.label,
    value: diagnosticBytes
      .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
      .join(' '),
    rawBytes: diagnosticBytes,
    parsedLines,
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
  private lifecycleGeneration = 0;
  private scanGeneration = 0;

  constructor(deps: Partial<Dependencies> = {}) {
    this.deps = {
      createBleManager: () => new BleManager(),
      createMeshCoreClient: (manager, device, events) =>
        new MeshCoreClient(manager, device, events),
      requestPermissions: requestBlePermissions,
      discoverBle: discoverMeshCoreBle,
      nativeCoordinator: nativeMeshCoreSessionCoordinator,
      nativeSupported: () => nativeRadioService.isSupported(),
      getNativeStatus: () => nativeRadioService.getStatus(),
      stopNativeRadio: () => nativeRadioService.stop(),
      waitForNativeShutdown: options => waitForNativeRadioShutdown(options),
      randomBytes: length => nativeRadioService.secureRandomBytes(length),
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
      deviceStatus: this.snapshot.deviceStatus
        ? {...this.snapshot.deviceStatus}
        : null,
      deviceInfo: this.snapshot.deviceInfo ? {...this.snapshot.deviceInfo} : null,
      selfInfo: this.snapshot.selfInfo ? {...this.snapshot.selfInfo} : null,
    };
  }

  get nativeHandoffSupported(): boolean {
    return this.deps.nativeSupported();
  }

  /** Connected UI alone is insufficient: a live native coordinator must own
   * the exact same command session before Radio may register its send handler. */
  hasUsableSendSession(): boolean {
    if (this.snapshot.status !== 'Connected') return false;
    if (this.snapshot.connectionOwner === 'react-native') {
      return this.meshCoreClient !== null;
    }
    if (this.snapshot.connectionOwner !== 'android-native' || !this.nativeSession) {
      return false;
    }
    const coordinator = this.deps.nativeCoordinator;
    // Test adapters may not implement the coordinator inspection extensions.
    if (typeof coordinator.getSession === 'function' &&
        coordinator.getSession() !== this.nativeSession) return false;
    if (typeof coordinator.getSnapshot === 'function' &&
        coordinator.getSnapshot().state !== 'active') return false;
    return true;
  }

  async initialize(): Promise<void> {
    if (this.initializePromise) return this.initializePromise;
    if (this.disposed) {
      this.disposed = false;
      this.lifecycleGeneration += 1;
    }
    const generation = this.lifecycleGeneration;
    this.ensureManager();
    const initialize = this.recoverNativeOwner(generation).finally(() => {
      if (this.initializePromise === initialize) this.initializePromise = null;
    });
    this.initializePromise = initialize;
    return initialize;
  }

  async startScan(): Promise<void> {
    const lifecycleGeneration = this.lifecycleGeneration;
    this.patch({
      status: 'Requesting permissions',
      statusDetail: 'Checking Bluetooth permissions...',
    });
    const granted = await this.deps.requestPermissions();
    if (!this.isActiveLifecycle(lifecycleGeneration)) return;
    if (!granted) {
      this.patch({
        status: 'Error',
        statusDetail: 'Bluetooth permissions were not granted.',
      });
      return;
    }

    const manager = this.ensureManager();
    this.cancelActiveScan();
    this.stopManagerScan(manager);
    const scanGeneration = ++this.scanGeneration;
    this.patch({
      devices: [],
      status: 'Scanning',
      statusDetail: 'Scanning for nearby BLE devices...',
    });
    manager.startDeviceScan(null, null, (error, device) => {
      if (!this.isActiveScan(manager, lifecycleGeneration, scanGeneration)) return;
      if (error) {
        this.finishScan(manager, scanGeneration, {
          status: 'Error',
          statusDetail: error.message,
        });
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
      if (!this.isActiveScan(manager, lifecycleGeneration, scanGeneration)) return;
      this.scanTimer = null;
      this.finishScan(manager, scanGeneration, {
        status: 'Disconnected',
        statusDetail: 'Scan finished. Select a device to connect.',
      });
    }, 10_000);
  }

  stopScan(): void {
    const wasScanning = this.snapshot.status === 'Scanning';
    this.cancelActiveScan();
    this.stopManagerScan(this.manager);
    if (wasScanning) {
      this.patch({
        status: 'Disconnected',
        statusDetail: 'Scan stopped. Select a discovered device to continue.',
      });
    }
  }

  async connectToDevice(device: Device): Promise<void> {
    this.stopScan();
    const manager = this.ensureManager();
    this.patch({
      status: 'Connecting',
      statusDetail: `Connecting to ${device.name ?? device.localName}...`,
    });
    try {
      const connected = await manager.connectToDevice(device.id);
      if (this.disposed || this.manager !== manager) return;
      const readyDevice =
        await connected.discoverAllServicesAndCharacteristics();
      if (this.disposed || this.manager !== manager) return;
      const discovery = await this.deps.discoverBle(readyDevice);
      if (this.disposed || this.manager !== manager) return;
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
        deviceInfo: null,
        selfInfo: null,
        deviceTimeSeconds: null,
        status: 'Connected',
      });
      if (!discovery.serviceFound || !discovery.rxFound || !discovery.txFound) {
        this.patch({
          statusDetail: `Connected to ${label}, but the MeshCore UART service was not fully found.`,
        });
        return;
      }

      const client = this.deps.createMeshCoreClient(manager, readyDevice, {
        onTxChunk: log => this.addChunk(log),
        onTxFrame: log => this.addFrame(log),
        onChannelMessage: message => meshCoreInboundInbox.publish(message),
        onMessagesWaiting: () => {
          // The session schedules its own bounded drain on the serial queue.
        },
        onStatus: statusDetail => this.patch({statusDetail}),
        onError: message => this.patch({status: 'Error', statusDetail: message}),
        onConnectionState: (state, detail) => {
          if (state === 'connected')
            this.patch({status: 'Connected', statusDetail: detail});
          else if (state === 'reconnecting')
            this.patch({status: 'Connecting', statusDetail: detail});
          else if (state === 'disconnected')
            this.patch({status: 'Disconnected', statusDetail: detail});
        },
      });
      this.meshCoreClient?.stop();
      this.meshCoreClient = client;
      client.start();
      await this.runReactNativeStartupSync(client);
    } catch (error) {
      this.patch({
        status: 'Error',
        statusDetail:
          error instanceof Error ? error.message : 'Failed to connect.',
      });
    }
  }

  /**
   * Hands a scan-only discovery directly to Android. No react-native-ble-plx
   * GATT connection is created on this path, so native ownership never races a
   * JavaScript connection for the same physical radio.
   */
  async handoffDiscoveredDeviceToAndroid(device: Device): Promise<void> {
    if (!this.nativeHandoffSupported) {
      this.patch({
        status: 'Error',
        statusDetail: 'Android native radio ownership is unavailable in this build.',
      });
      return;
    }
    if (this.snapshot.connectionOwner !== 'none') {
      this.patch({
        status: 'Error',
        statusDetail:
          'Disconnect the current radio owner before starting Android ownership.',
      });
      return;
    }

    this.stopScan();
    const address = device.id;
    const label = device.name ?? device.localName ?? 'MeshCore radio';
    this.patch({
      status: 'Connecting',
      statusDetail: `Handing ${label} directly to Android...`,
      connectedDeviceAddress: address,
      connectedDeviceLabel: label,
      connectionOwner: 'none',
      meshCoreBle: null,
      channels: [],
      contacts: [],
      deviceStatus: null,
      deviceInfo: null,
      selfInfo: null,
      deviceTimeSeconds: null,
    });

    try {
      const session = await this.startNativeSession(address, label);
      if (this.disposed) {
        await this.deps.nativeCoordinator.stop().catch(() => undefined);
        return;
      }
      this.nativeSession = session;
      this.connectedDevice = null;
      this.patch({
        connectionOwner: 'android-native',
        meshCoreBle: null,
        status: 'Connected',
      });
      await this.runNativeStartupSync(session);
      await this.refreshNativeDeviceState(session);
    } catch (error) {
      this.nativeSession = null;
      this.connectedDevice = null;
      this.patch({
        status: 'Error',
        statusDetail:
          error instanceof Error
            ? `Android radio handoff failed: ${error.message}`
            : 'Android radio handoff failed.',
        connectedDeviceAddress: null,
        connectedDeviceLabel: null,
        connectionOwner: 'none',
        meshCoreBle: null,
      });
    }
  }

  async handoffToAndroid(): Promise<void> {
    if (
      !this.snapshot.connectedDeviceAddress ||
      this.snapshot.connectionOwner === 'android-native'
    )
      return;
    if (!this.nativeHandoffSupported) {
      this.patch({
        status: 'Error',
        statusDetail: 'Android native radio ownership is unavailable in this build.',
      });
      return;
    }
    const address = this.snapshot.connectedDeviceAddress;
    const label = this.snapshot.connectedDeviceLabel ?? 'MeshCore radio';
    this.stopScan();
    const manager = this.ensureManager();
    this.patch({
      isWriting: true,
      statusDetail: 'Handing MeshCore BLE ownership to Android...',
    });
    try {
      this.meshCoreClient?.stop();
      this.meshCoreClient = null;
      await manager.cancelDeviceConnection(address).catch(() => undefined);
      this.connectedDevice = null;
      const session = await this.startNativeSession(address, label);
      this.nativeSession = session;
      this.patch({
        connectionOwner: 'android-native',
        meshCoreBle: null,
        status: 'Connected',
      });
      await this.runNativeStartupSync(session);
      await this.refreshNativeDeviceState(session);
    } catch (error) {
      this.nativeSession = null;
      this.connectedDevice = null;
      this.patch({
        status: 'Error',
        statusDetail:
          error instanceof Error
            ? `Android radio handoff failed: ${error.message}`
            : 'Android radio handoff failed.',
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
    this.stopScan();
    const nativeOwner = this.snapshot.connectionOwner === 'android-native';
    const nativeAddress = this.snapshot.connectedDeviceAddress;
    const nativeLabel = this.snapshot.connectedDeviceLabel;
    this.patch({isWriting: true});

    if (nativeOwner) {
      try {
        await this.deps.nativeCoordinator.stop();
        this.nativeSession = null;
        this.connectedDevice = null;
        this.snapshot = {...initialSnapshot(), statusDetail: 'Device disconnected.'};
        this.emit();
      } catch (error) {
        const detail =
          error instanceof Error
            ? error.message
            : 'Android native radio did not confirm shutdown.';
        this.patch({
          status: 'Error',
          statusDetail: `Background radio stop failed: ${detail}`,
          connectedDeviceAddress: nativeAddress,
          connectedDeviceLabel: nativeLabel,
          connectionOwner: 'android-native',
          isWriting: false,
        });
        throw error;
      }
      return;
    }

    try {
      this.meshCoreClient?.stop();
      this.meshCoreClient = null;
      const address =
        this.connectedDevice?.id ?? this.snapshot.connectedDeviceAddress;
      if (address)
        await this.ensureManager()
          .cancelDeviceConnection(address)
          .catch(() => undefined);
    } finally {
      this.connectedDevice = null;
      this.snapshot = {...initialSnapshot(), statusDetail: 'Device disconnected.'};
      this.emit();
    }
  }

  async runActiveStartupSync(): Promise<void> {
    try {
      if (
        this.snapshot.connectionOwner === 'android-native' &&
        this.nativeSession
      ) {
        this.patch({isWriting: true});
        const self = await this.nativeSession.sendAppStart('BushMesh');
        const device = await this.nativeSession.sendDeviceQuery();
        this.patch({
          selfInfo: self.selfInfo,
          deviceInfo: device.deviceInfo,
        });
        await this.runNativeStartupSync(this.nativeSession);
        await this.refreshNativeDeviceState(this.nativeSession);
      } else if (this.meshCoreClient) {
        await this.runReactNativeStartupSync(this.meshCoreClient);
      }
    } catch (error) {
      this.patch({
        status: 'Error',
        statusDetail:
          error instanceof Error ? error.message : 'Startup sync failed.',
        isWriting: false,
      });
    }
  }

  async getBatteryStatus(): Promise<void> {
    this.patch({isWriting: true});
    try {
      const battery =
        this.snapshot.connectionOwner === 'android-native'
          ? (await this.nativeSession?.getBatteryStatus())?.parsed?.batteryInfo
          : (await this.meshCoreClient?.getBatteryStatus())?.batteryInfo;
      if (battery) {
        this.patch({
          deviceStatus: battery,
          statusDetail: `Battery ${battery.batteryVolts.toFixed(
            2,
          )} V. Storage ${battery.storagePercent ?? 0}% used.`,
        });
      } else {
        this.patch({
          statusDetail: 'Battery response received, but no battery info parsed.',
        });
      }
    } catch (error) {
      this.patch({
        status: 'Error',
        statusDetail:
          error instanceof Error ? error.message : 'Failed to get battery status.',
      });
    } finally {
      this.patch({isWriting: false});
    }
  }

  async getDeviceTime(): Promise<number> {
    const session = this.requireManagementSession();
    this.patch({isWriting: true});
    try {
      const seconds = await session.getDeviceTime();
      this.patch({
        deviceTimeSeconds: seconds,
        statusDetail: `Node time: ${new Date(seconds * 1000).toISOString()}`,
      });
      return seconds;
    } finally {
      this.patch({isWriting: false});
    }
  }

  async setDeviceTimeToPhone(): Promise<number> {
    const session = this.requireManagementSession();
    this.patch({isWriting: true});
    try {
      const requested = Math.floor(Date.now() / 1000);
      const verified = await session.setDeviceTime(requested);
      if (verified < requested) {
        throw new Error('MeshCore node time did not verify after update.');
      }
      this.patch({
        deviceTimeSeconds: verified,
        statusDetail: 'Node time updated and read back successfully.',
      });
      return verified;
    } finally {
      this.patch({isWriting: false});
    }
  }

  async refreshRadioSettings(): Promise<AppVerifiedRadioSettings> {
    const session = this.requireManagementSession();
    this.patch({isWriting: true});
    try {
      const verified = await refreshMeshCoreRadioSettings(session);
      this.patch({
        selfInfo: verified.selfInfo,
        deviceInfo: verified.deviceInfo,
        statusDetail: `Radio profile refreshed: ${verified.summary}`,
      });
      return verified;
    } finally {
      this.patch({isWriting: false});
    }
  }

  async applyAndVerifyRadioSettings(
    input: AppRadioSettingsInput,
  ): Promise<AppVerifiedRadioSettings> {
    const session = this.requireManagementSession();
    this.patch({isWriting: true});
    try {
      const verified = await applyAndVerifyMeshCoreRadioSettings(session, input);
      this.patch({
        selfInfo: verified.selfInfo,
        deviceInfo: verified.deviceInfo,
        statusDetail: `Radio profile verified: ${verified.summary}`,
      });
      return verified;
    } finally {
      this.patch({isWriting: false});
    }
  }

  async syncContacts(): Promise<BushMeshContact[]> {
    this.patch({isWriting: true});
    try {
      const contacts =
        this.snapshot.connectionOwner === 'android-native'
          ? await this.nativeSession?.syncContacts()
          : await this.meshCoreClient?.syncContacts();
      const mapped = contacts?.map(contactFromParsed) ?? [];
      this.patch({
        contacts: mapped,
        statusDetail: `Contacts sync complete. Loaded ${mapped.length} contact(s).`,
      });
      return mapped;
    } catch (error) {
      this.patch({
        status: 'Error',
        statusDetail:
          error instanceof Error ? error.message : 'Failed to sync contacts.',
      });
      return [];
    } finally {
      this.patch({isWriting: false});
    }
  }

  async lookupContact(publicKeyOrPrefix: string): Promise<BushMeshContact> {
    const fullKey = this.resolveContactPublicKey(publicKeyOrPrefix);
    const contact = await this.requireManagementSession().lookupContact(fullKey);
    const mapped = contactFromParsed(contact);
    const without = this.snapshot.contacts.filter(
      current => current.publicKey.toUpperCase() !== mapped.publicKey.toUpperCase(),
    );
    this.patch({contacts: [mapped, ...without], statusDetail: 'Contact refreshed from node.'});
    return mapped;
  }

  async addOrUpdateContact(input: {
    publicKey: string;
    name: string;
    type?: number;
  }): Promise<BushMeshContact> {
    this.patch({isWriting: true});
    try {
      const contact = await this.requireManagementSession().addOrUpdateContact({
        publicKey: input.publicKey,
        name: input.name,
        type: input.type,
      });
      const mapped = contactFromParsed(contact);
      const without = this.snapshot.contacts.filter(
        current => current.publicKey.toUpperCase() !== mapped.publicKey.toUpperCase(),
      );
      this.patch({
        contacts: [mapped, ...without],
        statusDetail: 'Contact written and verified by public-key lookup.',
      });
      return mapped;
    } finally {
      this.patch({isWriting: false});
    }
  }

  async removeContact(publicKeyOrPrefix: string): Promise<void> {
    const fullKey = this.resolveContactPublicKey(publicKeyOrPrefix);
    this.patch({isWriting: true});
    try {
      await this.requireManagementSession().removeContact(fullKey);
      const contacts = await this.requireManagementSession().syncContacts();
      if (
        contacts.some(
          contact => contact.publicKey.toUpperCase() === fullKey.toUpperCase(),
        )
      ) {
        throw new Error('MeshCore contact removal did not verify during refresh.');
      }
      this.patch({
        contacts: contacts.map(contactFromParsed),
        statusDetail: 'Contact removed and node contact list verified.',
      });
    } finally {
      this.patch({isWriting: false});
    }
  }

  async exportContact(publicKeyOrPrefix: string): Promise<string> {
    const fullKey = this.resolveContactPublicKey(publicKeyOrPrefix);
    const bytes = await this.requireManagementSession().exportContact(fullKey);
    return Buffer.from(bytes).toString('base64');
  }

  async importContact(exportedBase64: string): Promise<BushMeshContact[]> {
    const normalized = exportedBase64.trim();
    if (!normalized) throw new Error('Paste a MeshCore exported contact first.');
    const bytes = Uint8Array.from(Buffer.from(normalized, 'base64'));
    this.patch({isWriting: true});
    try {
      await this.requireManagementSession().importContact(bytes);
      const contacts = await this.requireManagementSession().syncContacts();
      const mapped = contacts.map(contactFromParsed);
      this.patch({
        contacts: mapped,
        statusDetail: 'Contact import accepted; node contact list refreshed.',
      });
      return mapped;
    } finally {
      this.patch({isWriting: false});
    }
  }

  async refreshChannels(): Promise<BushMeshChannel[]> {
    this.patch({isWriting: true});
    try {
      const channels = await readAllMeshCoreChannels(this.requireProvisioningPort());
      const safe = channels.map(safeMeshCoreChannel);
      this.patch({
        channels: safe,
        statusDetail: `Loaded ${safe.length} channel slot(s) from the node-advertised capacity.`,
      });
      return safe;
    } finally {
      this.patch({isWriting: false});
    }
  }

  async createPrivateChannel(input: {
    channelName: string;
    channelIndex?: number | null;
  }): Promise<AppProvisionedChannel> {
    this.patch({isWriting: true});
    try {
      const provisioned = await provisionMeshCoreChannel(
        this.requireProvisioningPort(),
        {
          channelName: input.channelName,
          channelIndex: input.channelIndex,
          randomBytes: this.deps.randomBytes,
        },
      );
      await this.refreshChannelsInternal();
      this.patch({
        statusDetail: `Private channel “${provisioned.channelName}” written to slot ${provisioned.channelIndex} and verified.`,
      });
      return {
        channelIndex: provisioned.channelIndex,
        channelName: provisioned.channelName,
        secretHex: meshCoreSecretToHex(provisioned.secret),
      };
    } finally {
      this.patch({isWriting: false});
    }
  }

  async joinPrivateChannel(input: {
    channelName: string;
    secretHex: string;
    channelIndex?: number | null;
  }): Promise<AppProvisionedChannel> {
    this.patch({isWriting: true});
    try {
      const provisioned = await provisionMeshCoreChannel(
        this.requireProvisioningPort(),
        {
          channelName: input.channelName,
          secret: meshCoreSecretFromHex(input.secretHex),
          channelIndex: input.channelIndex,
        },
      );
      await this.refreshChannelsInternal();
      this.patch({
        statusDetail: `Private channel “${provisioned.channelName}” joined in slot ${provisioned.channelIndex} and verified.`,
      });
      return {
        channelIndex: provisioned.channelIndex,
        channelName: provisioned.channelName,
        secretHex: meshCoreSecretToHex(provisioned.secret),
      };
    } finally {
      this.patch({isWriting: false});
    }
  }

  async clearChannel(channelIndex: number): Promise<void> {
    this.patch({isWriting: true});
    try {
      await clearMeshCoreChannel(this.requireProvisioningPort(), channelIndex);
      await this.refreshChannelsInternal();
      this.patch({
        statusDetail: `Channel slot ${channelIndex} cleared and verified.`,
      });
    } finally {
      this.patch({isWriting: false});
    }
  }

  async revealChannelSecret(channelIndex: number, expectedChannelName?: string): Promise<string> {
    const channel = await this.requireProvisioningPort().readChannel(channelIndex);
    if (channel.empty || channel.secret.every(byte => byte === 0)) {
      throw new Error('This channel slot has no private MeshCore carrier secret.');
    }
    if (expectedChannelName !== undefined && channel.channelName !== expectedChannelName) {
      throw new Error('Carrier name changed since channel refresh; PSK reveal cancelled.');
    }
    return meshCoreSecretToHex(channel.secret);
  }

  async createConvoy(input: {
    convoyName: string;
    channelName?: string;
    channelIndex?: number | null;
  }): Promise<BushMeshConvoyEnrollment> {
    this.patch({isWriting: true});
    try {
      const enrollment = await createBushMeshConvoy(
        this.requireProvisioningPort(),
        {...input, randomBytes: this.deps.randomBytes},
      );
      await this.refreshChannelsInternal();
      this.patch({
        statusDetail: `Convoy “${enrollment.convoyName}” carrier provisioned and verified in slot ${enrollment.channel.channelIndex}.`,
      });
      return enrollment;
    } finally {
      this.patch({isWriting: false});
    }
  }

  async joinConvoy(input: {
    invite: string;
    channelIndex?: number | null;
  }): Promise<BushMeshConvoyEnrollment> {
    this.patch({isWriting: true});
    try {
      const enrollment = await joinBushMeshConvoy(
        this.requireProvisioningPort(),
        input,
      );
      await this.refreshChannelsInternal();
      this.patch({
        statusDetail: `Convoy “${enrollment.convoyName}” carrier joined and verified in slot ${enrollment.channel.channelIndex}.`,
      });
      return enrollment;
    } finally {
      this.patch({isWriting: false});
    }
  }

  async sendChannelMessage(channelIndex: number, message: string): Promise<void> {
    if (
      this.snapshot.connectionOwner === 'android-native' &&
      this.nativeSession
    ) {
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
      if (this.snapshot.connectionOwner === 'android-native') {
        const response = await this.nativeSession?.sendAppStart('BushMesh');
        if (response?.selfInfo) this.patch({selfInfo: response.selfInfo});
      } else {
        const response = await this.meshCoreClient?.sendAppStart('BushMesh');
        if (response?.selfInfo) this.patch({selfInfo: response.selfInfo});
      }
    }, 'App Start failed.');
  }

  async sendDeviceQuery(): Promise<void> {
    await this.runCommand(async () => {
      if (this.snapshot.connectionOwner === 'android-native') {
        const response = await this.nativeSession?.sendDeviceQuery();
        if (response?.deviceInfo) this.patch({deviceInfo: response.deviceInfo});
      } else {
        const response = await this.meshCoreClient?.sendDeviceQuery();
        if (response?.deviceInfo) this.patch({deviceInfo: response.deviceInfo});
      }
    }, 'Device Query failed.');
  }

  async getChannel0(): Promise<void> {
    await this.runCommand(async () => {
      const channel =
        this.snapshot.connectionOwner === 'android-native'
          ? channelFromParsedLines(
              (await this.nativeSession?.getChannel(0))?.parsed?.lines,
            )
          : channelFromParsedLines(
              (await this.meshCoreClient?.getChannel(0))?.parsedLines,
            );
      if (channel) this.patch({channels: [channel]});
    }, 'Failed to get Channel 0.');
  }

  async probeChannels(): Promise<void> {
    try {
      await this.refreshChannels();
    } catch (error) {
      this.patch({
        status: 'Error',
        statusDetail:
          error instanceof Error ? error.message : 'Failed to probe channels.',
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycleGeneration += 1;
    this.initializePromise = null;
    this.cancelActiveScan();
    const manager = this.manager;
    this.manager = null;
    this.stopManagerScan(manager);
    this.meshCoreClient?.stop();
    this.meshCoreClient = null;
    if (this.nativeSession || this.deps.nativeCoordinator.isActive()) {
      await this.deps.nativeCoordinator.stop().catch(() => undefined);
    }
    this.nativeSession = null;
    this.connectedDevice = null;
    if (manager) {
      try {
        manager.destroy();
      } catch {
        // A platform manager may already be terminating; disposal remains idempotent.
      }
    }
    this.listeners.clear();
    this.snapshot = initialSnapshot();
  }

  private async recoverNativeOwner(generation: number): Promise<void> {
    if (!this.nativeHandoffSupported) return;
    try {
      const nativeStatus = await this.deps.getNativeStatus();
      if (!this.isActiveLifecycle(generation)) return;
      const address = nativeStatus.nativeBleDeviceAddress?.trim() ?? '';
      if (nativeStatus.ownership !== 'native-service' || !address) return;
      const label =
        nativeStatus.nativeBleDeviceLabel ??
        nativeStatus.deviceLabel ??
        'MeshCore radio';
      this.patch({
        status: 'Connecting',
        statusDetail: 'Recovering Android-owned MeshCore radio session...',
        connectedDeviceAddress: address,
        connectedDeviceLabel: label,
        connectionOwner: 'android-native',
        meshCoreBle: null,
      });
      const session = await this.startNativeSession(address, label);
      if (!this.isActiveLifecycle(generation)) {
        await this.deps.nativeCoordinator.stop().catch(() => undefined);
        return;
      }
      this.nativeSession = session;
      this.patch({status: 'Connected'});
      await this.runNativeStartupSync(session);
      await this.refreshNativeDeviceState(session);
    } catch (error) {
      if (!this.isActiveLifecycle(generation)) return;
      this.nativeSession = null;
      this.patch({
        status: 'Error',
        statusDetail:
          error instanceof Error
            ? `Native radio recovery failed: ${error.message}`
            : 'Native radio recovery failed.',
        connectedDeviceAddress: null,
        connectedDeviceLabel: null,
        connectionOwner: 'none',
      });
    }
  }

  private async startNativeSession(
    address: string,
    label: string,
  ): Promise<NativeMeshCoreSession> {
    return this.deps.nativeCoordinator.start(address, label, {
      onStatus: statusDetail => this.patch({statusDetail}),
      onError: message => this.patch({status: 'Error', statusDetail: message}),
      onChannelMessage: message => meshCoreInboundInbox.publish(message),
      onMessagesWaiting: () => {
        // Native session owns the queued read commands; never open JS GATT.
      },
      onFrame: response => {
        if (response.selfInfo) this.patch({selfInfo: response.selfInfo});
        if (response.deviceInfo) this.patch({deviceInfo: response.deviceInfo});
        this.addFrame(nativeResponseLog(response));
      },
    });
  }

  private async runReactNativeStartupSync(client: MeshCoreClient): Promise<void> {
    this.patch({
      isWriting: true,
      channels: [],
      statusDetail: 'Startup sync: sending App Start...',
    });
    try {
      const self = await client.sendAppStart('BushMesh');
      this.patch({
        selfInfo: self.selfInfo ?? null,
        statusDetail: 'Startup sync: querying device info...',
      });
      const device = await client.sendDeviceQuery();
      this.patch({
        deviceInfo: device.deviceInfo ?? null,
        statusDetail: 'Startup sync: loading configured channels...',
      });
      const channels = await readAllMeshCoreChannels(client);
      const safe = channels.map(safeMeshCoreChannel);
      const named = safe.filter(channel => channel.channelName !== 'Empty');
      this.patch({
        channels: safe,
        statusDetail: `Startup sync complete. Loaded ${named.length} named channel(s) from ${safe.length} slot(s).`,
      });
    } finally {
      this.patch({isWriting: false});
    }
  }

  private async runNativeStartupSync(
    session: NativeMeshCoreSession,
  ): Promise<void> {
    this.patch({
      isWriting: true,
      channels: [],
      statusDetail: 'Android session: loading radio profile and configured channels...',
    });
    try {
      const self = await session.sendAppStart('BushMesh');
      const deviceInfo = await session.getDeviceInfo();
      const channels = await readAllMeshCoreChannels(session);
      const safe = channels.map(safeMeshCoreChannel);
      const named = safe.filter(channel => channel.channelName !== 'Empty');
      this.patch({
        selfInfo: self.selfInfo,
        deviceInfo,
        channels: safe,
        statusDetail: `Android owns the radio. Loaded ${named.length} named channel(s) from ${safe.length} slot(s).`,
      });
    } finally {
      this.patch({isWriting: false});
    }
  }

  private async refreshNativeDeviceState(
    session: NativeMeshCoreSession,
  ): Promise<void> {
    this.patch({isWriting: true});
    try {
      const battery =
        (await session.getBatteryStatus()).parsed?.batteryInfo ?? null;
      const contacts = (await session.syncContacts()).map(contactFromParsed);
      this.patch({deviceStatus: battery, contacts});
      // LiveQueueDrain starts during native session startup and also drains
      // after reconnect. A second startup loop would race it for queued frames.
    } finally {
      this.patch({isWriting: false});
    }
  }

  private async refreshChannelsInternal(): Promise<void> {
    const channels = await readAllMeshCoreChannels(this.requireProvisioningPort());
    this.patch({channels: channels.map(safeMeshCoreChannel)});
  }

  private requireProvisioningPort(): MeshCoreChannelProvisioningPort {
    if (
      this.snapshot.connectionOwner === 'android-native' &&
      this.nativeSession
    ) {
      return this.nativeSession;
    }
    if (this.snapshot.connectionOwner === 'react-native' && this.meshCoreClient) {
      return this.meshCoreClient;
    }
    throw new Error('No active MeshCore radio session is available for provisioning.');
  }

  private requireManagementSession(): NativeMeshCoreSession | MeshCoreClient {
    if (
      this.snapshot.connectionOwner === 'android-native' &&
      this.nativeSession
    ) {
      return this.nativeSession;
    }
    if (this.snapshot.connectionOwner === 'react-native' && this.meshCoreClient) {
      return this.meshCoreClient;
    }
    throw new Error('No active MeshCore radio session is available.');
  }

  private resolveContactPublicKey(publicKeyOrPrefix: string): string {
    const normalized = publicKeyOrPrefix.replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (/^[0-9A-F]{64}$/.test(normalized)) return normalized;
    if (!normalized || normalized.length > 64) {
      throw new Error('Enter a MeshCore public key or a unique synced public-key prefix.');
    }
    const matches = this.snapshot.contacts.filter(contact =>
      contact.publicKey.toUpperCase().startsWith(normalized),
    );
    if (matches.length === 1) return matches[0].publicKey;
    if (matches.length === 0) {
      throw new Error(
        'MeshCore firmware lookup requires the full 32-byte public key. Sync Contacts first so BushMesh can resolve this local prefix to one full key.',
      );
    }
    throw new Error('That public-key prefix matches more than one synced contact. Enter more key bytes.');
  }

  private channelsFromLines(
    responses: Array<{parsedLines?: string[]}>,
  ): BushMeshChannel[] {
    return responses
      .map(response => channelFromParsedLines(response.parsedLines))
      .filter((channel): channel is BushMeshChannel => channel !== null);
  }

  private channelsFromNative(
    responses: NativeMeshCoreResponse[],
  ): BushMeshChannel[] {
    return responses
      .map(response => channelFromParsedLines(response.parsed?.lines))
      .filter((channel): channel is BushMeshChannel => channel !== null);
  }

  private async runCommand(
    task: () => Promise<void>,
    fallback: string,
  ): Promise<void> {
    this.patch({isWriting: true});
    try {
      await task();
    } catch (error) {
      this.patch({
        status: 'Error',
        statusDetail: error instanceof Error ? error.message : fallback,
      });
    } finally {
      this.patch({isWriting: false});
    }
  }

  private ensureManager(): BleManager {
    if (this.disposed) {
      throw new Error('Application BLE manager is no longer active.');
    }
    if (!this.manager) this.manager = this.deps.createBleManager();
    return this.manager;
  }

  private isActiveLifecycle(generation: number): boolean {
    return !this.disposed && this.lifecycleGeneration === generation;
  }

  private isActiveScan(
    manager: BleManager,
    lifecycleGeneration: number,
    scanGeneration: number,
  ): boolean {
    return (
      this.isActiveLifecycle(lifecycleGeneration) &&
      this.manager === manager &&
      this.scanGeneration === scanGeneration
    );
  }

  private cancelActiveScan(): void {
    this.scanGeneration += 1;
    this.clearScanTimer();
  }

  private finishScan(
    manager: BleManager,
    scanGeneration: number,
    patch: Pick<AppRadioConnectionSnapshot, 'status' | 'statusDetail'>,
  ): void {
    if (this.manager !== manager || this.scanGeneration !== scanGeneration) return;
    this.cancelActiveScan();
    this.stopManagerScan(manager);
    this.patch(patch);
  }

  private stopManagerScan(manager: BleManager | null): void {
    if (!manager) return;
    try {
      manager.stopDeviceScan();
    } catch {
      // Stale native scan teardown must never resurrect a destroyed manager error.
    }
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
    if (log.label === 'RX_WRITE') {
      this.patch({
        rxLogs: [this.makeLogItem(log), ...this.snapshot.rxLogs.slice(0, 39)],
      });
    } else {
      this.patch({
        txChunks: [this.makeLogItem(log), ...this.snapshot.txChunks.slice(0, 39)],
      });
    }
  }

  private addFrame(log: MeshCoreLogItem): void {
    this.patch({
      txFrames: [this.makeLogItem(log), ...this.snapshot.txFrames.slice(0, 39)],
    });
  }

  private patch(patch: Partial<AppRadioConnectionSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = {...this.snapshot, ...patch};
    this.emit();
  }

  private emit(): void {
    if (this.disposed) return;
    this.listeners.forEach(listener => listener());
  }
}

export const appRadioConnectionService = new AppRadioConnectionService();
