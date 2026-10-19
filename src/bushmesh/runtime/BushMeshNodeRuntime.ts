import {
  BushMeshFileContentType,
  BushMeshNodeHello,
  BushMeshSyncFrameKind,
  BushMeshTypedPacket,
  CompactLocation,
  encodeBushMeshFileWire,
  encodeBushMeshNodeHelloWire,
  encodeBushMeshTextCarrier,
} from '../protocol';
import {
  BushMeshNetworkRuntime,
  BushMeshNetworkRuntimeEvents,
  BushMeshRuntimeReceivedMessage,
  BushMeshRuntimeSendResult,
  BushMeshRuntimeTransport,
} from './BushMeshNetworkRuntime';
import {
  BushMeshCommandResponder,
  BushMeshLocationSnapshot,
} from './BushMeshCommandResponder';
import {renderBushMeshReceivedMessage} from './BushMeshDisplay';
import {
  BushMeshFileManagerResult,
  BushMeshFileTransferManager,
  BushMeshIncomingFile,
} from './BushMeshFileTransferManager';
import {createBushMeshNodeHelloFromPublicKey} from './BushMeshIdentity';
import {subscribeMeshCorePublicKey} from './BushMeshIdentityHub';
import {BushMeshPeerRegistry} from './BushMeshPeerRegistry';
import {BushMeshSyncManager} from './BushMeshSyncManager';

export type BushMeshNodeRuntimeEvents = BushMeshNetworkRuntimeEvents & {
  onPeerHello?: (hello: BushMeshNodeHello) => void;
  onTypedPacket?: (packet: BushMeshTypedPacket, channelIndex: number) => void;
  onAutomaticResponse?: (kind: string, channelIndex: number) => void;
  onFileProgress?: (result: BushMeshFileManagerResult, channelIndex: number) => void;
  onFileComplete?: (file: BushMeshIncomingFile, channelIndex: number) => void;
};

export class BushMeshNodeRuntime {
  readonly network: BushMeshNetworkRuntime;
  readonly sync = new BushMeshSyncManager();
  readonly files = new BushMeshFileTransferManager();

