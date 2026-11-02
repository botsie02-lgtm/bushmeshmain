import {
  assertBytes,
  assertIntegerInRange,
  decodeVarUint,
  encodeVarUint,
} from './codec';

export function crc16Ccitt(bytes: number[], initial = 0xffff): number {
  assertBytes(bytes);
  let crc = initial & 0xffff;

  for (const byte of bytes) {
    crc ^= byte << 8;

    for (let bit = 0; bit < 8; bit += 1) {
      crc =
        (crc & 0x8000) !== 0
          ? ((crc << 1) ^ 0x1021) & 0xffff
          : (crc << 1) & 0xffff;
    }
  }

  return crc;
}

export type EncodedFragment = {
  messageId: number;
  fragmentIndex: number;
  fragmentCount: number;
  bytes: number[];
  data: number[];
};

export type DecodedFragment = Omit<EncodedFragment, 'bytes'> & {
  crc16: number;
};

export function encodeFragment(
  messageId: number,
  fragmentIndex: number,
  fragmentCount: number,
  data: number[],
): number[] {
  assertIntegerInRange(fragmentIndex, 0, 0xffff, 'Fragment index');
  assertIntegerInRange(fragmentCount, 1, 0xffff, 'Fragment count');

  if (fragmentIndex >= fragmentCount) {
    throw new Error('Fragment index must be less than fragment count.');
  }

  assertBytes(data, 'fragment data');
  const crc = crc16Ccitt(data);

  return [
    ...encodeVarUint(messageId),
    ...encodeVarUint(fragmentIndex),
    ...encodeVarUint(fragmentCount),
    crc & 0xff,
    (crc >> 8) & 0xff,
    ...data,
  ];
}

export function decodeFragment(bytes: number[]): DecodedFragment {
  assertBytes(bytes);

  const messageId = decodeVarUint(bytes, 0);
  const fragmentIndex = decodeVarUint(bytes, messageId.nextOffset);
  const fragmentCount = decodeVarUint(bytes, fragmentIndex.nextOffset);
  const crcOffset = fragmentCount.nextOffset;
  const crcLow = bytes[crcOffset];
  const crcHigh = bytes[crcOffset + 1];

  if (crcLow === undefined || crcHigh === undefined) {
    throw new Error('Fragment CRC is missing.');
  }

  if (fragmentIndex.value >= fragmentCount.value || fragmentCount.value === 0) {
    throw new Error('Fragment index/count is invalid.');
  }

  const data = bytes.slice(crcOffset + 2);
  const expectedCrc = crcLow | (crcHigh << 8);

  if (crc16Ccitt(data) !== expectedCrc) {
    throw new Error('Fragment CRC mismatch.');
  }

  return {
    messageId: messageId.value,
    fragmentIndex: fragmentIndex.value,
    fragmentCount: fragmentCount.value,
    crc16: expectedCrc,
    data,
  };
}

export function fragmentPayload(
  messageId: number,
  payload: number[],
  maxFragmentDataBytes = 40,
): EncodedFragment[] {
  assertBytes(payload, 'payload');
  assertIntegerInRange(maxFragmentDataBytes, 1, 255, 'Fragment data size');

  const fragmentCount = Math.max(
    1,
    Math.ceil(payload.length / maxFragmentDataBytes),
  );

  if (fragmentCount > 0xffff) {
    throw new Error('Payload requires too many fragments.');
  }

  return Array.from({length: fragmentCount}, (_, fragmentIndex) => {
    const start = fragmentIndex * maxFragmentDataBytes;
    const data = payload.slice(start, start + maxFragmentDataBytes);

    return {
      messageId,
      fragmentIndex,
      fragmentCount,
      data,
      bytes: encodeFragment(messageId, fragmentIndex, fragmentCount, data),
    };
  });
}

export type ReassemblyProgress = {
  messageId: number;
  fragmentCount: number;
  receivedCount: number;
  missingFragments: number[];
  complete: boolean;
  data?: number[];
};

type PendingReassembly = {
  fragmentCount: number;
  fragments: Map<number, number[]>;
  updatedAt: number;
};

export class BushMeshFragmentReassembler {
  private pending = new Map<number, PendingReassembly>();

  constructor(private readonly timeoutMs = 120000) {}

