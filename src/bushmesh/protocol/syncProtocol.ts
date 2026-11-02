import {assertBytes, assertIntegerInRange, decodeVarUint, encodeVarUint} from './codec';
import {BushMeshSyncSummary, createSyncSummary} from './syncSummary';

export enum BushMeshSyncNamespace {
  Messages = 0,
  Contacts = 1,
  Channels = 2,
  MapMarkers = 3,
  Configuration = 4,
}

export enum BushMeshSyncFrameKind {
  Summary = 1,
  RequestRanges = 2,
}

export type BushMeshInventorySummary = {
  kind: BushMeshSyncFrameKind.Summary;
  namespace: BushMeshSyncNamespace | number;
  generation: number;
  newestContiguousId: number | null;
  bloomHashCount: number;
  bloomBytes: number[];
};

export type BushMeshSyncRange = {
  start: number;
  end: number;
};

export type BushMeshRangeRequest = {
  kind: BushMeshSyncFrameKind.RequestRanges;
  namespace: BushMeshSyncNamespace | number;
  generation: number;
  ranges: BushMeshSyncRange[];
};

export type BushMeshSyncFrame = BushMeshInventorySummary | BushMeshRangeRequest;

export function createInventorySummary(
  namespace: BushMeshSyncNamespace | number,
  itemIds: number[],
  generation: number,
  options?: {bloomByteLength?: number; bloomHashCount?: number},
): BushMeshInventorySummary {
  assertIntegerInRange(namespace, 0, 255, 'Sync namespace');
  assertIntegerInRange(generation, 0, 0xffffffff, 'Sync generation');
  const summary = createSyncSummary(itemIds, options);
  return {
    kind: BushMeshSyncFrameKind.Summary,
    namespace,
    generation,
    newestContiguousId: summary.newestContiguousMessageId,
    bloomHashCount: summary.bloomHashCount,
    bloomBytes: [...summary.bloomBytes],
  };
}

export function encodeInventorySummary(summary: BushMeshInventorySummary): number[] {
  assertIntegerInRange(summary.namespace, 0, 255, 'Sync namespace');
  assertIntegerInRange(summary.generation, 0, 0xffffffff, 'Sync generation');
  assertIntegerInRange(summary.bloomHashCount, 1, 8, 'Bloom hash count');
  assertBytes(summary.bloomBytes, 'Bloom bytes');
  assertIntegerInRange(summary.bloomBytes.length, 1, 255, 'Bloom byte length');

  const hasWatermark = summary.newestContiguousId !== null;
  if (hasWatermark) {
    assertIntegerInRange(
      summary.newestContiguousId!,
      0,
      0xffffffff,
      'Sync watermark',
    );
  }

  return [
    BushMeshSyncFrameKind.Summary,
    summary.namespace,
    ...encodeVarUint(summary.generation),
    hasWatermark ? 1 : 0,
    ...(hasWatermark ? encodeVarUint(summary.newestContiguousId!) : []),
    summary.bloomHashCount,
    ...encodeVarUint(summary.bloomBytes.length),
    ...summary.bloomBytes,
  ];
}

export function missingIdsToRanges(missingIds: number[]): BushMeshSyncRange[] {
  const sorted = Array.from(new Set(missingIds)).sort((a, b) => a - b);
  sorted.forEach(id => assertIntegerInRange(id, 0, 0xffffffff, 'Missing sync ID'));
  if (sorted.length === 0) {
    return [];
  }

  const ranges: BushMeshSyncRange[] = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index];
    if (value === end + 1) {
      end = value;
      continue;
    }
    ranges.push({start, end});
    start = value;
    end = value;
  }
  ranges.push({start, end});
  return ranges;
}

export function encodeRangeRequest(request: BushMeshRangeRequest): number[] {
  assertIntegerInRange(request.namespace, 0, 255, 'Sync namespace');
  assertIntegerInRange(request.generation, 0, 0xffffffff, 'Sync generation');
  assertIntegerInRange(request.ranges.length, 0, 64, 'Sync range count');

  const bytes = [
    BushMeshSyncFrameKind.RequestRanges,
    request.namespace,
    ...encodeVarUint(request.generation),
    ...encodeVarUint(request.ranges.length),
  ];

  for (const range of request.ranges) {
    assertIntegerInRange(range.start, 0, 0xffffffff, 'Sync range start');
    assertIntegerInRange(range.end, range.start, 0xffffffff, 'Sync range end');
    bytes.push(...encodeVarUint(range.start), ...encodeVarUint(range.end));
  }

  return bytes;
}

export function decodeBushMeshSyncFrame(bytes: number[]): BushMeshSyncFrame {
  assertBytes(bytes, 'sync frame');
  if (bytes.length < 3) {
    throw new Error('Sync frame is too short.');
  }

  const kind = bytes[0];
  const namespace = bytes[1];
  const generation = decodeVarUint(bytes, 2);
  let cursor = generation.nextOffset;

  if (kind === BushMeshSyncFrameKind.Summary) {
    const flags = bytes[cursor];
    if (flags === undefined) {
      throw new Error('Sync summary flags are missing.');
    }
    cursor += 1;

    let newestContiguousId: number | null = null;
    if ((flags & 0x01) !== 0) {
      const watermark = decodeVarUint(bytes, cursor);
      newestContiguousId = watermark.value;
      cursor = watermark.nextOffset;
    }

    const bloomHashCount = bytes[cursor];
    if (bloomHashCount === undefined || bloomHashCount < 1 || bloomHashCount > 8) {
      throw new Error('Sync summary Bloom hash count is invalid.');
    }
    cursor += 1;

    const bloomLength = decodeVarUint(bytes, cursor);
    cursor = bloomLength.nextOffset;
    if (bloomLength.value < 1 || bloomLength.value > 255) {
      throw new Error('Sync summary Bloom length is invalid.');
    }
    const end = cursor + bloomLength.value;
    if (end !== bytes.length) {
      throw new Error('Sync summary Bloom payload length does not match frame.');
    }

    return {
      kind: BushMeshSyncFrameKind.Summary,
      namespace,
      generation: generation.value,
      newestContiguousId,
      bloomHashCount,
      bloomBytes: bytes.slice(cursor, end),
    };
  }

  if (kind === BushMeshSyncFrameKind.RequestRanges) {
    const count = decodeVarUint(bytes, cursor);
    cursor = count.nextOffset;
    if (count.value > 64) {
      throw new Error('Sync range request contains too many ranges.');
    }

    const ranges: BushMeshSyncRange[] = [];
    for (let index = 0; index < count.value; index += 1) {
      const start = decodeVarUint(bytes, cursor);
      const end = decodeVarUint(bytes, start.nextOffset);
      if (end.value < start.value) {
        throw new Error('Sync range end is before its start.');
      }
      ranges.push({start: start.value, end: end.value});
      cursor = end.nextOffset;
    }

    if (cursor !== bytes.length) {
      throw new Error('Unexpected bytes after sync range request.');
    }

    return {
      kind: BushMeshSyncFrameKind.RequestRanges,
      namespace,
      generation: generation.value,
      ranges,
    };
  }

  throw new Error(`Unknown Bushmesh sync frame kind ${kind}.`);
}

export function toLegacySyncSummary(
  summary: BushMeshInventorySummary,
): BushMeshSyncSummary {
  return {
    newestContiguousMessageId: summary.newestContiguousId,
    bloomHashCount: summary.bloomHashCount,
    bloomBytes: [...summary.bloomBytes],
  };
}
