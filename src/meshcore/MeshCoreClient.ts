import {BleManager, Device, Subscription} from 'react-native-ble-plx';

import {
  BUSHMESH_MESHCORE_DEV_DATA_TYPE,
  BushMeshPosition,
  encodeBushMeshPosition,
} from '../bushmesh/protocol';
import {
  BushMeshInboundMessage,
  decodeBushMeshMeshCoreFrame,
} from '../bushmesh/meshcoreBridge';
import {bushMeshRadioSession} from '../radio/BushMeshRadioSession';
import {meshCoreSelfInfoToRadioProfile} from '../radio/meshCoreRadioProfile';
import {MESHCORE_BLE} from './meshcoreBle';
import {
  buildAppStartCommand,
  buildDeviceQueryCommand,
  buildGetBatteryCommand,
  buildGetChannelCommand,
  buildGetContactsCommand,
  buildGetMessageCommand,
  buildSendChannelDataFloodCommand,
  buildSendChannelMessageCommand,
  getBatteryCommandHex,
  getChannelCommandHex,
  getContactsCommandHex,
  getMessageCommandHex,
  sendChannelDataFloodCommandHex,
  sendChannelMessageCommandHex,
} from './meshcoreCommands';
import {
  MeshCoreChannelDataFrame,
  parseMeshCoreChannelDataFrame,
} from './meshcoreChannelData';
import {
  MeshCoreDeviceInfo,
  parseMeshCoreDeviceInfo,
} from './meshcoreDeviceInfo';
import {
  MeshCoreSelfInfo,
  parseMeshCoreSelfInfo,
} from './meshcoreSelfInfo';
import {
  base64ToBytes,
  decodeMeshCoreBytes,
  decodeMeshCorePacket,
} from './meshcorePackets';
import {
  ParsedBatteryInfo,
  ParsedChannelMessage,
  ParsedContactInfo,
  ParsedContactMessage,
  parseMeshCorePacketFields,
} from './meshcoreParsers';
import {
  MeshCoreReassembler,
  createIdleReassembler,
} from './meshcoreReassembler';
import {SerialTaskQueue} from './serialTaskQueue';

const DEFAULT_COMMAND_TIMEOUT_MS = 5000;
const FALLBACK_CHANNEL_COUNT = 8;
const REQUESTED_BLE_MTU = 185;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
const RESYNC_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;

export type MeshCoreConnectionState =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'stopped';

export type MeshCoreLogItem = {
  label: string;
  value: string;
  detail?: string;
  rawBytes?: number[];
  parsedLines?: string[];
  channelMessage?: ParsedChannelMessage;
  contactMessage?: ParsedContactMessage;
  batteryInfo?: ParsedBatteryInfo;
  contactInfo?: ParsedContactInfo;
  contactsStartCount?: number;
  contactsEndLastModified?: number | null;
  deviceInfo?: MeshCoreDeviceInfo;
  selfInfo?: MeshCoreSelfInfo;
  channelData?: MeshCoreChannelDataFrame;
  bushMeshMessage?: BushMeshInboundMessage;
};

export type MeshCoreSyncedMessage = {
  type: 'channel' | 'contact' | 'data';
  log: MeshCoreLogItem;
};

export type MeshCoreClientEvents = {
  onTxChunk: (log: MeshCoreLogItem) => void;
  onTxFrame: (log: MeshCoreLogItem) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  onConnectionState?: (state: MeshCoreConnectionState, detail: string) => void;
  onMessagesWaiting?: () => void;
  onChannelMessage?: (message: ParsedChannelMessage) => void;
  onContactMessage?: (message: ParsedContactMessage) => void;
  onChannelData?: (frame: MeshCoreChannelDataFrame) => void;
  onBushMeshMessage?: (message: BushMeshInboundMessage) => void;
};

