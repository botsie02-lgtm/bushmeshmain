import {BleManager, Device, Subscription} from 'react-native-ble-plx';

import {MESHCORE_BLE} from './meshcoreBle';
import {
  buildAppStartCommand,
  buildDeviceQueryCommand,
  buildGetBatteryCommand,
  buildGetChannelCommand,
  buildGetMessageCommand,
  buildSendChannelMessageCommand,
  getBatteryCommandHex,
  getChannelCommandHex,
  getMessageCommandHex,
  sendChannelMessageCommandHex,
} from './meshcoreCommands';
import {
  base64ToBytes,
  decodeMeshCoreBytes,
  decodeMeshCorePacket,
} from './meshcorePackets';
import {
  ParsedBatteryInfo,
  ParsedChannelMessage,
  ParsedContactMessage,
  parseMeshCorePacketFields,
} from './meshcoreParsers';
import {
  MeshCoreReassembler,
  createIdleReassembler,
} from './meshcoreReassembler';

export type MeshCoreLogItem = {
  label: string;
  value: string;
  detail?: string;
  parsedLines?: string[];
  channelMessage?: ParsedChannelMessage;
  contactMessage?: ParsedContactMessage;
  batteryInfo?: ParsedBatteryInfo;
};

export type MeshCoreSyncedMessage = {
  type: 'channel' | 'contact';
  log: MeshCoreLogItem;
};

export type MeshCoreClientEvents = {
  onTxChunk: (log: MeshCoreLogItem) => void;
  onTxFrame: (log: MeshCoreLogItem) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  onMessagesWaiting?: () => void;
  onChannelMessage?: (message: ParsedChannelMessage) => void;
  onContactMessage?: (message: ParsedContactMessage) => void;
};

