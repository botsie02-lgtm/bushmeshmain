import {BUSHMESH_MESHCORE_DEV_DATA_TYPE} from '../bushmesh/protocol';
import {
  BushMeshInboundMessage,
  decodeBushMeshMeshCoreFrame,
} from '../bushmesh/meshcoreBridge';
import {bushMeshRadioSession} from '../radio/BushMeshRadioSession';
import {meshCoreSelfInfoToRadioProfile} from '../radio/meshCoreRadioProfile';
import {
  buildAppStartCommand,
  buildDeviceQueryCommand,
  buildGetBatteryCommand,
  buildGetChannelCommand,
  buildSendChannelDataFloodCommand,
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
import {decodeMeshCoreBytes} from './meshcorePackets';
import {
  ParsedMeshCorePacket,
  parseMeshCorePacketFields,
} from './meshcoreParsers';
import {
  MeshCoreSelfInfo,
  parseMeshCoreSelfInfo,
} from './meshcoreSelfInfo';
import {SerialTaskQueue} from './serialTaskQueue';

const COMMAND_TIMEOUT_MS = 5_000;

export type NativeMeshCoreResponse = {
  packetType: number | null;
  label: string;
  bytes: number[];
  parsed: ParsedMeshCorePacket | null;
  selfInfo: MeshCoreSelfInfo | null;
  deviceInfo: MeshCoreDeviceInfo | null;
  channelData: MeshCoreChannelDataFrame | null;
  bushMeshMessage: BushMeshInboundMessage | null;
};

export type NativeMeshCoreSessionEvents = {
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
  onFrame?: (response: NativeMeshCoreResponse) => void;
  onBushMeshMessage?: (message: BushMeshInboundMessage) => void;
};

type PendingCommand = {
  label: string;
  expectedPacketTypes: number[];
  resolve: (response: NativeMeshCoreResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

/**
 * Core MeshCore companion session running over the Android-owned BLE transport.
 *
 * This is intentionally focused on the protocol surface Bushmesh needs for the
 * native handoff: startup identity/capabilities, radio status/channel reads and
 * binary Bushmesh datagrams. It shares the global Bushmesh radio-session owner
 * rules, so a stale native session cannot transmit after another radio claims
 * ownership.
 */
export class NativeMeshCoreSession {
  private readonly owner = {};
  private readonly commandQueue = new SerialTaskQueue();
  private pendingCommand: PendingCommand | null = null;
  private started = false;
  private lastDeviceInfo: MeshCoreDeviceInfo | null = null;

  constructor(
    private readonly transport: MeshCoreFrameTransport,
    private readonly events: NativeMeshCoreSessionEvents = {},
  ) {}

  async start(appName = 'BushMesh'): Promise<void> {
    if (this.started) {
      return;
    }

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
      this.events.onStatus?.('Native MeshCore session is ready.');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    this.commandQueue.cancelPending();
    this.rejectPending(new Error('Native MeshCore session stopped.'));
    this.lastDeviceInfo = null;
    bushMeshRadioSession.releaseTransport(this.owner);
    await this.transport.stop();
  }

  async sendAppStart(appName = 'BushMesh'): Promise<NativeMeshCoreResponse> {
    return this.enqueueCommand('CMD_APP_START', () =>
      this.executeCommand(
        'CMD_APP_START',
        buildAppStartCommand(appName),
        [0x05],
      ),
    );
  }

  async sendDeviceQuery(): Promise<NativeMeshCoreResponse> {
    const response = await this.enqueueCommand('CMD_DEVICE_QUERY', () =>
      this.executeCommand(
        'CMD_DEVICE_QUERY',
        buildDeviceQueryCommand(),
        [0x0d],
      ),
    );
    this.lastDeviceInfo = response.deviceInfo;
    return response;
  }

  async getBatteryStatus(): Promise<NativeMeshCoreResponse> {
    return this.enqueueCommand('CMD_GET_BATTERY', () =>
      this.executeCommand(
        'CMD_GET_BATTERY',
        buildGetBatteryCommand(),
        [0x0c],
      ),
    );
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

  async probeChannels(): Promise<NativeMeshCoreResponse[]> {
    const advertised = this.lastDeviceInfo?.maxChannels;
    const count =
      typeof advertised === 'number' && advertised > 0
        ? Math.min(advertised, 8)
        : 8;
    const responses: NativeMeshCoreResponse[] = [];

    for (let index = 0; index < count; index += 1) {
      responses.push(await this.getChannel(index));
    }
    return responses;
  }

  async sendChannelData(
    channelIndex: number,
    dataType: number,
    payload: Uint8Array,
  ): Promise<NativeMeshCoreResponse> {
    return this.enqueueCommand(`CMD_SEND_CHANNEL_DATA_${channelIndex}`, () =>
      this.executeCommand(
        `CMD_SEND_CHANNEL_DATA_${channelIndex}`,
        buildSendChannelDataFloodCommand(channelIndex, dataType, payload),
        [0x00],
      ),
    );
  }

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

  private enqueueCommand<T>(label: string, task: () => Promise<T>): Promise<T> {
    if (!this.started && label !== 'CMD_APP_START') {
      return Promise.reject(new Error('Native MeshCore session is not started.'));
    }

    return this.commandQueue.enqueue(label, async () => {
      await this.transport.ensureReady();
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
    } catch (error) {
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
        if (this.pendingCommand?.label === label) {
          this.pendingCommand = null;
        }
        reject(new Error(`${label} timed out waiting for a MeshCore response.`));
      }, COMMAND_TIMEOUT_MS);

      this.pendingCommand = {
        label,
        expectedPacketTypes,
        resolve,
        reject,
        timeout,
      };
    });
  }

  private handleFrame(bytes: number[]): void {
    const decoded = decodeMeshCoreBytes(bytes);
    let parsed: ParsedMeshCorePacket | null = null;
    let selfInfo: MeshCoreSelfInfo | null = null;
    let deviceInfo: MeshCoreDeviceInfo | null = null;
    let channelData: MeshCoreChannelDataFrame | null = null;
    let bushMeshMessage: BushMeshInboundMessage | null = null;

    try {
      parsed = parseMeshCorePacketFields(bytes);
      selfInfo = parseMeshCoreSelfInfo(bytes);
      deviceInfo = parseMeshCoreDeviceInfo(bytes);

      if (decoded.packetType === 0x1b) {
        channelData = parseMeshCoreChannelDataFrame(bytes);
        if (channelData) {
          bushMeshMessage = decodeBushMeshMeshCoreFrame(channelData);
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
      bushMeshRadioSession.setIdentityForOwner(
        this.owner,
        selfInfo.bushMeshIdentityRef,
      );
      bushMeshRadioSession.setRadioProfileForOwner(
        this.owner,
        meshCoreSelfInfoToRadioProfile(selfInfo),
      );
    }

    if (deviceInfo) {
      this.lastDeviceInfo = deviceInfo;
    }

    const response: NativeMeshCoreResponse = {
      packetType: decoded.packetType,
      label: decoded.label,
      bytes: [...bytes],
      parsed,
      selfInfo,
      deviceInfo,
      channelData,
      bushMeshMessage,
    };

    this.events.onFrame?.(response);
    if (bushMeshMessage) {
      this.events.onBushMeshMessage?.(bushMeshMessage);
    }

    if (decoded.packetType === 0x01) {
      const code = bytes[1];
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
    pending.resolve(response);
  }

  private rejectPending(error: Error): void {
    const pending = this.pendingCommand;
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingCommand = null;
    pending.reject(error);
  }
}
