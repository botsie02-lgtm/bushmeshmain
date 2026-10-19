import {assertBytes, assertIntegerInRange} from './codec';

export type BushMeshXorParityGroup = {
  groupIndex: number;
  startChunkIndex: number;
  chunkCount: number;
  chunkLengths: number[];
  parityBytes: number[];
};

export function createXorParityGroups(
  chunks: number[][],
  groupSize = 4,
): BushMeshXorParityGroup[] {
  assertIntegerInRange(groupSize, 2, 16, 'Erasure group size');
  chunks.forEach((chunk, index) => assertBytes(chunk, `erasure chunk ${index}`));

  const groups: BushMeshXorParityGroup[] = [];
  for (let start = 0; start < chunks.length; start += groupSize) {
    const groupChunks = chunks.slice(start, start + groupSize);
    if (groupChunks.length < 2) {
      break;
    }

    const maxLength = Math.max(...groupChunks.map(chunk => chunk.length));
    const parityBytes = new Array(maxLength).fill(0);
    for (const chunk of groupChunks) {
      for (let index = 0; index < maxLength; index += 1) {
        parityBytes[index] ^= chunk[index] ?? 0;
      }
    }

    groups.push({
      groupIndex: groups.length,
      startChunkIndex: start,
      chunkCount: groupChunks.length,
      chunkLengths: groupChunks.map(chunk => chunk.length),
      parityBytes,
    });
  }
  return groups;
}

export function recoverSingleMissingChunk(
  group: BushMeshXorParityGroup,
  groupChunks: Array<number[] | null>,
): {chunkIndex: number; bytes: number[]} | null {
  if (groupChunks.length !== group.chunkCount) {
    throw new Error('Erasure group chunk count does not match parity metadata.');
  }
  group.parityBytes.forEach((byte, index) => {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`Parity byte ${index} is invalid.`);
    }
  });

  const missingIndexes: number[] = [];
  groupChunks.forEach((chunk, index) => {
    if (chunk === null) {
      missingIndexes.push(index);
    } else {
      assertBytes(chunk, `erasure group chunk ${index}`);
    }
  });

  if (missingIndexes.length !== 1) {
    return null;
  }

  const missingLocalIndex = missingIndexes[0];
  const recovered = [...group.parityBytes];
  for (let chunkIndex = 0; chunkIndex < groupChunks.length; chunkIndex += 1) {
    if (chunkIndex === missingLocalIndex) {
      continue;
    }
    const chunk = groupChunks[chunkIndex]!;
    for (let byteIndex = 0; byteIndex < recovered.length; byteIndex += 1) {
      recovered[byteIndex] ^= chunk[byteIndex] ?? 0;
    }
  }

  const expectedLength = group.chunkLengths[missingLocalIndex];
  return {
    chunkIndex: group.startChunkIndex + missingLocalIndex,
    bytes: recovered.slice(0, expectedLength),
  };
}