  private peerRegistryState: BushMeshPeerRegistry | null = null;
  private responder: BushMeshCommandResponder | null = null;
  private localHelloState: BushMeshNodeHello | null = null;
  private latestLocation: BushMeshLocationSnapshot | null = null;
  private identityUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly transport: BushMeshRuntimeTransport,
    private readonly events: BushMeshNodeRuntimeEvents = {},
    options?: {
      messageIdSeed?: number;
      reassemblyTimeoutMs?: number;
      retryPollMs?: number;
      autoAckFragments?: boolean;
      allowExperimentalBinary?: boolean;
    },
  ) {
    this.allowExperimentalBinary = options?.allowExperimentalBinary ?? false;
    this.network = new BushMeshNetworkRuntime(
      transport,
      {
        onStatus: events.onStatus,
        onError: events.onError,
        onAck: events.onAck,
        onStats: events.onStats,
        onMessage: message => {
          void this.handleReceivedMessage(message);
        },
      },
      options,
    );
  }

  private readonly allowExperimentalBinary: boolean;

  start(): void {
    if (!this.identityUnsubscribe) {
      this.identityUnsubscribe = subscribeMeshCorePublicKey(publicKey => {
        const hello = createBushMeshNodeHelloFromPublicKey(publicKey);

        if (hello.nodeId !== this.localHelloState?.nodeId) {
          this.configureLocalNode(hello);
        }
      });
    }

    this.network.start();
  }

  stop(): void {
    this.network.stop();
    this.identityUnsubscribe?.();
    this.identityUnsubscribe = null;
  }

  isRunning(): boolean {
    return this.network.isRunning();
  }

  configureLocalNode(hello: BushMeshNodeHello): void {
    if (
      this.localHelloState?.nodeId === hello.nodeId &&
      this.localHelloState.capabilities === hello.capabilities &&
      this.localHelloState.dictionaryVersion === hello.dictionaryVersion
    ) {
      this.localHelloState = {...hello};
      return;
    }

    this.localHelloState = {...hello};
    this.peerRegistryState = new BushMeshPeerRegistry(hello, {
      allowExperimentalBinary: this.allowExperimentalBinary,
    });
    this.responder = new BushMeshCommandResponder({
      localHello: () => ({...this.requireLocalHello()}),
      currentLocation: () =>
        this.latestLocation
          ? {
              capturedAtMs: this.latestLocation.capturedAtMs,
              location: {...this.latestLocation.location},
            }
          : null,
      syncManager: this.sync,
      nextMessageId: () => this.network.nextMessageId(),
    });
    this.events.onStatus?.(
      `BushMesh local node configured as ${hello.nodeId.toString(16).padStart(8, '0')}.`,
    );
  }

  localHello(): BushMeshNodeHello | null {
    return this.localHelloState ? {...this.localHelloState} : null;
  }

  peers(): BushMeshPeerRegistry | null {
    return this.peerRegistryState;
  }

  setLocation(location: CompactLocation, capturedAtMs = Date.now()): void {
    this.latestLocation = {
      location: {...location},
      capturedAtMs,
    };
  }

  clearLocation(): void {
    this.latestLocation = null;
  }

  async sendText(
    channelIndex: number,
    text: string,
    options?: {
      peerNodeId?: number;
      storeAndForward?: boolean;
      ttlHops?: number;
      ackRequested?: boolean;
    },
  ): Promise<BushMeshRuntimeSendResult> {
    const peerPolicy =
      options?.peerNodeId !== undefined
        ? this.peerRegistryState?.peerPolicy(options.peerNodeId) ?? undefined
        : undefined;

    return this.network.sendText(channelIndex, text, {
      peerPolicy,
      storeAndForward: options?.storeAndForward ?? true,
      ttlHops: options?.ttlHops ?? 4,
      ackRequested: options?.ackRequested ?? true,
      semantic: true,
    });
  }

  async broadcastNodeHello(channelIndex: number): Promise<void> {
    const hello = this.requireLocalHello();
    const wireBytes = encodeBushMeshNodeHelloWire(
      hello,
      this.network.nextMessageId(),
    );
    await this.sendResponseWire(channelIndex, wireBytes);
  }

  async startFileTransfer(
    channelIndex: number,
    data: number[],
    options?: {
      transferId?: number;
      chunkSize?: number;
      contentType?: BushMeshFileContentType | number;
      fileName?: string;
      initialChunkFrames?: number;
    },
  ): Promise<number> {
    const transferId = options?.transferId ?? this.network.nextMessageId();
    this.files.createOutgoing(transferId, data, {
      chunkSize: options?.chunkSize,
      contentType: options?.contentType,
      fileName: options?.fileName,
    });
    await this.sendFileBurst(
      channelIndex,
      transferId,
      options?.initialChunkFrames ?? 8,
    );
    return transferId;
  }

  async sendFileBurst(
    channelIndex: number,
    transferId: number,
    maxChunkFrames = 8,
  ): Promise<number> {
    const fileFrames = this.files.outgoingFrames(transferId, maxChunkFrames);

    for (const fileFrame of fileFrames) {
      const wireBytes = encodeBushMeshFileWire(
        fileFrame,
        this.network.nextMessageId(),
      );
      await this.sendResponseWire(channelIndex, wireBytes);
    }

    return fileFrames.length;
  }

  private async handleReceivedMessage(
    message: BushMeshRuntimeReceivedMessage,
  ): Promise<void> {
    const {typed, channelIndex} = message;

    if (typed.kind === 'device-info' && this.peerRegistryState) {
      const localNodeId = this.localHelloState?.nodeId;
      if (typed.value.nodeId !== localNodeId) {
        this.peerRegistryState.upsertHello(typed.value);
        this.events.onPeerHello?.({...typed.value});
      }
    }

    if (
      typed.kind === 'sync' &&
      typed.value.kind === BushMeshSyncFrameKind.Summary
    ) {
      this.sync.acceptRemoteSummary(typed.value);
    }

    if (typed.kind === 'file') {
      await this.handleFileFrame(typed.value, channelIndex);
    }

    if (!message.decoded.renderedText) {
      const rendered = renderBushMeshReceivedMessage(message);
      if (rendered) {
        message.decoded.renderedText = rendered;
      }
    }

    this.events.onTypedPacket?.(typed, channelIndex);
    this.events.onMessage?.(message);

    if (!this.responder) {
      return;
    }

    const responses = this.responder.respond(typed);

    for (const response of responses) {
      try {
        await this.sendResponseWire(channelIndex, response.wireBytes);
        this.events.onAutomaticResponse?.(response.kind, channelIndex);
      } catch (error) {
        this.events.onError?.(
          error instanceof Error
            ? `BushMesh automatic ${response.kind} response failed: ${error.message}`
            : `BushMesh automatic ${response.kind} response failed.`,
        );
      }
    }
  }

  private async handleFileFrame(
    fileFrame: number[],
    channelIndex: number,
  ): Promise<void> {
    try {
      const result = this.files.acceptFrame(fileFrame);
      this.events.onFileProgress?.(result, channelIndex);

      for (const responseFrame of result.responseFrames) {
        const wireBytes = encodeBushMeshFileWire(
          responseFrame,
          this.network.nextMessageId(),
        );
        await this.sendResponseWire(channelIndex, wireBytes);
      }

      if (result.completedFile) {
        this.events.onFileComplete?.(result.completedFile, channelIndex);
      }
    } catch (error) {
      this.events.onError?.(
        error instanceof Error
          ? `BushMesh file transfer failed: ${error.message}`
          : 'BushMesh file transfer failed.',
      );
    }
  }

  private async sendResponseWire(
    channelIndex: number,
    wireBytes: number[],
  ): Promise<void> {
    await this.transport.sendTextChannelMessage(
      channelIndex,
      encodeBushMeshTextCarrier(wireBytes),
    );
  }

  private requireLocalHello(): BushMeshNodeHello {
    if (!this.localHelloState) {
      throw new Error('BushMesh local node identity has not been configured.');
    }

    return this.localHelloState;
  }
}
