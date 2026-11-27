import {Buffer} from 'buffer';
import {
  ChatConfiguration, ChatPersonalisation, chatPreferenceStore, configurationId,
} from './chatManagement/chatPreferences';
import {ChatOperationError, validateChatName, validateChatInvite} from './chatManagement/chatInvitations';
import type {MeshCoreChannelInfo} from '../meshcore/meshcoreChannelInfo';
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
  meshCoreSecretsEqual,
  safeMeshCoreChannel,
} from '../meshcore/meshcoreChannelInfo';
import {MeshCoreClient, MeshCoreLogItem} from '../meshcore/MeshCoreClient';
import {classifyChannelSubmissionFailure} from '../meshcore/channelSendDiagnostics';
import {meshCoreInboundInbox} from '../meshcore/meshcoreInboundInbox';
import {InboundConversationBoundary} from './chatManagement/InboundConversationBoundary';
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
  private disconnectPromise: Promise<void> | null = null;
  private connectedDevice: Device | null = null;
  private snapshot = initialSnapshot();
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private initializePromise: Promise<void> | null = null;
  private disposed = false;
  private lifecycleGeneration = 0;
  private scanGeneration = 0;
  private chatOperationActive = false;
  private chatSessionEpoch = 0;
  private readonly inboundBoundary = new InboundConversationBoundary();

  private publishChannelObservation(message: import('../meshcore/meshcoreParsers').ParsedChannelMessage, source: 'js-gatt' | 'native-session', matched = false) {
    const radio = this.getChatRadio();
    const epoch = this.chatSessionEpoch;
    const observed = this.inboundBoundary.observe(radio, epoch, message.channelIndex, matched,
      !!radio && this.isChatObservationCurrent(radio, epoch));
    const config = observed?.config;
    meshCoreInboundInbox.publish(message, {version: 1, source, origin: 'queued-generation-unknown',
      radio, configurationId: config?.id ?? null, configurationName: config?.name ?? null,
      timestamp: message.timestamp, snr: message.snr, pathLength: message.pathLength,
    }, {matchedQueueReply: matched, ...(observed?.incarnation !== undefined ? {
      confirmAssociation: () => this.confirmInboundAssociation(observed.config, observed.incarnation!, observed.revision, epoch),
    } : {})});
  }

  private async confirmInboundAssociation(config: ChatConfiguration, incarnation: number, revision: number, epoch: number) {
    const current = () => this.isChatObservationCurrent(config.radio, epoch) &&
      this.inboundBoundary.isCurrent(config.radio, epoch, config.id, incarnation, revision);
    if (!current()) return undefined;
    try {
      const session = this.requireManagementSession();
      // Use the existing serialized command path; do not start a second drain.
      const channel = await session.readChannel(config.slot);
      if (!current()) return undefined;
      const id = channel.empty ? null : (await this.chatConfiguration(config.radio, channel)).id;
      if (!current()) return undefined;
      if (id !== config.id) {
        // A currently observed external change invalidates all existing live
        // room bindings and requests the ordinary catalogue refresh path.
        this.chatSessionEpoch += 1;
        this.inboundBoundary.clear();
        this.patch({});
        return undefined;
      }
      return {version: 1 as const, evidence: 'post-empty-local-observation' as const, incarnation};
    } catch {
      return undefined;
    }
  }

  private async installInboundBinding(radio: string, epoch: number, configs: ChatConfiguration[]): Promise<void> {
    try {
      if (this.getChatRadio() !== radio || this.chatSessionEpoch !== epoch) return;
      const entries = await chatPreferenceStore.rememberConfigurations(radio, configs);
      if (this.getChatRadio() !== radio || this.chatSessionEpoch !== epoch) return;
      this.inboundBoundary.install(radio, epoch, configs, entries);
      this.requireManagementSession().requestInboundDrain?.();
    } catch {
      // Missing protected catalogue or session is not a radio transport failure.
      // The queue remains operational, but received records stay unassociated.
      if (this.getChatRadio() === radio && this.chatSessionEpoch === epoch) this.inboundBoundary.clear();
    }
  }

  private async bindStartupChannels(channels: MeshCoreChannelInfo[]): Promise<void> {
    const radio = this.getChatRadio();
    const epoch = this.chatSessionEpoch;
    if (!radio) return;
    try {
      const configs = await Promise.all(channels.filter(c => !c.empty).map(c => this.chatConfiguration(radio, c)));
      await this.installInboundBinding(radio, epoch, configs);
    } catch {
      if (this.getChatRadio() === radio && this.chatSessionEpoch === epoch) this.inboundBoundary.clear();
    }
  }

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

  private coordinatorSession(): NativeMeshCoreSession | null {
    const coordinator = this.deps.nativeCoordinator;
    return typeof coordinator.getSession === 'function'
      ? coordinator.getSession()
      : this.nativeSession;
  }

  private coordinatorOwnsRadio(): boolean {
    const coordinator = this.deps.nativeCoordinator;
    if (this.coordinatorSession()) return true;
    return typeof coordinator.getSnapshot === 'function' &&
      coordinator.getSnapshot().state !== 'idle';
  }

  private nativeServiceOwnsRadio(status: NativeRadioServiceStatus | null | undefined): boolean {
    return Boolean(status && (
      status.ownership === 'native-service' ||
      status.persistedNativeTargetPresent === true ||
      status.deviceAddress ||
      status.nativeBleDeviceAddress
    ));
  }

  /** Unknown Android status must never authorize a second BLE GATT owner. */
  private async readNativeStatusForTakeover(): Promise<NativeRadioServiceStatus> {
    try {
      const status = await this.deps.getNativeStatus();
      if (status) return status;
    } catch {
      // A status or binder exception is not proof of native disconnection.
    }
    throw new Error(
      'Could not verify Android radio ownership; BLE takeover is blocked until Android status is available.',
    );
  }

  private nativeFailureReason(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    if (/timed out/i.test(message)) return 'timeout';
    if (/PACKET_ERROR/i.test(message)) {
      const firmwareCode = /PACKET_ERROR\s*\((\d{1,3})\)/i.exec(message)?.[1];
      return firmwareCode ? `firmware error code ${firmwareCode}` : 'firmware rejection';
    }
    if (/disconnect|stopp|cancel|not ready/i.test(message)) return 'disconnected';
    if (/invalid|malformed|parse/i.test(message)) return 'invalid response';
    return 'unknown command failure';
  }

  private async recoverNativeFailure(
    address: string,
    label: string,
    stage: string,
    error: unknown,
  ): Promise<void> {
    const coordinator = this.deps.nativeCoordinator;
    const session = this.coordinatorSession();
    const state = typeof coordinator.getSnapshot === 'function'
      ? coordinator.getSnapshot().state
      : session ? 'active' : 'idle';
    const status = await Promise.resolve().then(() => this.deps.getNativeStatus()).catch(() => null);
    const nativeOwned = state !== 'idle' || this.nativeServiceOwnsRadio(status) ||
      this.nativeSession !== null;
    const usable = Boolean(session && state === 'active');
    this.nativeSession = usable ? session : null;
    this.connectedDevice = null;
    this.patch({
      status: usable ? 'Connected' : 'Error',
      statusDetail: `Native ${stage} failed (${this.nativeFailureReason(error)}). ${usable
        ? 'Command session remains ACTIVE; send and Stop are available.'
        : nativeOwned ? 'Android ownership remains; Stop can be retried.'
          : 'No native radio owner was confirmed.'}`,
      connectionOwner: nativeOwned ? 'android-native' : 'none',
      connectedDeviceAddress: nativeOwned ? status?.nativeBleDeviceAddress ??
        status?.deviceAddress ?? address : null,
      connectedDeviceLabel: nativeOwned ? status?.nativeBleDeviceLabel ??
        status?.deviceLabel ?? label : null,
      meshCoreBle: null,
      isWriting: false,
    });
  }

  private async syncNativeOptionalMetadata(session: NativeMeshCoreSession): Promise<void> {
    for (const step of [
      {name: 'channel synchronization', run: () => this.runNativeStartupSync(session)},
      {name: 'contacts and battery synchronization',
        run: () => this.refreshNativeDeviceState(session)},
    ]) {
      try {
        await step.run();
      } catch (error) {
        // Startup, contact and channel enumeration are NOT BLE ownership
        // changes. A healthy MeshCore command session can still send/receive.
        this.patch({
          status: this.hasUsableSendSession() ? 'Connected' : 'Error',
          statusDetail: `Native radio ${step.name} failed (${this.nativeFailureReason(error)}). ` +
            'The configured carrier and BLE ownership were not changed.',
          isWriting: false,
        });
      }
    }
  }

  /** Explicit recovery for a usable Android-owned command session after a
   * React-state divergence; never starts a JS-GATT connection or writes radio
   * configuration. The existing coordinator session is reused if active. */
  async recoverNativeCommandSession(): Promise<boolean> {
    this.chatSessionEpoch += 1;
    if (this.snapshot.connectionOwner === 'react-native' || this.meshCoreClient) {
      throw new Error('Disconnect BLE Tools before recovering the native session.');
    }
    const nativeStatus = await this.deps.getNativeStatus();
    if (!this.nativeServiceOwnsRadio(nativeStatus) && !this.coordinatorOwnsRadio()) {
      return false;
    }
    const coordinator = this.deps.nativeCoordinator;
    const coordinatorSnapshot = typeof coordinator.getSnapshot === 'function'
      ? coordinator.getSnapshot() : null;
    const address = nativeStatus?.nativeBleDeviceAddress?.trim() ??
      nativeStatus?.deviceAddress?.trim() ??
      coordinatorSnapshot?.deviceAddress ?? '';
    const label = nativeStatus?.nativeBleDeviceLabel ??
      nativeStatus?.deviceLabel ??
      coordinatorSnapshot?.deviceLabel ?? 'MeshCore radio';
    if (!address) throw new Error('Android native target address is missing; Stop must be confirmed before a fresh scan.');
    this.patch({
      status: 'Connecting',
      statusDetail: 'Recovering existing native MeshCore command session...',
      connectionOwner: 'android-native',
      connectedDeviceAddress: address,
      connectedDeviceLabel: label,
    });
    try {
      const existing = this.coordinatorSession();
      const session = existing && coordinatorSnapshot?.state === 'active' &&
        coordinatorSnapshot.deviceAddress === address
        ? existing
        : await this.startNativeSession(address, label);
      this.nativeSession = session;
      this.patch({status: 'Connected', connectionOwner: 'android-native'});
      await this.syncNativeOptionalMetadata(session);
      return this.hasUsableSendSession();
    } catch (error) {
      await this.recoverNativeFailure(address, label, 'command-session recovery', error);
      return this.hasUsableSendSession();
    }
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
    this.chatSessionEpoch += 1;
    this.stopScan();
    // Android's persisted target is authoritative even if an earlier
    // optional sync incorrectly cleared the React connection snapshot.
    const androidStatus = await this.readNativeStatusForTakeover();
    if (this.coordinatorOwnsRadio() ||
        this.nativeServiceOwnsRadio(androidStatus) ||
        this.snapshot.connectionOwner === 'android-native') {
      throw new Error('Android still owns the radio. Stop Background Radio and confirm release before BLE Tools connects.');
    }
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
        channels: [],
        contacts: [],
        deviceStatus: null,
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
        onChannelMessage: message => this.publishChannelObservation(message, 'js-gatt'),
      onQueuedChannelMessage: message => this.publishChannelObservation(message, 'js-gatt', true),
      onQueueReadStart: () => this.inboundBoundary.startRead(this.getChatRadio(), this.chatSessionEpoch),
      onQueueEmpty: () => this.inboundBoundary.emptyReply(this.getChatRadio(), this.chatSessionEpoch),
      onQueueEvidenceLost: () => this.inboundBoundary.loseEvidence(),
        onMessagesWaiting: () => {
          // JS-GATT session schedules its own bounded inbound drain.
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
    this.chatSessionEpoch += 1;
    if (!this.nativeHandoffSupported) {
      this.patch({status: 'Error', statusDetail: 'Android native radio is unavailable.'});
      return;
    }
    let androidStatus: NativeRadioServiceStatus;
    try {
      androidStatus = await this.readNativeStatusForTakeover();
    } catch (error) {
      this.patch({
        status: 'Error',
        statusDetail: error instanceof Error ? error.message : 'Android ownership status unavailable.',
      });
      return;
    }
    if (this.snapshot.connectionOwner !== 'none' ||
        this.coordinatorOwnsRadio() || this.nativeServiceOwnsRadio(androidStatus)) {
      // No second GATT owner, even if the React snapshot has drifted to 'none'.
      this.patch({
        statusDetail: 'An existing native or React Native owner must be stopped before taking over.',
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
      await this.syncNativeOptionalMetadata(session);
    } catch (error) {
      await this.recoverNativeFailure(address, label, 'handoff', error);
    }
  }

  async handoffToAndroid(): Promise<void> {
    this.chatSessionEpoch += 1;
    if (!this.snapshot.connectedDeviceAddress ||
        this.snapshot.connectionOwner === 'android-native') return;
    if (!this.nativeHandoffSupported) {
      this.patch({status: 'Error', statusDetail: 'Android native radio is unavailable.'});
      return;
    }
    const address = this.snapshot.connectedDeviceAddress;
    const label = this.snapshot.connectedDeviceLabel ?? 'MeshCore radio';
    let nativeStatus: NativeRadioServiceStatus;
    try {
      nativeStatus = await this.readNativeStatusForTakeover();
    } catch (error) {
      this.patch({statusDetail: error instanceof Error ? error.message : 'Android ownership status unavailable.'});
      return;
    }
    if (this.coordinatorOwnsRadio() || this.nativeServiceOwnsRadio(nativeStatus)) {
      this.patch({statusDetail: 'Native ownership is already present; stop it before handoff.'});
      return;
    }
    this.stopScan();
    const manager = this.ensureManager();
    this.patch({isWriting: true, statusDetail: 'Handing BLE ownership to Android...'});
    try {
      this.meshCoreClient?.stop();
      this.meshCoreClient = null;
      await manager.cancelDeviceConnection(address);
      this.connectedDevice = null;
      const session = await this.startNativeSession(address, label);
      this.nativeSession = session;
      this.patch({
        connectionOwner: 'android-native',
        meshCoreBle: null,
        status: 'Connected',
      });
      await this.syncNativeOptionalMetadata(session);
    } catch (error) {
      await this.recoverNativeFailure(address, label, 'BLE handoff', error);
    } finally {
      this.patch({isWriting: false});
    }
  }

  async disconnect(): Promise<void> {
    this.chatSessionEpoch += 1;
    if (this.disconnectPromise) return this.disconnectPromise;
    const operation = this.disconnectInternal();
    this.disconnectPromise = operation;
    try {
      await operation;
    } finally {
      if (this.disconnectPromise === operation) this.disconnectPromise = null;
    }
  }

  private async disconnectInternal(): Promise<void> {
    this.stopScan();
    const nativeStatus = await Promise.resolve().then(() => this.deps.getNativeStatus()).catch(() => null);
    if (!nativeStatus && this.snapshot.connectionOwner === 'none' &&
        !this.nativeSession && !this.coordinatorOwnsRadio() && !this.meshCoreClient) {
      const detail = 'Cannot verify Android radio ownership; Stop is not confirmed. Retry once Android status is available.';
      this.patch({status: 'Error', statusDetail: detail});
      throw new Error(detail);
    }
    const nativeOwner = this.snapshot.connectionOwner === 'android-native' ||
      this.nativeSession !== null || this.coordinatorOwnsRadio() ||
      this.nativeServiceOwnsRadio(nativeStatus);

    if (nativeOwner &&
        (this.meshCoreClient !== null || this.snapshot.connectionOwner === 'react-native')) {
      throw new Error('Conflicting native and React Native ownership; refusing to stop an unrelated BLE owner.');
    }
    const address = this.snapshot.connectedDeviceAddress ??
      nativeStatus?.nativeBleDeviceAddress ?? nativeStatus?.deviceAddress ?? null;
    const label = this.snapshot.connectedDeviceLabel ??
      nativeStatus?.nativeBleDeviceLabel ?? nativeStatus?.deviceLabel ?? null;
    this.patch({isWriting: true});

    if (nativeOwner) {
      nativeOutboundDiagnostics.record('stop-requested', 'radio-stop');
      try {
        if (this.coordinatorOwnsRadio()) {
          await this.deps.nativeCoordinator.stop();
        }
        const afterCoordinator = await this.deps.getNativeStatus();
        if (!afterCoordinator || !isNativeRadioShutdownConfirmed(afterCoordinator)) {
          // A failed sync can leave Android owning the radio while the JS
          // coordinator has no session to stop. The native service is still
          // authoritative; dispatch STOP and await actual target release.
          const dispatched = await this.deps.stopNativeRadio();
          if (!dispatched) throw new Error('Android rejected the radio stop request.');
          await this.deps.waitForNativeShutdown({
            getStatus: this.deps.getNativeStatus,
          });
        }
        this.nativeSession = null;
        this.connectedDevice = null;
        this.snapshot = {...initialSnapshot(), statusDetail: 'Native radio fully stopped and target cleared.'};
        nativeOutboundDiagnostics.record('stop-confirmed', 'radio-stop');
        this.emit();
      } catch (error) {
        nativeOutboundDiagnostics.record('stop-failed', 'radio-stop', {reason: 'shutdown-error'});
        this.patch({
          status: 'Error',
          statusDetail: `Background Radio stop did not verify (${this.nativeFailureReason(error)}). Retry Stop.`,
          connectionOwner: 'android-native',
          connectedDeviceAddress: address,
          connectedDeviceLabel: label,
          isWriting: false,
        });
        throw error;
      }
      return;
    }

    try {
      this.meshCoreClient?.stop();
      this.meshCoreClient = null;
      const deviceAddress = this.connectedDevice?.id ?? this.snapshot.connectedDeviceAddress;
      if (deviceAddress) {
        await this.ensureManager().cancelDeviceConnection(deviceAddress);
      }
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
        status: this.hasUsableSendSession() ? 'Connected' : 'Error',
        statusDetail: `Startup sync incomplete (${this.nativeFailureReason(error)}). No BLE ownership was changed.`,
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
        status: this.hasUsableSendSession() ? 'Connected' : 'Error',
        statusDetail: `Contact synchronization failed (${this.nativeFailureReason(error)}). Radio session preserved.`,
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

  /** Radio identity is a local configuration reference, never authenticated membership. */
  getChatRadio(): string | null {
    const address = this.snapshot.connectedDeviceAddress;
    const key = this.snapshot.selfInfo?.publicKeyHex;
    return this.hasUsableSendSession() && address && key && /^[0-9a-f]{64}$/i.test(key)
      ? JSON.stringify([address.toUpperCase(), key.toUpperCase()]) : null;
  }

  getChatSessionEpoch(): number {
    return this.chatSessionEpoch;
  }

  /** A queue observation is only a local session observation, never proof of
   * historical key ownership. Do not attach one during any command mutation. */
  isChatObservationCurrent(radio: string, epoch: number): boolean {
    return this.getChatRadio() === radio && this.chatSessionEpoch === epoch &&
      !this.chatOperationActive && !this.snapshot.isWriting;
  }

  private async withChatPort<T>(
    expectedRadio: string,
    task: (port: MeshCoreChannelProvisioningPort, assertCurrent: () => void) => Promise<T>,
  ): Promise<T> {
    if (this.chatOperationActive || this.snapshot.isWriting ||
        this.getChatRadio() !== expectedRadio) {
      throw new Error('Radio changed or is busy. Refresh chats and retry.');
    }
    const port = this.requireProvisioningPort();
    const generation = this.lifecycleGeneration;
    const chatEpoch = this.chatSessionEpoch;
    const assertCurrent = () => {
      if (!this.isActiveLifecycle(generation) || chatEpoch !== this.chatSessionEpoch ||
          this.getChatRadio() !== expectedRadio ||
          (this.snapshot.connectionOwner === 'android-native'
            ? this.nativeSession !== port : this.meshCoreClient !== port)) {
        throw new Error('Radio session changed. Refresh chats before retrying.');
      }
    };
    this.chatOperationActive = true;
    this.patch({isWriting: true});
    const guarded: MeshCoreChannelProvisioningPort = {
      getDeviceInfo: async () => {
        assertCurrent();
        const result = await port.getDeviceInfo();
        assertCurrent();
        return result;
      },
      readChannel: async index => {
        assertCurrent();
        const result = await port.readChannel(index);
        assertCurrent();
        return result;
      },
      writeChannel: async (index, name, secret) => {
        assertCurrent();
        await port.writeChannel(index, name, secret);
        assertCurrent();
      },
    };
    try {
      assertCurrent();
      const result = await task(guarded, assertCurrent);
      assertCurrent();
      return result;
    } finally {
      this.chatOperationActive = false;
      if (chatEpoch === this.chatSessionEpoch ||
          this.getChatRadio() === expectedRadio) this.patch({isWriting: false});
    }
  }

  private async chatConfiguration(radio: string, channel: MeshCoreChannelInfo): Promise<ChatConfiguration> {
    if (channel.empty) throw new Error('Channel is empty.');
    return {
      id: await configurationId(radio, channel.channelIndex, channel.channelName,
        meshCoreSecretToHex(channel.secret)),
      radio, slot: channel.channelIndex, name: channel.channelName,
      privateChannel: channel.secret.some(byte => byte !== 0),
    };
  }

  async listChatConfigurations(radio: string): Promise<ChatConfiguration[]> {
    return this.withChatPort(radio, async (port, assertCurrent) => {
      const channels = await readAllMeshCoreChannels(port);
      const configs = await Promise.all(channels.filter(c => !c.empty)
        .map(c => this.chatConfiguration(radio, c)));
      assertCurrent();
      this.patch({channels: channels.map(safeMeshCoreChannel)});
      await this.installInboundBinding(radio, this.chatSessionEpoch, configs);
      assertCurrent();
      return configs;
    });
  }

  /** Same verified provisioning primitive as createPrivateChannel/joinPrivateChannel,
   * but a messenger may NEVER replace a configured slot. */
  async provisionChat(radio: string, input: {
    name: string; secretHex?: string; personalisation?: Partial<ChatPersonalisation>;
  }): Promise<ChatConfiguration> {
    this.inboundBoundary.clear();
    const name = validateChatName(input.name);
    if (input.secretHex !== undefined) validateChatInvite({name, secretHex: input.secretHex});
    // Do not modify firmware if protected preferences cannot be loaded.
    return this.withChatPort(radio, async (port, assertCurrent) => {
      try {
        await chatPreferenceStore.load();
      } catch {
        throw new ChatOperationError('storage', 'Protected preferences unavailable. No channel was written.');
      }
      let attemptedWrite = false;
      const emptyOnly: MeshCoreChannelProvisioningPort = {
        ...port,
        writeChannel: async (slot, channelName, secret) => {
          if (secret.every(byte => byte === 0)) throw new Error('Private key must be non-zero.');
          if (!(await port.readChannel(slot)).empty) {
            throw new Error('Channel slot is no longer empty. No replacement allowed.');
          }
          // Names are ambiguous in legacy history. Refuse duplicates on this radio,
          // even if the same name was assigned a different key.
          const all = await readAllMeshCoreChannels(port);
          if (all.some(c => !c.empty && c.channelName.toLowerCase() === channelName.toLowerCase())) {
            throw new ChatOperationError('duplicate', 'A channel with this name already exists on this radio. Open it or choose a different name.');
          }
          if (all.some(c => !c.empty && meshCoreSecretsEqual(c.secret, secret))) {
            throw new ChatOperationError('duplicate', 'This private channel key is already configured on the radio. Open the existing chat.');
          }
          if (!(await port.readChannel(slot)).empty) {
            throw new Error('Channel slot is no longer empty. No replacement allowed.');
          }
          // Prove that protected configuration identity is available before writing.
          await this.chatConfiguration(radio, {channelIndex: slot, channelName, secret, empty: false});
          if (!(await port.readChannel(slot)).empty) {
            throw new Error('Channel slot is no longer empty. No replacement allowed.');
          }
          attemptedWrite = true;
          await port.writeChannel(slot, channelName, secret);
        },
      };
      try {
        const provisioned = await provisionMeshCoreChannel(emptyOnly, {
          channelName: name,
          ...(input.secretHex === undefined
            ? {randomBytes: this.deps.randomBytes}
            : {secret: meshCoreSecretFromHex(input.secretHex.trim())}),
        });
        const config = await this.chatConfiguration(radio, {
          ...provisioned, empty: false,
        });
        const channels = await readAllMeshCoreChannels(port);
        const current = channels.find(c => c.channelIndex === config.slot);
        if (!current || current.empty ||
            (await this.chatConfiguration(radio, current)).id !== config.id) {
          throw new Error('Provisioned channel changed before confirmation.');
        }
        assertCurrent();
        this.patch({channels: channels.map(safeMeshCoreChannel)});
        // Durable creator evidence only after verified creation, never after joining.
        try {
          if (input.personalisation) {
            await chatPreferenceStore.recordProvisioned(config.id, input.secretHex === undefined, input.personalisation);
          } else {
            await chatPreferenceStore.recordProvisioned(config.id, input.secretHex === undefined);
          }
        } catch {
          throw new Error('Channel was provisioned but local preferences could not be saved. Refresh before retrying.');
        }
        return config;
      } catch (failure) {
        if (attemptedWrite) {
          // Existing tests and callers can distinguish failed readback from a
          // failure before any firmware write without exposing raw errors.
          throw new ChatOperationError('partial', 'Channel write may have completed but did not verify fully or preferences could not be saved. Refresh before retrying.');
        }
        if (failure instanceof Error && failure.message.includes('no empty channel slots')) {
          throw new ChatOperationError('full', 'All radio channel slots are occupied. Leave an unused chat or use another radio.');
        }
        throw failure;
      }
    });
  }

  private async requireChatConfiguration(
    port: MeshCoreChannelProvisioningPort, expected: ChatConfiguration,
  ): Promise<MeshCoreChannelInfo> {
    const current = await port.readChannel(expected.slot);
    if (current.empty || (await this.chatConfiguration(expected.radio, current)).id !== expected.id) {
      throw new Error('Channel configuration changed. Refresh chats before retrying.');
    }
    return current;
  }

  /** Recheck the exact protected identity against firmware, not a redacted slot. */
  async verifyChatConfiguration(expected: ChatConfiguration): Promise<void> {
    await this.withChatPort(expected.radio, async port => {
      await this.requireChatConfiguration(port, expected);
    });
  }

  /** Check and submit within the same guarded radio command ownership scope. */
  async sendVerifiedChat(expected: ChatConfiguration, text: string, beforeSubmit?: () => Promise<void>, finalGuard?: () => boolean): Promise<void> {
    let submitted = false;
    try {
      await this.withChatPort(expected.radio, async (port, assertCurrent) => {
        await this.requireChatConfiguration(port, expected);
        assertCurrent();
        if (beforeSubmit) await beforeSubmit();
        assertCurrent();
        // Local encrypted commit may take time: re-read exact configuration immediately before RF submission.
        if (beforeSubmit) {await this.requireChatConfiguration(port, expected); assertCurrent();}
        if (finalGuard && !finalGuard()) throw new ChatOperationError('stale', 'Voice destination changed. No message submitted.');
        submitted = true;
        await this.sendChannelMessage(expected.slot, text);
      });
    } catch (failure) {
      if (!submitted) {
        throw new ChatOperationError('stale', 'Chat configuration could not be verified. No message was submitted. Refresh chats.');
      }
      throw failure;
    }
  }

  /** Explicitly confirmed credential sharing only; no snapshot or log receives the key. */
  async revealChatCredential(expected: ChatConfiguration): Promise<string> {
    return this.withChatPort(expected.radio, async port => {
      const channel = await this.requireChatConfiguration(port, expected);
      if (!channel.secret.some(byte => byte !== 0)) throw new Error('Not a private channel.');
      return meshCoreSecretToHex(channel.secret);
    });
  }

  async leaveChat(expected: ChatConfiguration, onPhase?: (phase: 'removing' | 'verifying' | 'removed') => void): Promise<void> {
    this.inboundBoundary.clear();
    return this.withChatPort(expected.radio, async (port, assertCurrent) => {
      await this.requireChatConfiguration(port, expected);
      let attemptedClear = false;
      let writeAccepted = false;
      const checked: MeshCoreChannelProvisioningPort = {
        ...port,
        writeChannel: async (slot, name, secret) => {
          await this.requireChatConfiguration(port, expected);
          attemptedClear = true;
          onPhase?.('removing');
          await port.writeChannel(slot, name, secret);
          writeAccepted = true;
          onPhase?.('verifying');
        },
      };
      try {
        const cleared = await clearMeshCoreChannel(checked, expected.slot);
        assertCurrent();
        if (cleared.channelIndex !== expected.slot) throw new ChatOperationError('partial', 'Removal readback was for another slot. Refresh before retrying.');
        // Exact slot readback succeeded. Retire local binding before a separate full refresh.
        this.patch({channels: this.snapshot.channels.map(c => c.channelIndex === String(expected.slot) ? safeMeshCoreChannel(cleared) : c)});
        onPhase?.('removed');
        try {await chatPreferenceStore.forget(expected.id);} catch {
          throw new ChatOperationError('partial', 'Channel removal verified, but local retirement could not be saved. Refresh before retrying.');
        }
      } catch (failure) {
        if (failure instanceof ChatOperationError && failure.code === 'partial') throw failure;
        if (attemptedClear && !writeAccepted && classifyChannelSubmissionFailure(failure).reason === 'firmware-error') {
          throw new ChatOperationError('rejected', 'Radio rejected channel removal. Refresh before retrying.');
        }
        if (attemptedClear) {
          throw new ChatOperationError('partial', 'The radio slot may have been cleared. Refresh before retrying. Radio History has not been deleted.');
        }
        throw failure;
      }
    });
  }

  async refreshChannels(): Promise<BushMeshChannel[]> {
    if (this.chatOperationActive) throw new Error('Chat management is in progress.');
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
    if (this.chatOperationActive) throw new Error('Chat management is in progress.');
    this.chatSessionEpoch += 1; // Invalidate any cached messenger binding before a legacy write.
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
    if (this.chatOperationActive) throw new Error('Chat management is in progress.');
    this.chatSessionEpoch += 1; // Invalidate any cached messenger binding before a legacy write.
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
    if (this.chatOperationActive) throw new Error('Chat management is in progress.');
    this.chatSessionEpoch += 1; // Invalidate any cached messenger binding before a legacy write.
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
    if (this.chatOperationActive) throw new Error('Chat management is in progress.');
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
    if (this.chatOperationActive) throw new Error('Chat management is in progress.');
    this.chatSessionEpoch += 1; // Invalidate any cached messenger binding before a legacy write.
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
    if (this.chatOperationActive) throw new Error('Chat management is in progress.');
    this.chatSessionEpoch += 1; // Invalidate any cached messenger binding before a legacy write.
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
    if (this.snapshot.connectionOwner === 'android-native') {
      if (!this.hasUsableSendSession() || !this.nativeSession) {
        nativeOutboundDiagnostics.record('session-disconnected', 'channel-text', {
          channelSlot: channelIndex, reason: 'disconnected',
        });
        throw new Error('Android owns the radio but its native MeshCore command session is not ready. Recover its session or Stop; never switch BLE owners implicitly.');
      }
      nativeOutboundDiagnostics.record('command-queued', 'channel-text', {
        channelSlot: channelIndex,
      });
      const response = await this.nativeSession.sendChannelMessage(channelIndex, message);
      if (response.packetType !== 0x00) {
        throw new Error('Native channel submission returned an unexpected packet type.');
      }
      // Command-specific native session diagnostics record the *single*
      // observed PACKET_OK match or firmware failure. Duplicating them here
      // would falsely inflate per-command counts. Peer delivery remains unknown.
      return;
    }
    if (this.snapshot.connectionOwner === 'react-native' && this.meshCoreClient) {
      await this.meshCoreClient.sendChannelMessage(channelIndex, message);
      return;
    }
    throw new Error('No valid MeshCore command owner; no radio send was submitted.');
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
    let address = '';
    let label = 'MeshCore radio';
    try {
      const nativeStatus = await this.deps.getNativeStatus();
      if (!this.isActiveLifecycle(generation)) return;
      const coordinator = this.deps.nativeCoordinator;
      const coordinatorSnapshot = typeof coordinator.getSnapshot === 'function'
        ? coordinator.getSnapshot()
        : null;
      address = nativeStatus?.nativeBleDeviceAddress?.trim() ??
        nativeStatus?.deviceAddress?.trim() ??
        coordinatorSnapshot?.deviceAddress ?? '';
      if (!address || !(this.nativeServiceOwnsRadio(nativeStatus) ||
          this.coordinatorOwnsRadio())) return;
      label = nativeStatus?.nativeBleDeviceLabel ??
        nativeStatus?.deviceLabel ??
        coordinatorSnapshot?.deviceLabel ??
        label;
      this.patch({
        status: 'Connecting',
        statusDetail: 'Recovering existing Android-owned command session...',
        connectedDeviceAddress: address,
        connectedDeviceLabel: label,
        connectionOwner: 'android-native',
        meshCoreBle: null,
      });

      // Never open a second native GATT session if a healthy coordinator
      // already holds the exact radio's command session.
      const existing = this.coordinatorSession();
      const session = existing && coordinatorSnapshot?.state === 'active' &&
        coordinatorSnapshot.deviceAddress === address
        ? existing : await this.startNativeSession(address, label);
      if (!this.isActiveLifecycle(generation)) {
        await this.deps.nativeCoordinator.stop().catch(() => undefined);
        return;
      }
      this.nativeSession = session;
      this.patch({status: 'Connected', connectionOwner: 'android-native'});
      await this.syncNativeOptionalMetadata(session);
    } catch (error) {
      if (!this.isActiveLifecycle(generation)) return;
      await this.recoverNativeFailure(address, label, 'recovery', error);
    }
  }

  private async startNativeSession(
    address: string,
    label: string,
  ): Promise<NativeMeshCoreSession> {
    return this.deps.nativeCoordinator.start(address, label, {
      onStatus: statusDetail => this.patch({statusDetail}),
      onError: message => this.patch({
        status: this.hasUsableSendSession() ? 'Connected' : 'Error',
        statusDetail: `Native frame warning (${this.nativeFailureReason(new Error(message))}).`,
      }),
      onChannelMessage: message => this.publishChannelObservation(message, 'native-session'),
      onQueuedChannelMessage: message => this.publishChannelObservation(message, 'native-session', true),
      onQueueReadStart: () => this.inboundBoundary.startRead(this.getChatRadio(), this.chatSessionEpoch),
      onQueueEmpty: () => this.inboundBoundary.emptyReply(this.getChatRadio(), this.chatSessionEpoch),
      onQueueEvidenceLost: () => this.inboundBoundary.loseEvidence(),
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
      await this.bindStartupChannels(channels);
    } finally {
      this.patch({isWriting: false});
    }
  }

  private async runNativeStartupSync(
    session: NativeMeshCoreSession,
  ): Promise<void> {
    this.patch({
      isWriting: true,
      statusDetail: 'Android session: reading configured channels (no channel writes)...',
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
      await this.bindStartupChannels(channels);
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
    const next = {...this.snapshot, ...patch};
    if (next.status !== this.snapshot.status ||
        next.connectedDeviceAddress !== this.snapshot.connectedDeviceAddress ||
        next.connectionOwner !== this.snapshot.connectionOwner ||
        next.selfInfo?.publicKeyHex !== this.snapshot.selfInfo?.publicKeyHex) {
      this.chatSessionEpoch += 1;
      this.inboundBoundary.clear();
    }
    this.snapshot = next;
    this.emit();
  }

  private emit(): void {
    if (this.disposed) return;
    this.listeners.forEach(listener => listener());
  }
}

export const appRadioConnectionService = new AppRadioConnectionService();
