import {
  BushMeshFileContentType,
  BushMeshFileFrameType,
  BushMeshFileReceiveProgress,
  BushMeshFileReceiver,
  BushMeshFileSender,
  BushMeshFileSendProgress,
  decodeFileAck,
  decodeFileChunk,
  decodeFileEnd,
  decodeFileResumeRequest,
  decodeFileStart,
  prepareFileTransfer,
} from '../protocol';

const DEFAULT_FILE_BURST_CHUNKS = 8;

export type BushMeshIncomingFile = {
  transferId: number;
  fileName?: string;
  contentType: number;
  data: number[];
};

export type BushMeshFileManagerResult = {
  transferId: number;
  event:
    | 'started'
    | 'chunk'
    | 'ack'
    | 'resume-request'
    | 'complete'
    | 'end-waiting-for-chunks';
  responseFrames: number[][];
  progress?: BushMeshFileReceiveProgress | BushMeshFileSendProgress;
  completedFile?: BushMeshIncomingFile;
};

type IncomingSession = {
  receiver: BushMeshFileReceiver;
  fileName?: string;
  contentType: number;
};

type OutgoingSession = {
  sender: BushMeshFileSender;
  startSent: boolean;
  endSent: boolean;
};

export class BushMeshFileTransferManager {
  private readonly incoming = new Map<number, IncomingSession>();
  private readonly outgoing = new Map<number, OutgoingSession>();

  createOutgoing(
    transferId: number,
    data: number[],
    options?: {
      chunkSize?: number;
      contentType?: BushMeshFileContentType | number;
      fileName?: string;
    },
  ): BushMeshFileSendProgress {
    const prepared = prepareFileTransfer(transferId, data, options);
    const sender = new BushMeshFileSender(prepared);
    this.outgoing.set(transferId, {
      sender,
      startSent: false,
      endSent: false,
    });
    return sender.progress();
  }

  outgoingFrames(
    transferId: number,
    maxChunkFrames = DEFAULT_FILE_BURST_CHUNKS,
  ): number[][] {
    const session = this.requireOutgoing(transferId);
    const frames: number[][] = [];

    if (!session.startSent) {
      frames.push(session.sender.startFrame());
      session.startSent = true;
    }

    for (const pending of session.sender.pendingFrames(maxChunkFrames)) {
      frames.push(pending.frame);
    }

    const progress = session.sender.progress();
    if (progress.complete && !session.endSent) {
      frames.push(session.sender.endFrame());
      session.endSent = true;
    }

    return frames;
  }

  outgoingProgress(transferId: number): BushMeshFileSendProgress | null {
    return this.outgoing.get(transferId)?.sender.progress() ?? null;
  }

  incomingProgress(transferId: number): BushMeshFileReceiveProgress | null {
    const session = this.incoming.get(transferId);
    return session ? session.receiver.progress() : null;
  }

  activeIncomingTransferIds(): number[] {
    return Array.from(this.incoming.keys()).sort((a, b) => a - b);
  }

  activeOutgoingTransferIds(): number[] {
    return Array.from(this.outgoing.keys()).sort((a, b) => a - b);
  }

  activeTransferCount(): number {
    return this.incoming.size + this.outgoing.size;
  }

  acceptFrame(frame: number[]): BushMeshFileManagerResult {
    const frameType = frame[0];

    switch (frameType) {
      case BushMeshFileFrameType.Start:
        return this.acceptStart(frame);
      case BushMeshFileFrameType.Chunk:
        return this.acceptChunk(frame);
      case BushMeshFileFrameType.Ack:
        return this.acceptAck(frame);
      case BushMeshFileFrameType.ResumeRequest:
        return this.acceptResume(frame);
      case BushMeshFileFrameType.End:
        return this.acceptEnd(frame);
      default:
        throw new Error(`Unsupported BushMesh file frame type ${frameType}.`);
    }
  }

  cancel(transferId: number): boolean {
    const incoming = this.incoming.delete(transferId);
    const outgoing = this.outgoing.delete(transferId);
    return incoming || outgoing;
  }

