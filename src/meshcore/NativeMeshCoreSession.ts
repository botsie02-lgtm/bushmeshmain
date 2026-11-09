import {BUSHMESH_MESHCORE_DEV_DATA_TYPE} from '../bushmesh/legacyProtocol';
import {bushMeshRadioSession} from '../radio/BushMeshRadioSession';
import {
  ReceivedDatagram,
  publishReceivedDatagram,
} from '../radio/ReceivedDatagram';
import {meshCoreSelfInfoToRadioProfile} from '../radio/meshCoreRadioProfile';
import {
  MeshCoreChannelInfo,
  parseMeshCoreChannelInfo,
} from './meshcoreChannelInfo';
import {
  buildAddUpdateContactCommand,
  buildAppStartCommand,
  buildDeviceQueryCommand,
  buildExportContactCommand,
  buildGetBatteryCommand,
  buildGetChannelCommand,
  buildGetContactByKeyCommand,
  buildGetContactsCommand,
  buildGetDeviceTimeCommand,
  buildGetMessageCommand,
  buildImportContactCommand,
  buildRemoveContactCommand,
  buildSendChannelDataFloodCommand,
  buildSendChannelMessageCommand,
  buildSetChannelCommand,
  buildSetDeviceTimeCommand,
  buildSetRadioParamsCommand,
  buildSetRadioTxPowerCommand,
  MeshCoreContactWriteInput,
} from './meshcoreCommands';
import {
  MeshCoreChannelDataFrame,
  parseMeshCoreChannelDataFrame,
} from './meshcoreChannelData';
import {
  MeshCoreDeviceInfo,
  parseMeshCoreDeviceInfo,
} from './meshcoreDeviceInfo';
import {MeshCoreFrameTransport} from './MeshCoreFrameTransport';
import {MeshCoreLiveQueueDrain} from './MeshCoreLiveQueueDrain';
import {meshCoreInboundDiagnostics} from './meshcoreInboundDiagnostics';
import {meshCoreInboundInbox, MESHCORE_INBOX_PENDING_LIMIT} from './meshcoreInboundInbox';
import {nativeOutboundDiagnostics} from './nativeOutboundDiagnostics';
import {meshCoreFrameToReceivedDatagram} from './MeshCoreReceivedDatagramAdapter';
import {decodeMeshCoreBytes} from './meshcorePackets';
import {
  ParsedContactInfo,
  ParsedChannelMessage,
  ParsedMeshCorePacket,
  parseMeshCorePacketFields,
} from './meshcoreParsers';
import {
  MeshCoreRadioParams,
  repeatModeForRadioWrite,
  validateMeshCoreRadioParams,
  validateMeshCoreTxPower,
  verifyMeshCoreRadioParams,
  verifyMeshCoreTxPower,
} from './meshcoreRadioSettings';
import {
  MeshCoreSelfInfo,
  parseMeshCoreSelfInfo,
} from './meshcoreSelfInfo';
import {validateMeshCoreChannelIndex} from './meshcoreProvisioning';
import {SerialTaskQueue} from './serialTaskQueue';

const COMMAND_TIMEOUT_MS = 5_000;
const MAX_CHANNEL_MESSAGE_CHARS = 133;
const MAX_CONTACT_RECORDS_PER_SYNC = 500;

export type NativeMeshCoreResponse = {
  packetType: number | null;
  label: string;
  bytes: number[];
  parsed: ParsedMeshCorePacket | null;
  selfInfo: MeshCoreSelfInfo | null;
  deviceInfo: MeshCoreDeviceInfo | null;
  channelData: MeshCoreChannelDataFrame | null;
  receivedDatagram: ReceivedDatagram | null;
  /** @deprecated Native radio lifecycle no longer decodes BushMesh payloads. */
  bushMeshMessage?: undefined;
};

export type NativeMeshCoreSessionEvents = {
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
  onFrame?: (response: NativeMeshCoreResponse) => void;
  onMessagesWaiting?: () => void;
  onChannelMessage?: (message: ParsedChannelMessage) => void;
  onReceivedDatagram?: (datagram: ReceivedDatagram) => void;
};