type PendingCommand = {
  label: string;
  expectedPacketTypes: number[];
  expectedPacketLabel: string;
  resolve: (log: MeshCoreLogItem) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export class MeshCoreClient {
  private manager: BleManager;
  private device: Device;
  private events: MeshCoreClientEvents;
  private txSubscription: Subscription | null = null;
  private disconnectSubscription: Subscription | null = null;
  private reassembler: MeshCoreReassembler | null = null;
  private pendingCommand: PendingCommand | null = null;
  private commandQueue = new SerialTaskQueue();
  private mtuPromise: Promise<number | null> | null = null;
  private lastDeviceInfo: MeshCoreDeviceInfo | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private resyncAttempt = 0;
  private reconnectInProgress = false;
  private transportActive = false;
  private stopped = true;
  private lifecycleGeneration = 0;
  private readonly radioSessionOwner = {};

  constructor(
    manager: BleManager,
    device: Device,
    events: MeshCoreClientEvents,
  ) {
    this.manager = manager;
    this.device = device;
    this.events = events;
  }

  start(): void {
    this.prepareFreshStart();
    this.stopped = false;
    this.lifecycleGeneration += 1;
    this.reconnectAttempt = 0;
    this.resyncAttempt = 0;
    this.installDisconnectMonitor();
    this.activateConnectedRuntime('claim');

    const detail = 'MeshCore client started. Listening for TX packets.';
    this.events.onStatus(detail);
    this.events.onConnectionState?.('connected', detail);
  }

  stop(): void {
    this.stopped = true;
    this.lifecycleGeneration += 1;
    this.clearReconnectTimer();
    this.clearResyncTimer();
    this.reconnectInProgress = false;

    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;

    this.deactivateConnectedRuntime('MeshCore client stopped.', 'release');
    this.events.onConnectionState?.('stopped', 'MeshCore client stopped.');
  }

  async sendAppStart(appName = 'BushMesh'): Promise<MeshCoreLogItem> {
    return this.enqueueCommand('CMD_APP_START', () =>
      this.executeCommandAndWaitForPacket(
        'CMD_APP_START',
        buildAppStartCommand(appName),
        '01 00 00 00 00 00 00 00 42 75 73 68 4D 65 73 68',
        [0x05],
        'PACKET_SELF_INFO',
      ),
    );
  }

  async sendDeviceQuery(): Promise<MeshCoreLogItem> {
    const result = await this.enqueueCommand('CMD_DEVICE_QUERY', () =>
      this.executeCommandAndWaitForPacket(
        'CMD_DEVICE_QUERY',
        buildDeviceQueryCommand(),
        '16 03',
        [0x0d],
        'PACKET_DEVICE_INFO',
      ),
    );

    if (result.deviceInfo) {
      this.lastDeviceInfo = result.deviceInfo;
    }

    return result;
  }

  async getBatteryStatus(): Promise<MeshCoreLogItem> {
    return this.enqueueCommand('CMD_GET_BATTERY', () =>
      this.executeCommandAndWaitForPacket(
        'CMD_GET_BATTERY',
        buildGetBatteryCommand(),
        getBatteryCommandHex(),
        [0x0c],
        'PACKET_BATTERY',
      ),
    );
  }

  async getChannel(channelIndex: number): Promise<MeshCoreLogItem> {
    return this.enqueueCommand(`CMD_GET_CHANNEL_${channelIndex}`, () =>
      this.executeCommandAndWaitForPacket(
        `CMD_GET_CHANNEL_${channelIndex}`,
        buildGetChannelCommand(channelIndex),
        getChannelCommandHex(channelIndex),
        [0x12],
        'PACKET_CHANNEL_INFO',
      ),
    );
  }

  async probeChannels(channelCount?: number): Promise<MeshCoreLogItem[]> {
    const advertisedChannelCount = this.lastDeviceInfo?.maxChannels;
    const requestedCount = channelCount ?? FALLBACK_CHANNEL_COUNT;
    const resolvedCount =
      advertisedChannelCount && advertisedChannelCount > 0
        ? advertisedChannelCount
        : Math.min(requestedCount, FALLBACK_CHANNEL_COUNT);

    const results: MeshCoreLogItem[] = [];

    for (let channelIndex = 0; channelIndex < resolvedCount; channelIndex += 1) {
      this.events.onStatus(
        `Probing channel ${channelIndex + 1} of ${resolvedCount}...`,
      );

      const result = await this.getChannel(channelIndex);
      results.push(result);

      await this.delay(80);
    }

    this.events.onStatus(
      `Channel probe complete. Checked ${resolvedCount} channels.`,
    );

    return results;
  }

  async sendChannelMessage(
    channelIndex: number,
    message: string,
  ): Promise<MeshCoreLogItem> {
    const cleanMessage = message.trim();

    if (!cleanMessage) {
      throw new Error('Message is empty.');
    }

    if (cleanMessage.length > 133) {
      throw new Error('Message is too long. Keep it under 133 characters.');
    }

    const timestampSeconds = Math.floor(Date.now() / 1000);
    const label = `CMD_SEND_CHANNEL_MESSAGE_${channelIndex}`;

    await this.enqueueCommand(label, () =>
      this.executeCommandAndWaitForPacket(
        label,
        buildSendChannelMessageCommand(
          channelIndex,
          cleanMessage,
          timestampSeconds,
        ),
        sendChannelMessageCommandHex(
          channelIndex,
          cleanMessage,
          timestampSeconds,
        ),
        [0x06],
        'PACKET_MSG_SENT',
      ),
    );

    const acceptedLog: MeshCoreLogItem = {
      label: 'CHANNEL_MESSAGE_ACCEPTED',
      value: cleanMessage,
      detail:
        `MeshCore accepted channel ${channelIndex} message for transmission. ` +
        'Peer delivery is not yet confirmed.',
    };

    this.events.onStatus(`${label} accepted by MeshCore.`);
    return acceptedLog;
  }

  async sendChannelData(
    channelIndex: number,
    dataType: number,
    payload: Uint8Array,
  ): Promise<MeshCoreLogItem> {
    const label = `CMD_SEND_CHANNEL_DATA_${channelIndex}`;

    return this.enqueueCommand(label, () =>
      this.executeCommandAndWaitForPacket(
        label,
        buildSendChannelDataFloodCommand(channelIndex, dataType, payload),
        sendChannelDataFloodCommandHex(channelIndex, dataType, payload),
        [0x00],
        'PACKET_OK',
      ),
    );
  }

  async sendBushMeshPosition(
    channelIndex: number,
    position: BushMeshPosition,
  ): Promise<MeshCoreLogItem> {
    return this.sendChannelData(
      channelIndex,
      BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      encodeBushMeshPosition(position),
    );
  }

  async syncNextMessage(): Promise<MeshCoreLogItem> {
    return this.enqueueCommand('CMD_SYNC_NEXT_MESSAGE', () =>
      this.executeCommandAndWaitForPacket(
        'CMD_SYNC_NEXT_MESSAGE',
        buildGetMessageCommand(),
        getMessageCommandHex(),
        [0x07, 0x08, 0x0a, 0x10, 0x11, 0x1b],
        'PACKET_MESSAGE_OR_DATA_OR_NO_MORE_MSGS',
      ),
    );
  }

  async syncQueuedMessages(maxMessages = 20): Promise<MeshCoreSyncedMessage[]> {
    const syncedMessages: MeshCoreSyncedMessage[] = [];

    for (let index = 0; index < maxMessages; index += 1) {
      this.events.onStatus(`Syncing queued message ${index + 1}...`);

      const result = await this.syncNextMessage();

      if (result.label === 'PACKET_NO_MORE_MSGS') {
        this.events.onStatus(
          `Message sync complete. Pulled ${syncedMessages.length} message(s).`,
        );
        return syncedMessages;
      }

      if (result.channelMessage) {
        syncedMessages.push({type: 'channel', log: result});
      } else if (result.contactMessage) {
        syncedMessages.push({type: 'contact', log: result});
      } else if (result.channelData) {
        syncedMessages.push({type: 'data', log: result});
      }

      await this.delay(80);
    }

    this.events.onStatus(
      `Message sync stopped after ${maxMessages} message check(s).`,
    );

    return syncedMessages;
  }

  async syncContacts(since?: number): Promise<ParsedContactInfo[]> {
    return this.enqueueCommand('CMD_GET_CONTACTS', () =>
      this.syncContactsInternal(since),
    );
  }

  private async syncContactsInternal(
    since?: number,
  ): Promise<ParsedContactInfo[]> {
    const contacts: ParsedContactInfo[] = [];

    this.events.onStatus('CMD_GET_CONTACTS sending...');

    const firstResponsePromise = this.waitForPacket(
      'CMD_GET_CONTACTS_START',
      [0x02, 0x03, 0x04],
      'PACKET_CONTACTS_START_OR_CONTACT_OR_END',
    );

    this.events.onTxChunk({
      label: 'RX_WRITE',
      value: `CMD_GET_CONTACTS: ${getContactsCommandHex(since)}`,
      detail: 'Command sent. Waiting for contacts sequence.',
    });

    try {
      await this.manager.writeCharacteristicWithResponseForDevice(
        this.device.id,
        MESHCORE_BLE.serviceUuid,
        MESHCORE_BLE.rxCharacteristicUuid,
        buildGetContactsCommand(since),
      );
    } catch (error) {
      this.rejectPendingCommand(
        'CMD_GET_CONTACTS_START',
        this.asError(error, 'Failed to write CMD_GET_CONTACTS.'),
      );
    }

    let result = await firstResponsePromise;

    if (result.contactInfo) {
      contacts.push(result.contactInfo);
    }

    if (result.label === 'PACKET_CONTACTS_END') {
      return contacts;
    }

    if (result.label === 'PACKET_CONTACTS_START') {
      const contactCount = result.contactsStartCount ?? 0;
      if (contactCount === 0) {
        this.events.onStatus('Contacts sync complete. Loaded 0 contact(s).');
        return contacts;
      }
    }

    for (let index = 0; index < 500; index += 1) {
      try {
        result = await this.waitForPacket(
          'CMD_GET_CONTACTS_NEXT',
          [0x03, 0x04],
          'PACKET_CONTACT_OR_END',
        );
      } catch {
        this.events.onStatus(
          `Contacts sync stopped. Loaded ${contacts.length} contact(s).`,
        );
        return contacts;
      }

      if (result.contactInfo) {
        contacts.push(result.contactInfo);
      }

      if (result.label === 'PACKET_CONTACTS_END') {
        this.events.onStatus(
          `Contacts sync complete. Loaded ${contacts.length} contact(s).`,
        );
        return contacts;
      }
    }

    this.events.onStatus(
      `Contacts sync stopped after ${contacts.length} contact(s).`,
    );

    return contacts;
  }

  private prepareFreshStart(): void {
    this.clearReconnectTimer();
    this.clearResyncTimer();
    this.reconnectInProgress = false;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
    this.deactivateConnectedRuntime('MeshCore client restarting.', 'release');
  }

  private installDisconnectMonitor(): void {
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = this.manager.onDeviceDisconnected(
      this.device.id,
      error => {
        if (this.stopped) {
          return;
        }

        const reason = error?.message
          ? `MeshCore BLE disconnected: ${error.message}`
          : 'MeshCore BLE disconnected unexpectedly.';
        this.handleUnexpectedDisconnect(reason);
      },
    );
  }

  private activateConnectedRuntime(mode: 'claim' | 'resume'): boolean {
    this.reassembler?.reset();
    this.reassembler = createIdleReassembler(bytes => {
      this.handleIncomingFrame(bytes);
    });

    this.txSubscription?.remove();
    this.txSubscription = this.manager.monitorCharacteristicForDevice(
      this.device.id,
      MESHCORE_BLE.serviceUuid,
      MESHCORE_BLE.txCharacteristicUuid,
      (error, characteristic) => {
        if (error) {
          if (!this.stopped && this.transportActive) {
            this.handleUnexpectedDisconnect(
              `MeshCore TX notification stream ended: ${error.message}`,
            );
          }
          return;
        }

        if (!characteristic?.value) {
          return;
        }

        const decodedChunk = decodeMeshCorePacket(characteristic.value);
        const bytes = base64ToBytes(characteristic.value);

        this.events.onTxChunk({
          label: decodedChunk.label,
          value: decodedChunk.hex,
          rawBytes: bytes,
          detail: `${decodedChunk.byteLength} byte BLE frame`,
        });

        this.reassembler?.pushChunk(bytes);
      },
    );

    const sender = async (
      channelIndex: number,
      dataType: number,
      payload: Uint8Array,
    ) => {
      await this.sendChannelData(channelIndex, dataType, payload);
    };

    const ownsSession =
      mode === 'claim'
        ? (bushMeshRadioSession.claimTransport(this.radioSessionOwner, sender), true)
        : bushMeshRadioSession.resumeTransportForOwner(
            this.radioSessionOwner,
            sender,
          );

    if (!ownsSession) {
      this.txSubscription?.remove();
      this.txSubscription = null;
      this.reassembler?.reset();
      this.reassembler = null;
      this.transportActive = false;
      return false;
    }

    this.transportActive = true;
    return true;
  }

  private deactivateConnectedRuntime(
    reason: string,
    ownership: 'suspend' | 'release',
  ): void {
    this.transportActive = false;

    this.txSubscription?.remove();
    this.txSubscription = null;

    this.reassembler?.reset();
    this.reassembler = null;

    this.commandQueue.cancelPending();
    this.mtuPromise = null;
    this.lastDeviceInfo = null;

    if (ownership === 'release') {
      bushMeshRadioSession.releaseTransport(this.radioSessionOwner);
    } else {
      bushMeshRadioSession.suspendTransportForOwner(this.radioSessionOwner);
    }

    if (this.pendingCommand) {
      const pending = this.pendingCommand;
      clearTimeout(pending.timeoutId);
      this.pendingCommand = null;
      pending.reject(new Error(`${pending.label} cancelled: ${reason}`));
    }
  }

  private handleUnexpectedDisconnect(reason: string): void {
    if (this.stopped || !this.transportActive) {
      return;
    }

    this.clearResyncTimer();
    this.deactivateConnectedRuntime(reason, 'suspend');

    const detail = `${reason} Bushmesh traffic is paused while the radio reconnects.`;
    this.events.onStatus(detail);
    this.events.onConnectionState?.('disconnected', detail);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.reconnectInProgress) {
      return;
    }

    const generation = this.lifecycleGeneration;
    const delayMs = RECONNECT_DELAYS_MS[
      Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    ];
    const attemptNumber = this.reconnectAttempt + 1;
    this.reconnectAttempt += 1;

    const detail = `Reconnecting to MeshCore in ${Math.round(
      delayMs / 1000,
    )}s (attempt ${attemptNumber}).`;
    this.events.onStatus(detail);
    this.events.onConnectionState?.('reconnecting', detail);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptReconnect(generation).catch(error => {
        this.events.onError(
          this.asError(error, 'Unexpected MeshCore reconnect failure.').message,
        );
      });
    }, delayMs);
  }

  private async attemptReconnect(generation: number): Promise<void> {
    if (this.stopped || generation !== this.lifecycleGeneration) {
      return;
    }

    this.reconnectInProgress = true;
    const deviceId = this.device.id;
    const attemptNumber = this.reconnectAttempt;
    this.events.onStatus(
      `MeshCore reconnect attempt ${attemptNumber} connecting to ${deviceId}...`,
    );

    try {
      const connected = await this.manager.connectToDevice(deviceId);
      const readyDevice =
        await connected.discoverAllServicesAndCharacteristics();

      if (this.stopped || generation !== this.lifecycleGeneration) {
        await this.manager.cancelDeviceConnection(deviceId).catch(() => undefined);
        return;
      }

      this.device = readyDevice;
      this.mtuPromise = null;
      this.lastDeviceInfo = null;

      if (!this.activateConnectedRuntime('resume')) {
        this.stopped = true;
        this.lifecycleGeneration += 1;
        this.clearReconnectTimer();
        this.clearResyncTimer();
        this.disconnectSubscription?.remove();
        this.disconnectSubscription = null;
        await this.manager.cancelDeviceConnection(deviceId).catch(() => undefined);
        this.events.onStatus(
          'MeshCore reconnect was abandoned because another radio now owns the Bushmesh session.',
        );
        return;
      }

      this.reconnectAttempt = 0;
      this.resyncAttempt = 0;
      const detail =
        'MeshCore BLE reconnected. Recovering radio identity and capabilities...';
      this.events.onStatus(detail);
      this.events.onConnectionState?.('connected', detail);

      await this.resyncAfterReconnect(generation);
    } catch (error) {
      if (this.stopped || generation !== this.lifecycleGeneration) {
        return;
      }

      const message = this.asError(error, 'MeshCore reconnect failed.').message;
      this.events.onStatus(`MeshCore reconnect failed: ${message}`);
      this.events.onConnectionState?.(
        'reconnecting',
        `MeshCore reconnect failed: ${message}`,
      );
      this.scheduleReconnect();
    } finally {
      this.reconnectInProgress = false;
    }
  }

  private async resyncAfterReconnect(generation: number): Promise<void> {
    if (
      this.stopped ||
      generation !== this.lifecycleGeneration ||
      !this.transportActive
    ) {
      return;
    }

    try {
      await this.sendAppStart('BushMesh');
      await this.sendDeviceQuery();

      if (
        this.stopped ||
        generation !== this.lifecycleGeneration ||
        !this.transportActive
      ) {
        return;
      }

      this.resyncAttempt = 0;
      const detail =
        'MeshCore session recovered. Identity and device capabilities are ready.';
      this.events.onStatus(detail);
      this.events.onConnectionState?.('connected', detail);
    } catch (error) {
      if (
        this.stopped ||
        generation !== this.lifecycleGeneration ||
        !this.transportActive
      ) {
        return;
      }

      const message = this.asError(error, 'MeshCore session resync failed.').message;
      this.events.onError(`MeshCore reconnected but session recovery failed: ${message}`);
      this.scheduleResync(generation);
    }
  }

  private scheduleResync(generation: number): void {
    if (
      this.stopped ||
      generation !== this.lifecycleGeneration ||
      !this.transportActive ||
      this.resyncTimer
    ) {
      return;
    }

    const delayMs = RESYNC_DELAYS_MS[
      Math.min(this.resyncAttempt, RESYNC_DELAYS_MS.length - 1)
    ];
    this.resyncAttempt += 1;
    this.events.onStatus(
      `Retrying MeshCore identity recovery in ${Math.round(delayMs / 1000)}s...`,
    );

    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      this.resyncAfterReconnect(generation).catch(error => {
        this.events.onError(
          this.asError(error, 'Unexpected MeshCore session recovery failure.')
            .message,
        );
      });
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearResyncTimer(): void {
    if (this.resyncTimer) {
      clearTimeout(this.resyncTimer);
      this.resyncTimer = null;
    }
  }

  private handleIncomingFrame(bytes: number[]): void {
    const decoded = decodeMeshCoreBytes(bytes);
    const parsed = parseMeshCorePacketFields(bytes);
    const deviceInfo = parseMeshCoreDeviceInfo(bytes) ?? undefined;
    const selfInfo = parseMeshCoreSelfInfo(bytes) ?? undefined;

    let channelData: MeshCoreChannelDataFrame | undefined;
    let bushMeshMessage: BushMeshInboundMessage | undefined;

    if (decoded.packetType === 0x1b) {
      try {
        channelData = parseMeshCoreChannelDataFrame(bytes) ?? undefined;
        if (channelData) {
          bushMeshMessage =
            decodeBushMeshMeshCoreFrame(channelData) ?? undefined;
        }
      } catch (error) {
        this.events.onError(
          this.asError(error, 'Invalid MeshCore channel-data frame.').message,
        );
      }
    }

    if (deviceInfo) {
      this.lastDeviceInfo = deviceInfo;
    }

    if (selfInfo) {
      bushMeshRadioSession.setIdentityForOwner(
        this.radioSessionOwner,
        selfInfo.bushMeshIdentityRef,
      );
      bushMeshRadioSession.setRadioProfileForOwner(
        this.radioSessionOwner,
        meshCoreSelfInfoToRadioProfile(selfInfo),
      );
    }

    const frameLog: MeshCoreLogItem = {
      label: decoded.label,
      value: decoded.hex,
      rawBytes: bytes,
      detail: parsed
        ? `${decoded.byteLength} byte BLE frame — ${parsed.title}`
        : `${decoded.byteLength} byte BLE frame`,
      parsedLines: parsed?.lines,
      channelMessage: parsed?.channelMessage,
      contactMessage: parsed?.contactMessage,
      batteryInfo: parsed?.batteryInfo,
      contactInfo: parsed?.contactInfo,
      contactsStartCount: parsed?.contactsStartCount,
      contactsEndLastModified: parsed?.contactsEndLastModified,
      deviceInfo,
      selfInfo,
      channelData,
      bushMeshMessage,
    };

    this.events.onTxFrame(frameLog);

    if (decoded.packetType === 0x83) {
      this.events.onStatus('Messages waiting on companion node.');
      this.events.onMessagesWaiting?.();
    }

    if (parsed?.channelMessage) {
      this.events.onChannelMessage?.(parsed.channelMessage);
    }

    if (parsed?.contactMessage) {
      this.events.onContactMessage?.(parsed.contactMessage);
    }

    if (channelData) {
      this.events.onChannelData?.(channelData);
    }

    if (bushMeshMessage) {
      this.events.onBushMeshMessage?.(bushMeshMessage);
    }

    this.handlePossibleCommandResponse(decoded.packetType, frameLog);
  }

  private enqueueCommand<T>(
    label: string,
    task: () => Promise<T>,
  ): Promise<T> {
    return this.commandQueue.enqueue(label, async () => {
      if (!this.transportActive || this.stopped) {
        throw new Error(`${label} cannot run while MeshCore is disconnected.`);
      }
      await this.ensureMtu();
      return task();
    });
  }

  private ensureMtu(): Promise<number | null> {
    if (this.mtuPromise) {
      return this.mtuPromise;
    }

    this.mtuPromise = this.manager
      .requestMTUForDevice(this.device.id, REQUESTED_BLE_MTU)
      .then(device => {
        const mtu = typeof device.mtu === 'number' ? device.mtu : null;
        this.events.onStatus(
          mtu
            ? `BLE MTU ready: ${mtu} bytes.`
            : 'BLE MTU request completed.',
        );
        return mtu;
      })
      .catch(error => {
        this.events.onStatus(
          `BLE MTU negotiation unavailable; continuing with current MTU (${this.asError(
            error,
            'unknown error',
          ).message}).`,
        );
        return null;
      });

    return this.mtuPromise;
  }

  private async executeCommandAndWaitForPacket(
    label: string,
    base64Command: string,
    displayHex: string,
    expectedPacketTypes: number[],
    expectedPacketLabel: string,
  ): Promise<MeshCoreLogItem> {
    this.events.onStatus(`${label} sending...`);

    const responsePromise = this.waitForPacket(
      label,
      expectedPacketTypes,
      expectedPacketLabel,
    );

    this.events.onTxChunk({
      label: 'RX_WRITE',
      value: `${label}: ${displayHex}`,
      detail: `Command sent. Waiting for ${expectedPacketLabel}.`,
    });

    try {
      await this.manager.writeCharacteristicWithResponseForDevice(
        this.device.id,
        MESHCORE_BLE.serviceUuid,
        MESHCORE_BLE.rxCharacteristicUuid,
        base64Command,
      );
    } catch (error) {
      this.rejectPendingCommand(
        label,
        this.asError(error, `${label} BLE write failed.`),
      );
    }

    this.events.onStatus(`${label} sent. Waiting for ${expectedPacketLabel}.`);
    return responsePromise;
  }

  private waitForPacket(
    label: string,
    expectedPacketTypes: number[],
    expectedPacketLabel: string,
  ): Promise<MeshCoreLogItem> {
    if (this.pendingCommand) {
      return Promise.reject(
        new Error(
          `Internal command overlap: ${label} started while waiting for ${this.pendingCommand.label}.`,
        ),
      );
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingCommand?.label === label) {
          this.pendingCommand = null;
        }

        reject(
          new Error(`${label} timed out waiting for ${expectedPacketLabel}.`),
        );
      }, DEFAULT_COMMAND_TIMEOUT_MS);

      this.pendingCommand = {
        label,
        expectedPacketTypes,
        expectedPacketLabel,
        resolve,
        reject,
        timeoutId,
      };
    });
  }

  private handlePossibleCommandResponse(
    packetType: number | null,
    frameLog: MeshCoreLogItem,
  ): void {
    if (!this.pendingCommand || packetType === null) {
      return;
    }

    if (packetType === 0x01) {
      const errorCode = frameLog.rawBytes?.[1];
      const suffix =
        typeof errorCode === 'number' ? ` (error code ${errorCode})` : '';
      this.rejectPendingCommand(
        this.pendingCommand.label,
        new Error(`${this.pendingCommand.label} returned PACKET_ERROR${suffix}.`),
      );
      return;
    }

    if (!this.pendingCommand.expectedPacketTypes.includes(packetType)) {
      return;
    }

    const completedCommand = this.pendingCommand;
    clearTimeout(completedCommand.timeoutId);
    this.pendingCommand = null;

    this.events.onStatus(
      `${completedCommand.label} matched response: ${frameLog.label}.`,
    );
    completedCommand.resolve(frameLog);
  }

  private rejectPendingCommand(label: string, error: Error): void {
    if (!this.pendingCommand || this.pendingCommand.label !== label) {
      return;
    }

    const pending = this.pendingCommand;
    clearTimeout(pending.timeoutId);
    this.pendingCommand = null;
    pending.reject(error);
  }

  private asError(error: unknown, fallback: string): Error {
    return error instanceof Error ? error : new Error(fallback);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
