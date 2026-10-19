import {assertBytes, assertIntegerInRange} from './codec';

function hashMessageId(messageId: number, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  let value = messageId >>> 0;

  for (let index = 0; index < 4; index += 1) {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    value >>>= 8;
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;

  return hash >>> 0;
}

export class BushMeshBloomFilter {
  private readonly bytes: number[];

  constructor(
    readonly byteLength = 16,
    readonly hashCount = 3,
    initialBytes?: number[],
  ) {
    assertIntegerInRange(byteLength, 1, 255, 'Bloom filter byte length');
    assertIntegerInRange(hashCount, 1, 8, 'Bloom filter hash count');

    if (initialBytes) {
      assertBytes(initialBytes, 'Bloom filter bytes');

      if (initialBytes.length !== byteLength) {
        throw new Error('Bloom filter byte length does not match initial bytes.');
      }

      this.bytes = [...initialBytes];
    } else {
      this.bytes = new Array(byteLength).fill(0);
    }
  }

  add(messageId: number): void {
    assertIntegerInRange(messageId, 0, 0xffffffff, 'Message ID');
    const bitCount = this.byteLength * 8;

    for (let seed = 0; seed < this.hashCount; seed += 1) {
      const bit = hashMessageId(messageId, seed + 1) % bitCount;
      this.bytes[Math.floor(bit / 8)] |= 1 << (bit % 8);
    }
  }

  addMany(messageIds: number[]): void {
    for (const messageId of messageIds) {
      this.add(messageId);
    }
  }

  mightContain(messageId: number): boolean {
    assertIntegerInRange(messageId, 0, 0xffffffff, 'Message ID');
    const bitCount = this.byteLength * 8;

    for (let seed = 0; seed < this.hashCount; seed += 1) {
      const bit = hashMessageId(messageId, seed + 1) % bitCount;
      const present =
        (this.bytes[Math.floor(bit / 8)] & (1 << (bit % 8))) !== 0;

      if (!present) {
        return false;
      }
    }

    return true;
  }

  toBytes(): number[] {
    return [...this.bytes];
  }

  static fromBytes(bytes: number[], hashCount = 3): BushMeshBloomFilter {
    return new BushMeshBloomFilter(bytes.length, hashCount, bytes);
  }
}

export type BushMeshSyncSummary = {
  newestContiguousMessageId: number | null;
  bloomBytes: number[];
  bloomHashCount: number;
};

export function newestContiguousMessageId(messageIds: number[]): number | null {
  if (messageIds.length === 0) {
    return null;
  }

  const sorted = Array.from(new Set(messageIds)).sort((a, b) => a - b);
  sorted.forEach(messageId =>
    assertIntegerInRange(messageId, 0, 0xffffffff, 'Message ID'),
  );

  let newest = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] !== newest + 1) {
      break;
    }

    newest = sorted[index];
  }

  return newest;
}

export function createSyncSummary(
  messageIds: number[],
  options?: {bloomByteLength?: number; bloomHashCount?: number},
): BushMeshSyncSummary {
  const bloom = new BushMeshBloomFilter(
    options?.bloomByteLength ?? 16,
    options?.bloomHashCount ?? 3,
  );
  bloom.addMany(messageIds);

  return {
    newestContiguousMessageId: newestContiguousMessageId(messageIds),
    bloomBytes: bloom.toBytes(),
    bloomHashCount: bloom.hashCount,
  };
}

export function idsProbablyMissingFromRemote(
  localMessageIds: number[],
  remoteSummary: BushMeshSyncSummary,
): number[] {
  const bloom = BushMeshBloomFilter.fromBytes(
    remoteSummary.bloomBytes,
    remoteSummary.bloomHashCount,
  );

  return localMessageIds.filter(messageId => {
    if (
      remoteSummary.newestContiguousMessageId !== null &&
      messageId <= remoteSummary.newestContiguousMessageId
    ) {
      return false;
    }

    return !bloom.mightContain(messageId);
  });
}