type PendingCommand = {
  label: string;
  expectedPacketTypes: number[];
  resolve: (log: MeshCoreLogItem) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export class MeshCoreClient {
  private manager: BleManager;
  private device: Device;
  private events: MeshCoreClientEvents;
  private txSubscription: Subscription | null = null;
  private reassembler: MeshCoreReassembler | null = null;
  private pendingCommand: PendingCommand | null = null;

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
    this.stop();

    this.reassembler = createIdleReassembler(bytes => {
      const decoded = decodeMeshCoreBytes(bytes);
      const parsed = parseMeshCorePacketFields(bytes);

      const frameLog: MeshCoreLogItem = {
        label: decoded.label,
        value: decoded.hex,
        detail: parsed
          ? `${decoded.byteLength} bytes assembled — ${parsed.title}`
          : `${decoded.byteLength} bytes assembled`,
        parsedLines: parsed?.lines,
        channelMessage: parsed?.channelMessage,
        contactMessage: parsed?.contactMessage,
        batteryInfo: parsed?.batteryInfo,
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

      this.handlePossibleCommandResponse(decoded.packetType, frameLog);
    });

    this.txSubscription = this.manager.monitorCharacteristicForDevice(
      this.device.id,
      MESHCORE_BLE.serviceUuid,
      MESHCORE_BLE.txCharacteristicUuid,
      (error, characteristic) => {
        if (error) {
          this.events.onError(`TX notify error: ${error.message}`);
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
          detail: `${decodedChunk.byteLength} byte BLE chunk`,
        });

        this.reassembler?.pushChunk(bytes);
      },
    );

    this.events.onStatus('MeshCore client started. Listening for TX packets.');
  }

  stop(): void {
    this.txSubscription?.remove();
    this.txSubscription = null;

    this.reassembler?.reset();
    this.reassembler = null;

    if (this.pendingCommand) {
      clearTimeout(this.pendingCommand.timeoutId);
      this.pendingCommand.reject(
        new Error(`${this.pendingCommand.label} cancelled.`),
      );
      this.pendingCommand = null;
    }
  }

  async sendAppStart(appName = 'BushMesh'): Promise<MeshCoreLogItem> {
    return this.writeCommandAndWaitForPacket(
      'CMD_APP_START',
      buildAppStartCommand(appName),
      '01 00 00 00 00 00 00 00 42 75 73 68 4D 65 73 68',
      [0x05],
      'PACKET_SELF_INFO',
    );
  }

  async sendDeviceQuery(): Promise<MeshCoreLogItem> {
    return this.writeCommandAndWaitForPacket(
      'CMD_DEVICE_QUERY',
      buildDeviceQueryCommand(),
      '16 03',
      [0x0d],
      'PACKET_DEVICE_INFO',
    );
  }
  async getBatteryStatus(): Promise<MeshCoreLogItem> {
    return this.writeCommandAndWaitForPacket(
      'CMD_GET_BATTERY',
      buildGetBatteryCommand(),
      getBatteryCommandHex(),
      [0x0c],
      'PACKET_BATTERY',
    );
  }
  async getChannel(channelIndex: number): Promise<MeshCoreLogItem> {
    return this.writeCommandAndWaitForPacket(
      `CMD_GET_CHANNEL_${channelIndex}`,
      buildGetChannelCommand(channelIndex),
      getChannelCommandHex(channelIndex),
      [0x12],
      'PACKET_CHANNEL_INFO',
    );
  }

  async probeChannels(channelCount = 40): Promise<MeshCoreLogItem[]> {
    const results: MeshCoreLogItem[] = [];

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      this.events.onStatus(
        `Probing channel ${channelIndex + 1} of ${channelCount}...`,
      );

      const result = await this.getChannel(channelIndex);
      results.push(result);

      await this.delay(120);
    }

    this.events.onStatus(
      `Channel probe complete. Checked ${channelCount} channels.`,
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
    const base64Command = buildSendChannelMessageCommand(
      channelIndex,
      cleanMessage,
      timestampSeconds,
    );
    const displayHex = sendChannelMessageCommandHex(
      channelIndex,
      cleanMessage,
      timestampSeconds,
    );

    this.events.onStatus(`${label} sending...`);

    this.events.onTxChunk({
      label: 'RX_WRITE',
      value: `${label}: ${displayHex}`,
      detail: 'Channel message sent from BushMesh to device.',
    });

    await this.manager.writeCharacteristicWithResponseForDevice(
      this.device.id,
      MESHCORE_BLE.serviceUuid,
      MESHCORE_BLE.rxCharacteristicUuid,
      base64Command,
    );

    const log: MeshCoreLogItem = {
      label: 'CHANNEL_MESSAGE_QUEUED',
      value: cleanMessage,
      detail: `Queued to channel ${channelIndex}.`,
    };

    this.events.onTxFrame(log);
    this.events.onStatus(`${label} written to device.`);

    return log;
  }

  async syncNextMessage(): Promise<MeshCoreLogItem> {
    return this.writeCommandAndWaitForPacket(
      'CMD_SYNC_NEXT_MESSAGE',
      buildGetMessageCommand(),
      getMessageCommandHex(),
      [0x07, 0x08, 0x0a, 0x10, 0x11],
      'PACKET_MESSAGE_OR_NO_MORE_MSGS',
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
        syncedMessages.push({
          type: 'channel',
          log: result,
        });
      }

      if (result.contactMessage) {
        syncedMessages.push({
          type: 'contact',
          log: result,
        });
      }

      await this.delay(120);
    }

    this.events.onStatus(
      `Message sync stopped after ${maxMessages} message check(s).`,
    );

    return syncedMessages;
  }

  private async writeCommandAndWaitForPacket(
    label: string,
    base64Command: string,
    displayHex: string,
    expectedPacketTypes: number[],
    expectedPacketLabel: string,
  ): Promise<MeshCoreLogItem> {
    if (this.pendingCommand) {
      throw new Error(
        `Busy waiting for ${this.pendingCommand.label}. Try again in a moment.`,
      );
    }

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

    await this.manager.writeCharacteristicWithResponseForDevice(
      this.device.id,
      MESHCORE_BLE.serviceUuid,
      MESHCORE_BLE.rxCharacteristicUuid,
      base64Command,
    );

    this.events.onStatus(`${label} sent. Waiting for ${expectedPacketLabel}.`);

    return responsePromise;
  }

  private waitForPacket(
    label: string,
    expectedPacketTypes: number[],
    expectedPacketLabel: string,
  ): Promise<MeshCoreLogItem> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingCommand?.label === label) {
          this.pendingCommand = null;
        }

        reject(
          new Error(`${label} timed out waiting for ${expectedPacketLabel}.`),
        );
      }, 5000);

      this.pendingCommand = {
        label,
        expectedPacketTypes,
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}