  clear(): void {
    this.incoming.clear();
    this.outgoing.clear();
  }

  private acceptStart(frame: number[]): BushMeshFileManagerResult {
    const metadata = decodeFileStart(frame);
    const receiver = new BushMeshFileReceiver();
    receiver.begin(frame);
    this.incoming.set(metadata.transferId, {
      receiver,
      fileName: metadata.fileName,
      contentType: metadata.contentType,
    });

    return {
      transferId: metadata.transferId,
      event: 'started',
      responseFrames: [],
      progress: receiver.progress(),
    };
  }

  private acceptChunk(frame: number[]): BushMeshFileManagerResult {
    const chunk = decodeFileChunk(frame);
    const session = this.requireIncoming(chunk.transferId);
    const progress = session.receiver.acceptChunk(frame);
    const shouldAck =
      progress.complete ||
      progress.receivedChunks % DEFAULT_FILE_BURST_CHUNKS === 0;
    const baseChunkIndex = Math.floor(chunk.chunkIndex / 64) * 64;

    return {
      transferId: chunk.transferId,
      event: 'chunk',
      responseFrames: shouldAck
        ? [session.receiver.buildAckWindow(baseChunkIndex)]
        : [],
      progress,
    };
  }

  private acceptAck(frame: number[]): BushMeshFileManagerResult {
    const ack = decodeFileAck(frame);
    const session = this.requireOutgoing(ack.transferId);
    const retryFrames = session.sender.framesForAck(frame).map(item => item.frame);
    const progress = session.sender.progress();
    const responseFrames = [...retryFrames];

    if (progress.complete && !session.endSent) {
      responseFrames.push(session.sender.endFrame());
      session.endSent = true;
    } else if (retryFrames.length === 0) {
      // A clean ACK closes the current burst. Advance to the next unsent window.
      // When an ACK reports loss, retry only the missing chunks first; advancing
      // at the same time would cause duplicate in-flight chunks and waste airtime.
      for (const pending of session.sender.pendingFrames(DEFAULT_FILE_BURST_CHUNKS)) {
        responseFrames.push(pending.frame);
      }
    }

    return {
      transferId: ack.transferId,
      event: 'ack',
      responseFrames,
      progress,
    };
  }

  private acceptResume(frame: number[]): BushMeshFileManagerResult {
    const request = decodeFileResumeRequest(frame);
    const session = this.requireOutgoing(request.transferId);
    const responseFrames = session.sender
      .framesForResumeRequest(frame, 16)
      .map(item => item.frame);

    return {
      transferId: request.transferId,
      event: 'resume-request',
      responseFrames,
      progress: session.sender.progress(),
    };
  }

  private acceptEnd(frame: number[]): BushMeshFileManagerResult {
    const end = decodeFileEnd(frame);
    const session = this.requireIncoming(end.transferId);
    const progress = session.receiver.progress();

    if (!progress.complete) {
      return {
        transferId: end.transferId,
        event: 'end-waiting-for-chunks',
        responseFrames: [session.receiver.buildResumeRequest()],
        progress,
      };
    }

    const data = session.receiver.finish(frame);
    const completedFile: BushMeshIncomingFile = {
      transferId: end.transferId,
      fileName: session.fileName,
      contentType: session.contentType,
      data,
    };
    this.incoming.delete(end.transferId);

    return {
      transferId: end.transferId,
      event: 'complete',
      responseFrames: [],
      progress,
      completedFile,
    };
  }

  private requireIncoming(transferId: number): IncomingSession {
    const session = this.incoming.get(transferId);
    if (!session) {
      throw new Error(`Unknown incoming BushMesh file transfer ${transferId}.`);
    }
    return session;
  }

  private requireOutgoing(transferId: number): OutgoingSession {
    const session = this.outgoing.get(transferId);
    if (!session) {
      throw new Error(`Unknown outgoing BushMesh file transfer ${transferId}.`);
    }
    return session;
  }
}
