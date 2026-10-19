import {
  BushMeshFileAck,
  PreparedBushMeshFileTransfer,
  decodeFileAck,
  decodeFileResumeRequest,
} from './fileTransfer';

export type BushMeshFileSendProgress = {
  transferId: number;
  chunkCount: number;
  acknowledgedChunks: number;
  pendingChunkIndexes: number[];
  complete: boolean;
};

export class BushMeshFileSender {
  private readonly acknowledged = new Set<number>();

  constructor(private readonly transfer: PreparedBushMeshFileTransfer) {}

  startFrame(): number[] {
    return [...this.transfer.startFrame];
  }

  endFrame(): number[] {
    return [...this.transfer.endFrame];
  }

  chunkFrame(chunkIndex: number): number[] | null {
    const frame = this.transfer.chunkFrames[chunkIndex];
    return frame ? [...frame] : null;
  }

  applyAckFrame(ackFrame: number[]): BushMeshFileAck {
    const ack = decodeFileAck(ackFrame);

    if (ack.transferId !== this.transfer.metadata.transferId) {
      throw new Error('FILE_ACK belongs to a different transfer.');
    }

    for (const index of ack.receivedChunkIndexes) {
      if (index < this.transfer.chunkFrames.length) {
        this.acknowledged.add(index);
      }
    }

    return ack;
  }

  pendingFrames(maxFrames?: number): Array<{chunkIndex: number; frame: number[]}> {
    const pending: Array<{chunkIndex: number; frame: number[]}> = [];

    for (let index = 0; index < this.transfer.chunkFrames.length; index += 1) {
      if (this.acknowledged.has(index)) {
        continue;
      }

      pending.push({chunkIndex: index, frame: [...this.transfer.chunkFrames[index]]});

      if (maxFrames !== undefined && pending.length >= maxFrames) {
        break;
      }
    }

    return pending;
  }

  framesForAck(ackFrame: number[]): Array<{chunkIndex: number; frame: number[]}> {
    const ack = this.applyAckFrame(ackFrame);
    return ack.missingChunkIndexes
      .filter(index => index < this.transfer.chunkFrames.length)
      .map(index => ({
        chunkIndex: index,
        frame: [...this.transfer.chunkFrames[index]],
      }));
  }

  framesForResumeRequest(
    resumeFrame: number[],
    maxFrames?: number,
  ): Array<{chunkIndex: number; frame: number[]}> {
    const request = decodeFileResumeRequest(resumeFrame);

    if (request.transferId !== this.transfer.metadata.transferId) {
      throw new Error('FILE_RESUME_REQUEST belongs to a different transfer.');
    }

    const frames: Array<{chunkIndex: number; frame: number[]}> = [];

    for (
      let index = request.nextMissingChunkIndex;
      index < this.transfer.chunkFrames.length;
      index += 1
    ) {
      if (this.acknowledged.has(index)) {
        continue;
      }

      frames.push({chunkIndex: index, frame: [...this.transfer.chunkFrames[index]]});

      if (maxFrames !== undefined && frames.length >= maxFrames) {
        break;
      }
    }

    return frames;
  }

  progress(): BushMeshFileSendProgress {
    const pendingChunkIndexes: number[] = [];

    for (let index = 0; index < this.transfer.chunkFrames.length; index += 1) {
      if (!this.acknowledged.has(index)) {
        pendingChunkIndexes.push(index);
      }
    }

    return {
      transferId: this.transfer.metadata.transferId,
      chunkCount: this.transfer.chunkFrames.length,
      acknowledgedChunks: this.acknowledged.size,
      pendingChunkIndexes,
      complete: pendingChunkIndexes.length === 0,
    };
  }

  resetAcknowledgements(): void {
    this.acknowledged.clear();
  }
}
