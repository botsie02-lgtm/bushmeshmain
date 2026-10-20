import {Buffer} from 'buffer';

import {assertIntegerInRange} from './codec';
import {BushMeshSyncNamespace} from './syncProtocol';

function fnv1a32(bytes: number[]): number {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Creates a content/version-sensitive inventory ID. Stable entity keys alone are
 * insufficient for Bloom sync because changing a contact/channel in place would
 * still look present remotely. Adding a compact revision token makes the changed
 * item appear as a new missing ID without transmitting a full inventory.
 */
export function createBushMeshVersionedInventoryId(
  namespace: BushMeshSyncNamespace | number,
  entityKey: string,
  revision: string | number,
): number {
  assertIntegerInRange(namespace, 0, 255, 'Inventory namespace');

  const key = entityKey.trim();
  if (!key) {
    throw new Error('Inventory entity key cannot be empty.');
  }

  const revisionText = String(revision);
  const bytes = Array.from(
    Buffer.from(`${namespace}\u0000${key}\u0000${revisionText}`, 'utf8'),
  );
  return fnv1a32(bytes);
}

/**
 * Generates a deterministic revision token from compact binary/string content.
 * It is not a cryptographic hash; it is only an airtime-efficient change token.
 */
export function createBushMeshInventoryRevision(
  value: string | number[],
): number {
  const bytes =
    typeof value === 'string'
      ? Array.from(Buffer.from(value, 'utf8'))
      : [...value];

  for (const [index, byte] of bytes.entries()) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`Inventory revision byte ${index} is invalid.`);
    }
  }

  return fnv1a32(bytes);
}
