import {Buffer} from 'buffer';

import {
  assertBytes,
  assertIntegerInRange,
  decodeVarUint,
  encodeVarUint,
} from './codec';
import {crc16Ccitt} from './fragmentation';

export enum BushMeshFileFrameType {
  Start = 0x01,
  Chunk = 0x02,
  Ack = 0x03,
  End = 0x04,
  ResumeRequest = 0x05,
}

export enum BushMeshFileContentType {
  Text = 0x01,
  Json = 0x02,
  Image = 0x03,
  GpsRoute = 0x04,
  Configuration = 0x05,
  ContactCard = 0x06,
  FirmwareMetadata = 0x07,
  Binary = 0xff,
}

export type BushMeshFileStart = {
  transferId: number;
  fileSize: number;
  chunkSize: number;
  contentType: BushMeshFileContentType | number;
  fileName?: string;
  checksum32?: number;
};

export type BushMeshFileChunk = {
  transferId: number;
  chunkIndex: number;
  data: number[];
  crc16: number;
};

export type BushMeshFileAck = {
  transferId: number;
  baseChunkIndex: number;
  bitCount: number;
  receivedChunkIndexes: number[];
  missingChunkIndexes: number[];
};

export type BushMeshFileEnd = {
  transferId: number;
  checksum32: number;
};

export type BushMeshFileResumeRequest = {
  transferId: number;
  nextMissingChunkIndex: number;
};