type PendingCommand = {
  label: string;
  expectedPacketTypes: number[];
  resolve: (response: NativeMeshCoreResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

function readUInt32LE(bytes: number[], offset: number): number | null {
  if (bytes.length < offset + 4) return null;
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

/**
 * Core MeshCore companion session running over the Android-owned BLE transport.
 * MeshCore framing is decoded here, but application protocol payloads are not.
 */
export class NativeMeshCoreSession {
  private readonly owner = {};
  private readonly commandQueue = new SerialTaskQueue();
  private pendingCommand: PendingCommand | null = null;
  private started = false;
  private lastDeviceInfo: MeshCoreDeviceInfo | null = null;
  private readonly liveDrain = new MeshCoreLiveQueueDrain(
    () => {
      if (meshCoreInboundInbox.pendingCount() >= MESHCORE_INBOX_PENDING_LIMIT) {
        throw new Error('MeshCore application inbox at capacity.');
      }
      return this.syncNextMessage();
    },
    (stage, reason) => {
      meshCoreInboundDiagnostics.record(stage, reason ? {reason} : {});
      if (stage === 'drain-error') {
        this.events.onStatus?.(`MeshCore inbound queue drain deferred: ${reason ?? 'unknown'}.`);
      }
    },
  );

  constructor(
    private readonly transport: MeshCoreFrameTransport,
    private readonly events: NativeMeshCoreSessionEvents = {},
  ) {}

  async start(appName = 'BushMesh'): Promise<void> {
    if (this.started) return;

    await this.transport.start({
      onFrame: bytes => this.handleFrame(bytes),
      onStatus: message => this.events.onStatus?.(message),
      onError: message => this.events.onError?.(message),
    });

    bushMeshRadioSession.claimTransport(
      this.owner,
      async (channelIndex, dataType, payload) => {
        await this.sendChannelData(channelIndex, dataType, payload);
      },
    );

    this.started = true;
    try {
      await this.sendAppStart(appName);
      await this.sendDeviceQuery();
      this.liveDrain.start();
      this.events.onStatus?.('Native MeshCore session is ready.');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.liveDrain.stop();
    this.started = false;
    this.commandQueue.cancelPending();
    this.rejectPending(new Error('Native MeshCore session stopped.'));
    this.lastDeviceInfo = null;
    bushMeshRadioSession.releaseTransport(this.owner);
    await this.transport.stop();
  }

  async sendAppStart(appName = 'BushMesh'): Promise<NativeMeshCoreResponse> {
    return this.enqueueCommand('CMD_APP_START', () =>
      this.executeCommand('CMD_APP_START', buildAppStartCommand(appName), [0x05]),
    );
  }

  async sendDeviceQuery(): Promise<NativeMeshCoreResponse> {
    const response = await this.enqueueCommand('CMD_DEVICE_QUERY', () =>
      this.executeCommand('CMD_DEVICE_QUERY', buildDeviceQueryCommand(), [0x0d]),
    );
    this.lastDeviceInfo = response.deviceInfo;
    return response;
  }

  async getDeviceInfo(): Promise<MeshCoreDeviceInfo> {
    if (this.lastDeviceInfo) return this.lastDeviceInfo;
    const response = await this.sendDeviceQuery();
    if (!response.deviceInfo) {
      throw new Error('MeshCore Device Info response could not be parsed.');
    }
    return response.deviceInfo;
  }

  async getBatteryStatus(): Promise<NativeMeshCoreResponse> {
    return this.enqueueCommand('CMD_GET_BATTERY', () =>
      this.executeCommand('CMD_GET_BATTERY', buildGetBatteryCommand(), [0x0c]),
    );
  }

  async getDeviceTime(): Promise<number> {
    const response = await this.enqueueCommand('CMD_GET_DEVICE_TIME', () =>
      this.executeCommand('CMD_GET_DEVICE_TIME', buildGetDeviceTimeCommand(), [0x09]),
    );
    const seconds = readUInt32LE(response.bytes, 1);
    if (seconds === null) throw new Error('MeshCore device time response was malformed.');
    return seconds;
  }

  async setDeviceTime(timestampSeconds: number): Promise<number> {
    await this.enqueueCommand('CMD_SET_DEVICE_TIME', () =>
      this.executeCommand(
        'CMD_SET_DEVICE_TIME',
        buildSetDeviceTimeCommand(timestampSeconds),
        [0x00],
      ),
    );
    return this.getDeviceTime();
  }

  async setRadioParams(input: MeshCoreRadioParams): Promise<MeshCoreSelfInfo> {
    const validated = validateMeshCoreRadioParams(input);
    const deviceResponse = await this.sendDeviceQuery();
    if (!deviceResponse.deviceInfo) {
      throw new Error('MeshCore Device Info is required before changing radio parameters.');
    }
    const repeatMode = repeatModeForRadioWrite(deviceResponse.deviceInfo);

    await this.enqueueCommand('CMD_SET_RADIO_PARAMS', () =>
      this.executeCommand(
        'CMD_SET_RADIO_PARAMS',
        buildSetRadioParamsCommand(validated, repeatMode),
        [0x00],
      ),
    );

    const readBack = await this.sendAppStart('BushMesh');
    if (!readBack.selfInfo) {
      throw new Error('MeshCore SELF_INFO was unavailable after changing radio parameters.');
    }
    verifyMeshCoreRadioParams(validated, readBack.selfInfo);
    return readBack.selfInfo;
  }

  async setRadioTxPower(txPowerDbm: number): Promise<MeshCoreSelfInfo> {
    const before = await this.sendAppStart('BushMesh');
    if (!before.selfInfo) {
      throw new Error('MeshCore SELF_INFO is required before changing TX power.');
    }
    const validated = validateMeshCoreTxPower(
      txPowerDbm,
      before.selfInfo.maxTxPower,
    );

    await this.enqueueCommand('CMD_SET_RADIO_TX_POWER', () =>
      this.executeCommand(
        'CMD_SET_RADIO_TX_POWER',
        buildSetRadioTxPowerCommand(validated),
        [0x00],
      ),
    );

    const readBack = await this.sendAppStart('BushMesh');
    if (!readBack.selfInfo) {
      throw new Error('MeshCore SELF_INFO was unavailable after changing TX power.');
    }
    verifyMeshCoreTxPower(validated, readBack.selfInfo);
    return readBack.selfInfo;
  }

  async getChannel(channelIndex: number): Promise<NativeMeshCoreResponse> {
    return this.enqueueCommand(`CMD_GET_CHANNEL_${channelIndex}`, () =>
      this.executeCommand(
        `CMD_GET_CHANNEL_${channelIndex}`,
        buildGetChannelCommand(channelIndex),
        [0x12],
      ),
    );
  }

  async readChannel(channelIndex: number): Promise<MeshCoreChannelInfo> {
    const deviceInfo = await this.getDeviceInfo();
    if (!deviceInfo.maxChannels) {
      throw new Error('MeshCore firmware did not advertise maxChannels.');
    }
    validateMeshCoreChannelIndex(channelIndex, deviceInfo.maxChannels);
    const response = await this.getChannel(channelIndex);
    const parsed = parseMeshCoreChannelInfo(response.bytes);
    if (!parsed || parsed.channelIndex !== channelIndex) {
      throw new Error(`MeshCore channel ${channelIndex} response was malformed.`);
    }
    return parsed;
  }

  async writeChannel(
    channelIndex: number,
    channelName: string,
    secret: Uint8Array,
  ): Promise<void> {
    const deviceInfo = await this.getDeviceInfo();
    if (!deviceInfo.maxChannels) {
      throw new Error('MeshCore firmware did not advertise maxChannels.');
    }
    validateMeshCoreChannelIndex(channelIndex, deviceInfo.maxChannels);
    await this.enqueueCommand(`CMD_SET_CHANNEL_${channelIndex}`, () =>
      this.executeCommand(
        `CMD_SET_CHANNEL_${channelIndex}`,
        buildSetChannelCommand(channelIndex, channelName, secret),
        [0x00],
      ),
    );
  }

  async probeChannels(): Promise<NativeMeshCoreResponse[]> {
    const deviceInfo = await this.getDeviceInfo();
    const count = deviceInfo.maxChannels;
    if (!count || count <= 0) {
      throw new Error('MeshCore firmware did not advertise a usable channel capacity.');
    }
    const responses: NativeMeshCoreResponse[] = [];
    for (let index = 0; index < count; index += 1) {
      responses.push(await this.getChannel(index));
    }
    return responses;
  }

  async syncContacts(since?: number): Promise<ParsedContactInfo[]> {
    return this.enqueueCommand('CMD_GET_CONTACTS', () =>
      this.syncContactsInternal(since),
    );
  }

  async lookupContact(publicKey: string): Promise<ParsedContactInfo> {
    const response = await this.enqueueCommand('CMD_GET_CONTACT_BY_KEY', () =>
      this.executeCommand(
        'CMD_GET_CONTACT_BY_KEY',
        buildGetContactByKeyCommand(publicKey),
        [0x03],
      ),
    );
    if (!response.parsed?.contactInfo) {
      throw new Error('MeshCore contact lookup returned an invalid contact record.');
    }
    return response.parsed.contactInfo;
  }

  async addOrUpdateContact(
    input: MeshCoreContactWriteInput,
  ): Promise<ParsedContactInfo> {
    await this.enqueueCommand('CMD_ADD_UPDATE_CONTACT', () =>
      this.executeCommand(
        'CMD_ADD_UPDATE_CONTACT',
        buildAddUpdateContactCommand(input),
        [0x00],
      ),
    );
    return this.lookupContact(input.publicKey);
  }

  async removeContact(publicKey: string): Promise<void> {
    await this.enqueueCommand('CMD_REMOVE_CONTACT', () =>
      this.executeCommand(
        'CMD_REMOVE_CONTACT',
        buildRemoveContactCommand(publicKey),
        [0x00],
      ),
    );
  }

  async exportContact(publicKey: string): Promise<Uint8Array> {
    const response = await this.enqueueCommand('CMD_EXPORT_CONTACT', () =>
      this.executeCommand(
        'CMD_EXPORT_CONTACT',
        buildExportContactCommand(publicKey),
        [0x0b],
      ),
    );
    return Uint8Array.from(response.bytes);
  }

  async importContact(exportedContact: Uint8Array): Promise<void> {
    await this.enqueueCommand('CMD_IMPORT_CONTACT', () =>
      this.executeCommand(
        'CMD_IMPORT_CONTACT',
        buildImportContactCommand(exportedContact),
        [0x00],
      ),
    );
  }

  async sendChannelMessage(
    channelIndex: number,
    message: string,
  ): Promise<NativeMeshCoreResponse> {
    this.validateKnownChannelIndex(channelIndex);
    const cleanMessage = message.trim();
    if (!cleanMessage) throw new Error('Message is empty.');
    if (cleanMessage.length > MAX_CHANNEL_MESSAGE_CHARS) {
      throw new Error(
        `Message is too long. Keep it under ${MAX_CHANNEL_MESSAGE_CHARS} characters.`,
      );
    }

    const timestampSeconds = Math.floor(Date.now() / 1000);
    return this.enqueueCommand(`CMD_SEND_CHANNEL_MESSAGE_${channelIndex}`, () =>
      this.executeCommand(
        `CMD_SEND_CHANNEL_MESSAGE_${channelIndex}`,
        buildSendChannelMessageCommand(
          channelIndex,
          cleanMessage,
          timestampSeconds,
        ),
        // Channel text submission uses PACKET_OK (0x00), not the
        // PACKET_MSG_SENT (0x06) response for direct/contact messages.
        [0x00],
      ),
    );
  }

  async syncNextMessage(): Promise<NativeMeshCoreResponse> {
    return this.enqueueCommand('CMD_SYNC_NEXT_MESSAGE', () =>
      this.executeCommand(
        'CMD_SYNC_NEXT_MESSAGE',
        buildGetMessageCommand(),
        [0x07, 0x08, 0x0a, 0x10, 0x11, 0x1b],
      ),
    );
  }

  async syncQueuedMessages(maxMessages = 20): Promise<NativeMeshCoreResponse[]> {
    const responses: NativeMeshCoreResponse[] = [];
    const limit = Math.max(1, Math.min(100, Math.floor(maxMessages)));
    for (let index = 0; index < limit; index += 1) {
      const response = await this.syncNextMessage();
      if (response.packetType === 0x0a) break;
      responses.push(response);
    }
    return responses;
  }

  async sendChannelData(
    channelIndex: number,
    dataType: number,
    payload: Uint8Array,
  ): Promise<NativeMeshCoreResponse> {
    this.validateKnownChannelIndex(channelIndex);
    return this.enqueueCommand(`CMD_SEND_CHANNEL_DATA_${channelIndex}`, () =>
      this.executeCommand(
        `CMD_SEND_CHANNEL_DATA_${channelIndex}`,
        buildSendChannelDataFloodCommand(channelIndex, dataType, payload),
        [0x00],
      ),
    );
  }

  /** @deprecated Legacy convenience path; canonical runtime should supply dataType. */
  async sendBushMeshDatagram(
    channelIndex: number,
    payload: Uint8Array,
  ): Promise<NativeMeshCoreResponse> {
    return this.sendChannelData(
      channelIndex,
      BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      payload,
    );
  }

  private validateKnownChannelIndex(channelIndex: number): void {
    const maxChannels = this.lastDeviceInfo?.maxChannels;
    if (maxChannels && maxChannels > 0) {
      validateMeshCoreChannelIndex(channelIndex, maxChannels);
    }
  }

  private async syncContactsInternal(since?: number): Promise<ParsedContactInfo[]> {
    const contacts: ParsedContactInfo[] = [];
    this.events.onStatus?.('CMD_GET_CONTACTS sending over native BLE…');

    let response = await this.executeCommand(
      'CMD_GET_CONTACTS_START',
      buildGetContactsCommand(since),
      [0x02, 0x03, 0x04],
    );
    if (response.parsed?.contactInfo) contacts.push(response.parsed.contactInfo);
    if (response.packetType === 0x04) return contacts;
    if (
      response.packetType === 0x02 &&
      (response.parsed?.contactsStartCount ?? 0) === 0
    ) {
      return contacts;
    }

    for (let index = 0; index < MAX_CONTACT_RECORDS_PER_SYNC; index += 1) {
      response = await this.waitForPacket('CMD_GET_CONTACTS_NEXT', [0x03, 0x04]);
      if (response.parsed?.contactInfo) contacts.push(response.parsed.contactInfo);
      if (response.packetType === 0x04) return contacts;
    }

    this.events.onStatus?.(
      `Native contacts sync stopped after ${contacts.length} contact(s); safety limit reached.`,
    );
    return contacts;
  }

  private enqueueCommand<T>(label: string, task: () => Promise<T>): Promise<T> {
    if (!this.started && label !== 'CMD_APP_START') {
      return Promise.reject(new Error('Native MeshCore session is not started.'));
    }
    return this.commandQueue.enqueue(label, async () => {
      await this.transport.ensureReady();
      if (label.startsWith('CMD_SEND_CHANNEL_MESSAGE_')) {
        nativeOutboundDiagnostics.record('transport-ready', 'channel-text', {
          channelSlot: Number(label.slice('CMD_SEND_CHANNEL_MESSAGE_'.length)),
        });
      }
      return task();
    });
  }

  private async executeCommand(
    label: string,
    base64Command: string,
    expectedPacketTypes: number[],
  ): Promise<NativeMeshCoreResponse> {
    const response = this.waitForPacket(label, expectedPacketTypes);
    this.events.onStatus?.(`${label} sending over native BLE…`);
    try {
      await this.transport.writeBase64(base64Command);
      if (label.startsWith('CMD_SEND_CHANNEL_MESSAGE_')) {
        // Android has only accepted the local queue; this is not a GATT
        // callback, MeshCore acceptance, or confirmed RF delivery.
        nativeOutboundDiagnostics.record('native-write-queued', 'channel-text', {
          channelSlot: Number(label.slice('CMD_SEND_CHANNEL_MESSAGE_'.length)),
        });
      }
    } catch (error) {
      if (label.startsWith('CMD_SEND_CHANNEL_MESSAGE_')) {
        nativeOutboundDiagnostics.record('write-failed', 'channel-text', {
          channelSlot: Number(label.slice('CMD_SEND_CHANNEL_MESSAGE_'.length)),
          reason: 'write-error',
        });
      }
      this.rejectPending(
        error instanceof Error
          ? error
          : new Error(`${label} native BLE write failed.`),
      );
    }
    return response;
  }

  private waitForPacket(
    label: string,
    expectedPacketTypes: number[],
  ): Promise<NativeMeshCoreResponse> {
    if (this.pendingCommand) {
      return Promise.reject(
        new Error(
          `Internal native MeshCore command overlap: ${label} while waiting for ${this.pendingCommand.label}.`,
        ),
      );
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingCommand?.label === label) this.pendingCommand = null;
        if (label.startsWith('CMD_SEND_CHANNEL_MESSAGE_')) {
          nativeOutboundDiagnostics.record('response-timeout', 'channel-text', {
            channelSlot: Number(label.slice('CMD_SEND_CHANNEL_MESSAGE_'.length)),
            reason: 'timeout',
          });
        }
        reject(new Error(`${label} timed out waiting for a MeshCore response. Packet may have transmitted; do not automatically resend.`));
      }, COMMAND_TIMEOUT_MS);
      this.pendingCommand = {label, expectedPacketTypes, resolve, reject, timeout};
    });
  }

  private handleFrame(bytes: number[]): void {
    const decoded = decodeMeshCoreBytes(bytes);
    let parsed: ParsedMeshCorePacket | null = null;
    let selfInfo: MeshCoreSelfInfo | null = null;
    let deviceInfo: MeshCoreDeviceInfo | null = null;
    let channelData: MeshCoreChannelDataFrame | null = null;
    let receivedDatagram: ReceivedDatagram | null = null;

    try {
      parsed = parseMeshCorePacketFields(bytes);
      selfInfo = parseMeshCoreSelfInfo(bytes);
      deviceInfo = parseMeshCoreDeviceInfo(bytes);

      if (decoded.packetType === 0x1b) {
        channelData = parseMeshCoreChannelDataFrame(bytes);
        if (channelData) {
          receivedDatagram = meshCoreFrameToReceivedDatagram(channelData, {
            radioIdentityRef: bushMeshRadioSession.getSnapshot().identityRef,
          });
          publishReceivedDatagram(receivedDatagram);
          this.events.onReceivedDatagram?.(receivedDatagram);
        }
      }
    } catch (error) {
      this.events.onError?.(
        error instanceof Error
          ? `Native MeshCore frame parsing failed: ${error.message}`
          : 'Native MeshCore frame parsing failed.',
      );
    }

    if (selfInfo) {
      bushMeshRadioSession.setIdentityForOwner(this.owner, selfInfo.bushMeshIdentityRef);
      bushMeshRadioSession.setRadioProfileForOwner(
        this.owner,
        meshCoreSelfInfoToRadioProfile(selfInfo),
      );
    }
    if (deviceInfo) this.lastDeviceInfo = deviceInfo;

    const response: NativeMeshCoreResponse = {
      packetType: decoded.packetType,
      label: decoded.label,
      bytes: [...bytes],
      parsed,
      selfInfo,
      deviceInfo,
      channelData,
      receivedDatagram,
    };

    this.events.onFrame?.(response);

    if (decoded.packetType === 0x83) {
      this.events.onMessagesWaiting?.();
      this.liveDrain.notifyWaiting();
    }
    if (parsed?.channelMessage) {
      meshCoreInboundDiagnostics.record(
        decoded.packetType === 0x11 ? 'received-0x11' : 'received-0x08',
      );
      this.events.onChannelMessage?.(parsed.channelMessage);
    }

    const activeLabel = this.pendingCommand?.label;
    if (activeLabel?.startsWith('CMD_SEND_CHANNEL_MESSAGE_') &&
        decoded.packetType !== null && decoded.packetType !== 0x83) {
      nativeOutboundDiagnostics.record('response-observed', 'channel-text', {
        channelSlot: Number(activeLabel.slice('CMD_SEND_CHANNEL_MESSAGE_'.length)),
        packetType: decoded.packetType,
      });
    }

    if (decoded.packetType === 0x01) {
      const code = bytes[1];
      if (activeLabel?.startsWith('CMD_SEND_CHANNEL_MESSAGE_')) {
        nativeOutboundDiagnostics.record('firmware-rejected', 'channel-text', {
          channelSlot: Number(activeLabel.slice('CMD_SEND_CHANNEL_MESSAGE_'.length)),
          packetType: 0x01,
          firmwareCode: code,
          reason: 'firmware-error',
        });
      }
      this.rejectPending(
        new Error(
          `${this.pendingCommand?.label ?? 'Native MeshCore command'} returned PACKET_ERROR${
            typeof code === 'number' ? ` (${code})` : ''
          }.`,
        ),
      );
      return;
    }

    const pending = this.pendingCommand;
    if (
      !pending ||
      decoded.packetType === null ||
      !pending.expectedPacketTypes.includes(decoded.packetType)
    ) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingCommand = null;
    this.events.onStatus?.(`${pending.label} matched ${decoded.label}.`);
    if (pending.label.startsWith('CMD_SEND_CHANNEL_MESSAGE_')) {
      nativeOutboundDiagnostics.record('response-matched', 'channel-text', {
        channelSlot: Number(pending.label.slice('CMD_SEND_CHANNEL_MESSAGE_'.length)),
        packetType: decoded.packetType,
      });
    }
    pending.resolve(response);
  }

  private rejectPending(error: Error): void {
    const pending = this.pendingCommand;
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingCommand = null;
    pending.reject(error);
  }
}
