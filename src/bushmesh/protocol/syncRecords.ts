import {
  assertBytes,
  assertIntegerInRange,
  decodeVarUint,
  encodeVarUint,
} from './codec';
import {BushMeshSyncNamespace} from './syncProtocol';

export type BushMeshSyncRecord = {
  itemId: number;
  payload: number[];
};

export type BushMeshSyncRecordBatch = {
  namespace: BushMeshSyncNamespace | number;
  generation: number;
  records: BushMeshSyncRecord[];
};

const MAX_RECORDS_PER_BATCH = 64;
const MAX_RECORD_PAYLOAD_BYTES = 4096;

/**
 * Encodes concrete records selected by a sync range request. The batch is kept
 * separate from the small summary/request control frames so it can ride the
 * resumable FILE transport when it grows beyond a single LoRa payload.
 */
export function encodeBushMeshSyncRecordBatch(
  batch: BushMeshSyncRecordBatch,
): number[] {
  assertIntegerInRange(batch.namespace, 0, 255, 'Sync record namespace');
  assertIntegerInRange(batch.generation, 0, 0xffffffff, 'Sync record generation');
  assertIntegerInRange(
    batch.records.length,
    0,
    MAX_RECORDS_PER_BATCH,
    'Sync record count',
  );

  const bytes: number[] = [
    batch.namespace,
    ...encodeVarUint(batch.generation),
    ...encodeVarUint(batch.records.length),
  ];
  const seen = new Set<number>();

  for (const record of batch.records) {
    assertIntegerInRange(record.itemId, 0, 0xffffffff, 'Sync record item ID');
    assertBytes(record.payload, `sync record ${record.itemId}`);
    assertIntegerInRange(
      record.payload.length,
      0,
      MAX_RECORD_PAYLOAD_BYTES,
      'Sync record payload length',
    );

    if (seen.has(record.itemId)) {
      throw new Error(`Duplicate sync record item ID ${record.itemId}.`);
    }
    seen.add(record.itemId);

    bytes.push(
      ...encodeVarUint(record.itemId),
      ...encodeVarUint(record.payload.length),
      ...record.payload,
    );
  }

  return bytes;
}

export function decodeBushMeshSyncRecordBatch(
  bytes: number[],
): BushMeshSyncRecordBatch {
  assertBytes(bytes, 'sync record batch');

  if (bytes.length < 3) {
    throw new Error('Sync record batch is too short.');
  }

  const namespace = bytes[0];
  const generation = decodeVarUint(bytes, 1);
  const count = decodeVarUint(bytes, generation.nextOffset);

  if (count.value > MAX_RECORDS_PER_BATCH) {
    throw new Error('Sync record batch contains too many records.');
  }

  let cursor = count.nextOffset;
  const records: BushMeshSyncRecord[] = [];
  const seen = new Set<number>();

  for (let index = 0; index < count.value; index += 1) {
    const itemId = decodeVarUint(bytes, cursor);
    const length = decodeVarUint(bytes, itemId.nextOffset);
    cursor = length.nextOffset;

    if (length.value > MAX_RECORD_PAYLOAD_BYTES) {
      throw new Error('Sync record payload exceeds the supported size.');
    }

    const end = cursor + length.value;
    if (end > bytes.length) {
      throw new Error('Sync record payload is truncated.');
    }
    if (seen.has(itemId.value)) {
      throw new Error(`Duplicate sync record item ID ${itemId.value}.`);
    }
    seen.add(itemId.value);

    records.push({
      itemId: itemId.value,
      payload: bytes.slice(cursor, end),
    });
    cursor = end;
  }

  if (cursor !== bytes.length) {
    throw new Error('Unexpected bytes after sync record batch.');
  }

  return {
    namespace,
    generation: generation.value,
    records,
  };
}
