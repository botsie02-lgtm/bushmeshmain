import {
  BushMeshInventorySummary,
  BushMeshSyncRange,
  idsProbablyMissingFromRemote,
  missingIdsToRanges,
  toLegacySyncSummary,
} from '../protocol';

export type BushMeshSyncPlan = {
  sendItemIds: number[];
  requestRanges: BushMeshSyncRange[];
  remoteGeneration: number;
  remoteWatermark: number | null;
  truncated: boolean;
};

/**
 * Converts a remote Bloom/watermark summary into a conservative exchange plan.
 * Bloom filters are only used to decide what the remote probably lacks; range
 * requests are derived from explicit watermark gaps so false positives never
 * delete or overwrite local data.
 */
export function planBushMeshSyncExchange(
  localItemIds: number[],
  remoteSummary: BushMeshInventorySummary,
  options?: {
    maxSendIds?: number;
    maxRequestIdsToScan?: number;
    maxRanges?: number;
  },
): BushMeshSyncPlan {
  const sortedLocal = Array.from(new Set(localItemIds)).sort((a, b) => a - b);
  const maxSendIds = options?.maxSendIds ?? 64;
  const maxRequestIdsToScan = options?.maxRequestIdsToScan ?? 2048;
  const maxRanges = options?.maxRanges ?? 32;

  if (!Number.isInteger(maxSendIds) || maxSendIds < 1) {
    throw new Error('Sync max send IDs must be a positive integer.');
  }
  if (!Number.isInteger(maxRequestIdsToScan) || maxRequestIdsToScan < 1) {
    throw new Error('Sync request scan limit must be a positive integer.');
  }
  if (!Number.isInteger(maxRanges) || maxRanges < 1 || maxRanges > 64) {
    throw new Error('Sync max ranges must be from 1 to 64.');
  }

  const probablyMissingRemote = idsProbablyMissingFromRemote(
    sortedLocal,
    toLegacySyncSummary(remoteSummary),
  );
  const sendItemIds = probablyMissingRemote.slice(0, maxSendIds);
  let truncated = probablyMissingRemote.length > sendItemIds.length;

  const missingLocalIds: number[] = [];
  const watermark = remoteSummary.newestContiguousId;

  if (watermark !== null && watermark >= 0) {
    const localSet = new Set(sortedLocal);
    const localFloor = sortedLocal.length > 0 ? sortedLocal[0] : 0;
    const start = Math.max(0, localFloor);
    const end = Math.min(watermark, start + maxRequestIdsToScan - 1);

    for (let id = start; id <= end; id += 1) {
      if (!localSet.has(id)) {
        missingLocalIds.push(id);
      }
    }

    if (end < watermark) {
      truncated = true;
    }
  }

  const allRanges = missingIdsToRanges(missingLocalIds);
  const requestRanges = allRanges.slice(0, maxRanges);
  if (allRanges.length > requestRanges.length) {
    truncated = true;
  }

  return {
    sendItemIds,
    requestRanges,
    remoteGeneration: remoteSummary.generation,
    remoteWatermark: remoteSummary.newestContiguousId,
    truncated,
  };
}