function writeUInt32LE(value: number): number[] {
  assertIntegerInRange(value, 0, 0xffffffff, 'UInt32 value');
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function readUInt32LE(bytes: number[], offset: number): number {
  if (bytes.length < offset + 4) {
    throw new Error('Truncated UInt32.');
  }

  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

export function crc32Ieee(bytes: number[]): number {
  assertBytes(bytes);
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

export function encodeFileStart(start: BushMeshFileStart): number[] {
  assertIntegerInRange(start.transferId, 0, 0xffffffff, 'Transfer ID');
  assertIntegerInRange(start.fileSize, 0, 0xffffffff, 'File size');
  assertIntegerInRange(start.chunkSize, 1, 255, 'Chunk size');
  assertIntegerInRange(start.contentType, 0, 255, 'File content type');

  const nameBytes = start.fileName
    ? Array.from(Buffer.from(start.fileName, 'utf8'))
    : [];

  if (nameBytes.length > 80) {
    throw new Error('File name is too long for Bushmesh metadata.');
  }

  if (start.checksum32 !== undefined) {
    assertIntegerInRange(start.checksum32, 0, 0xffffffff, 'File checksum');
  }

  const flags = (nameBytes.length > 0 ? 0x01 : 0) | (start.checksum32 !== undefined ? 0x02 : 0);
  const bytes = [
    BushMeshFileFrameType.Start,
    ...encodeVarUint(start.transferId),
    ...encodeVarUint(start.fileSize),
    ...encodeVarUint(start.chunkSize),
    start.contentType,
    flags,
  ];

  if (nameBytes.length > 0) {
    bytes.push(...encodeVarUint(nameBytes.length), ...nameBytes);
  }

  if (start.checksum32 !== undefined) {
    bytes.push(...writeUInt32LE(start.checksum32));
  }

  return bytes;
}

export function decodeFileStart(bytes: number[]): BushMeshFileStart {
  assertBytes(bytes);

  if (bytes[0] !== BushMeshFileFrameType.Start) {
    throw new Error('Not a FILE_START frame.');
  }

  const transferId = decodeVarUint(bytes, 1);
  const fileSize = decodeVarUint(bytes, transferId.nextOffset);
  const chunkSize = decodeVarUint(bytes, fileSize.nextOffset);
  let cursor = chunkSize.nextOffset;
  const contentType = bytes[cursor];
  const flags = bytes[cursor + 1];

  if (contentType === undefined || flags === undefined) {
    throw new Error('FILE_START metadata is truncated.');
  }

  cursor += 2;
  let fileName: string | undefined;
  let checksum32: number | undefined;

  if ((flags & 0x01) !== 0) {
    const nameLength = decodeVarUint(bytes, cursor);
    cursor = nameLength.nextOffset;
    const end = cursor + nameLength.value;

    if (end > bytes.length || nameLength.value > 80) {
      throw new Error('FILE_START name is truncated or too long.');
    }

    fileName = Buffer.from(bytes.slice(cursor, end)).toString('utf8');
    cursor = end;
  }

  if ((flags & 0x02) !== 0) {
    checksum32 = readUInt32LE(bytes, cursor);
    cursor += 4;
  }

  if (cursor !== bytes.length) {
    throw new Error('Unexpected bytes after FILE_START.');
  }

  if (chunkSize.value < 1 || chunkSize.value > 255) {
    throw new Error('FILE_START chunk size is invalid.');
  }

  return {
    transferId: transferId.value,
    fileSize: fileSize.value,
    chunkSize: chunkSize.value,
    contentType,
    fileName,
    checksum32,
  };
}

export function encodeFileChunk(
  transferId: number,
  chunkIndex: number,
  data: number[],
): number[] {
  assertIntegerInRange(transferId, 0, 0xffffffff, 'Transfer ID');
  assertIntegerInRange(chunkIndex, 0, 0xffffffff, 'Chunk index');
  assertBytes(data, 'file chunk');

  if (data.length > 255) {
    throw new Error('File chunk data cannot exceed 255 bytes.');
  }

  const crc16 = crc16Ccitt(data);
  return [
    BushMeshFileFrameType.Chunk,
    ...encodeVarUint(transferId),
    ...encodeVarUint(chunkIndex),
    crc16 & 0xff,
    (crc16 >> 8) & 0xff,
    ...data,
  ];
}

export function decodeFileChunk(bytes: number[]): BushMeshFileChunk {
  assertBytes(bytes);

  if (bytes[0] !== BushMeshFileFrameType.Chunk) {
    throw new Error('Not a FILE_CHUNK frame.');
  }

  const transferId = decodeVarUint(bytes, 1);
  const chunkIndex = decodeVarUint(bytes, transferId.nextOffset);
  const crcOffset = chunkIndex.nextOffset;

  if (bytes.length < crcOffset + 2) {
    throw new Error('FILE_CHUNK CRC is truncated.');
  }

  const crc16 = bytes[crcOffset] | (bytes[crcOffset + 1] << 8);
  const data = bytes.slice(crcOffset + 2);

  if (crc16Ccitt(data) !== crc16) {
    throw new Error('FILE_CHUNK CRC mismatch.');
  }

  return {
    transferId: transferId.value,
    chunkIndex: chunkIndex.value,
    data,
    crc16,
  };
}

export function encodeFileAck(
  transferId: number,
  baseChunkIndex: number,
  bitCount: number,
  receivedChunkIndexes: number[],
): number[] {
  assertIntegerInRange(transferId, 0, 0xffffffff, 'Transfer ID');
  assertIntegerInRange(baseChunkIndex, 0, 0xffffffff, 'Base chunk index');
  assertIntegerInRange(bitCount, 1, 64, 'ACK bit count');
  const bitmap = new Array(Math.ceil(bitCount / 8)).fill(0);

  for (const index of receivedChunkIndexes) {
    if (index < baseChunkIndex || index >= baseChunkIndex + bitCount) {
      continue;
    }

    const relative = index - baseChunkIndex;
    bitmap[Math.floor(relative / 8)] |= 1 << (relative % 8);
  }

  return [
    BushMeshFileFrameType.Ack,
    ...encodeVarUint(transferId),
    ...encodeVarUint(baseChunkIndex),
    bitCount,
    ...bitmap,
  ];
}

export function decodeFileAck(bytes: number[]): BushMeshFileAck {
  assertBytes(bytes);

  if (bytes[0] !== BushMeshFileFrameType.Ack) {
    throw new Error('Not a FILE_ACK frame.');
  }

  const transferId = decodeVarUint(bytes, 1);
  const base = decodeVarUint(bytes, transferId.nextOffset);
  const bitCount = bytes[base.nextOffset];

  if (bitCount === undefined || bitCount < 1 || bitCount > 64) {
    throw new Error('FILE_ACK bit count is invalid.');
  }

  const bitmap = bytes.slice(base.nextOffset + 1);
  const expectedLength = Math.ceil(bitCount / 8);

  if (bitmap.length !== expectedLength) {
    throw new Error('FILE_ACK bitmap length is invalid.');
  }

  const receivedChunkIndexes: number[] = [];
  const missingChunkIndexes: number[] = [];

  for (let relative = 0; relative < bitCount; relative += 1) {
    const index = base.value + relative;
    const received =
      (bitmap[Math.floor(relative / 8)] & (1 << (relative % 8))) !== 0;
    (received ? receivedChunkIndexes : missingChunkIndexes).push(index);
  }

  return {
    transferId: transferId.value,
    baseChunkIndex: base.value,
    bitCount,
    receivedChunkIndexes,
    missingChunkIndexes,
  };
}

export function encodeFileEnd(end: BushMeshFileEnd): number[] {
  assertIntegerInRange(end.transferId, 0, 0xffffffff, 'Transfer ID');
  return [
    BushMeshFileFrameType.End,
    ...encodeVarUint(end.transferId),
    ...writeUInt32LE(end.checksum32),
  ];
}

export function decodeFileEnd(bytes: number[]): BushMeshFileEnd {
  assertBytes(bytes);

  if (bytes[0] !== BushMeshFileFrameType.End) {
    throw new Error('Not a FILE_END frame.');
  }

  const transferId = decodeVarUint(bytes, 1);
  const checksum32 = readUInt32LE(bytes, transferId.nextOffset);

  if (transferId.nextOffset + 4 !== bytes.length) {
    throw new Error('Unexpected bytes after FILE_END.');
  }

  return {transferId: transferId.value, checksum32};
}

export function encodeFileResumeRequest(
  request: BushMeshFileResumeRequest,
): number[] {
  return [
    BushMeshFileFrameType.ResumeRequest,
    ...encodeVarUint(request.transferId),
    ...encodeVarUint(request.nextMissingChunkIndex),
  ];
}

export function decodeFileResumeRequest(
  bytes: number[],
): BushMeshFileResumeRequest {
  assertBytes(bytes);

  if (bytes[0] !== BushMeshFileFrameType.ResumeRequest) {
    throw new Error('Not a FILE_RESUME_REQUEST frame.');
  }

  const transferId = decodeVarUint(bytes, 1);
  const nextMissing = decodeVarUint(bytes, transferId.nextOffset);

  if (nextMissing.nextOffset !== bytes.length) {
    throw new Error('Unexpected bytes after FILE_RESUME_REQUEST.');
  }

  return {
    transferId: transferId.value,
    nextMissingChunkIndex: nextMissing.value,
  };
}

export type PreparedBushMeshFileTransfer = {
  metadata: BushMeshFileStart;
  startFrame: number[];
  chunkFrames: number[][];
  endFrame: number[];
};

export function prepareFileTransfer(
  transferId: number,
  data: number[],
  options?: {
    chunkSize?: number;
    contentType?: BushMeshFileContentType | number;
    fileName?: string;
  },
): PreparedBushMeshFileTransfer {
  assertBytes(data, 'file data');
  const chunkSize = options?.chunkSize ?? 40;
  assertIntegerInRange(chunkSize, 1, 255, 'Chunk size');
  const checksum32 = crc32Ieee(data);
  const metadata: BushMeshFileStart = {
    transferId,
    fileSize: data.length,
    chunkSize,
    contentType: options?.contentType ?? BushMeshFileContentType.Binary,
    fileName: options?.fileName,
    checksum32,
  };
  const chunkFrames: number[][] = [];

  for (let offset = 0, index = 0; offset < data.length; offset += chunkSize, index += 1) {
    chunkFrames.push(
      encodeFileChunk(transferId, index, data.slice(offset, offset + chunkSize)),
    );
  }

  return {
    metadata,
    startFrame: encodeFileStart(metadata),
    chunkFrames,
    endFrame: encodeFileEnd({transferId, checksum32}),
  };
}

export type BushMeshFileReceiveProgress = {
  transferId: number;
  chunkCount: number;
  receivedChunks: number;
  receivedBytes: number;
  missingChunkIndexes: number[];
  complete: boolean;
};

export class BushMeshFileReceiver {
  private metadata: BushMeshFileStart | null = null;
  private readonly chunks = new Map<number, number[]>();

  begin(startFrame: number[]): BushMeshFileStart {
    const metadata = decodeFileStart(startFrame);
    this.metadata = metadata;
    this.chunks.clear();
    return {...metadata};
  }

  acceptChunk(chunkFrame: number[]): BushMeshFileReceiveProgress {
    const metadata = this.requireMetadata();
    const chunk = decodeFileChunk(chunkFrame);

    if (chunk.transferId !== metadata.transferId) {
      throw new Error('File chunk belongs to a different transfer.');
    }

    const chunkCount = this.chunkCount(metadata);

    if (chunk.chunkIndex >= chunkCount) {
      throw new Error('File chunk index is outside the transfer range.');
    }

    const isLast = chunk.chunkIndex === chunkCount - 1;

    if (!isLast && chunk.data.length !== metadata.chunkSize) {
      throw new Error('Non-final file chunk has unexpected length.');
    }

    if (chunk.data.length > metadata.chunkSize) {
      throw new Error('File chunk exceeds announced chunk size.');
    }

    if (!this.chunks.has(chunk.chunkIndex)) {
      this.chunks.set(chunk.chunkIndex, [...chunk.data]);
    }

    return this.progress();
  }

  progress(): BushMeshFileReceiveProgress {
    const metadata = this.requireMetadata();
    const chunkCount = this.chunkCount(metadata);
    const missingChunkIndexes: number[] = [];
    let receivedBytes = 0;

    for (let index = 0; index < chunkCount; index += 1) {
      const chunk = this.chunks.get(index);

      if (chunk) {
        receivedBytes += chunk.length;
      } else {
        missingChunkIndexes.push(index);
      }
    }

    return {
      transferId: metadata.transferId,
      chunkCount,
      receivedChunks: this.chunks.size,
      receivedBytes,
      missingChunkIndexes,
      complete: missingChunkIndexes.length === 0,
    };
  }

  buildAckWindow(baseChunkIndex = 0, bitCount = 64): number[] {
    const metadata = this.requireMetadata();
    const chunkCount = this.chunkCount(metadata);

    if (baseChunkIndex >= chunkCount && chunkCount > 0) {
      throw new Error('File ACK window starts beyond final chunk.');
    }

    const actualBitCount = Math.max(
      1,
      Math.min(bitCount, 64, Math.max(1, chunkCount - baseChunkIndex)),
    );

    return encodeFileAck(
      metadata.transferId,
      baseChunkIndex,
      actualBitCount,
      Array.from(this.chunks.keys()),
    );
  }

  buildResumeRequest(): number[] {
    const progress = this.progress();
    const nextMissingChunkIndex = progress.missingChunkIndexes[0] ?? progress.chunkCount;
    return encodeFileResumeRequest({
      transferId: progress.transferId,
      nextMissingChunkIndex,
    });
  }

  finish(endFrame: number[]): number[] {
    const metadata = this.requireMetadata();
    const end = decodeFileEnd(endFrame);

    if (end.transferId !== metadata.transferId) {
      throw new Error('FILE_END belongs to a different transfer.');
    }

    const progress = this.progress();

    if (!progress.complete) {
      throw new Error('Cannot finish file transfer while chunks are missing.');
    }

    const data: number[] = [];

    for (let index = 0; index < progress.chunkCount; index += 1) {
      data.push(...(this.chunks.get(index) ?? []));
    }

    const exactData = data.slice(0, metadata.fileSize);

    if (exactData.length !== metadata.fileSize) {
      throw new Error('Reassembled file size does not match FILE_START.');
    }

    const checksum = crc32Ieee(exactData);

    if (checksum !== end.checksum32) {
      throw new Error('FILE_END checksum does not match reassembled file.');
    }

    if (metadata.checksum32 !== undefined && checksum !== metadata.checksum32) {
      throw new Error('FILE_START checksum does not match reassembled file.');
    }

    return exactData;
  }

  reset(): void {
    this.metadata = null;
    this.chunks.clear();
  }

  private chunkCount(metadata: BushMeshFileStart): number {
    return metadata.fileSize === 0
      ? 0
      : Math.ceil(metadata.fileSize / metadata.chunkSize);
  }

  private requireMetadata(): BushMeshFileStart {
    if (!this.metadata) {
      throw new Error('File receiver has not received FILE_START.');
    }

    return this.metadata;
  }
}