  accept(fragmentBytes: number[], now = Date.now()): ReassemblyProgress {
    this.pruneExpired(now);
    const fragment = decodeFragment(fragmentBytes);
    const existing = this.pending.get(fragment.messageId);

    if (existing && existing.fragmentCount !== fragment.fragmentCount) {
      this.pending.delete(fragment.messageId);
      throw new Error('Fragment count changed for an in-progress message.');
    }

    const state: PendingReassembly = existing ?? {
      fragmentCount: fragment.fragmentCount,
      fragments: new Map<number, number[]>(),
      updatedAt: now,
    };

    state.updatedAt = now;

    if (!state.fragments.has(fragment.fragmentIndex)) {
      state.fragments.set(fragment.fragmentIndex, fragment.data);
    }

    this.pending.set(fragment.messageId, state);
    const missingFragments = this.getMissing(fragment.messageId) ?? [];

    if (missingFragments.length > 0) {
      return {
        messageId: fragment.messageId,
        fragmentCount: state.fragmentCount,
        receivedCount: state.fragments.size,
        missingFragments,
        complete: false,
      };
    }

    const data: number[] = [];

    for (let index = 0; index < state.fragmentCount; index += 1) {
      data.push(...(state.fragments.get(index) ?? []));
    }

    this.pending.delete(fragment.messageId);

    return {
      messageId: fragment.messageId,
      fragmentCount: state.fragmentCount,
      receivedCount: state.fragmentCount,
      missingFragments: [],
      complete: true,
      data,
    };
  }

  getMissing(messageId: number): number[] | null {
    const state = this.pending.get(messageId);

    if (!state) {
      return null;
    }

    const missing: number[] = [];

    for (let index = 0; index < state.fragmentCount; index += 1) {
      if (!state.fragments.has(index)) {
        missing.push(index);
      }
    }

    return missing;
  }

  pruneExpired(now = Date.now()): number[] {
    const expired: number[] = [];

    for (const [messageId, state] of this.pending.entries()) {
      if (now - state.updatedAt >= this.timeoutMs) {
        this.pending.delete(messageId);
        expired.push(messageId);
      }
    }

    return expired;
  }

  reset(messageId?: number): void {
    if (messageId === undefined) {
      this.pending.clear();
      return;
    }

    this.pending.delete(messageId);
  }
}

export type FragmentAck = {
  messageId: number;
  fragmentCount: number;
  receivedFragments: number[];
  missingFragments: number[];
};

export function encodeFragmentAck(
  messageId: number,
  fragmentCount: number,
  receivedFragments: number[],
): number[] {
  assertIntegerInRange(fragmentCount, 1, 0xffff, 'Fragment count');
  const bitmap = new Array(Math.ceil(fragmentCount / 8)).fill(0);
  const seen = new Set<number>();

  for (const index of receivedFragments) {
    assertIntegerInRange(
      index,
      0,
      fragmentCount - 1,
      'Received fragment index',
    );

    if (!seen.has(index)) {
      seen.add(index);
      bitmap[Math.floor(index / 8)] |= 1 << (index % 8);
    }
  }

  return [
    ...encodeVarUint(messageId),
    ...encodeVarUint(fragmentCount),
    ...bitmap,
  ];
}

export function decodeFragmentAck(bytes: number[]): FragmentAck {
  assertBytes(bytes);
  const messageId = decodeVarUint(bytes, 0);
  const fragmentCount = decodeVarUint(bytes, messageId.nextOffset);
  const bitmapLength = Math.ceil(fragmentCount.value / 8);
  const bitmap = bytes.slice(fragmentCount.nextOffset);

  if (bitmap.length !== bitmapLength) {
    throw new Error('ACK bitmap length does not match fragment count.');
  }

  const receivedFragments: number[] = [];
  const missingFragments: number[] = [];

  for (let index = 0; index < fragmentCount.value; index += 1) {
    const isReceived =
      (bitmap[Math.floor(index / 8)] & (1 << (index % 8))) !== 0;
    (isReceived ? receivedFragments : missingFragments).push(index);
  }

  return {
    messageId: messageId.value,
    fragmentCount: fragmentCount.value,
    receivedFragments,
    missingFragments,
  };
}
