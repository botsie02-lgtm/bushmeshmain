import type {BushMeshContact} from '../state/BushMeshContext';

export const BUSHMESH_CONTACT_SNAPSHOT_VERSION = 1 as const;

export type BushMeshContactSnapshotV1 = {
  version: typeof BUSHMESH_CONTACT_SNAPSHOT_VERSION;
  savedAtMs: number;
  contacts: BushMeshContact[];
};

function finiteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function nonNegativeIntegerOrNull(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 0)
  );
}

function validHex(value: unknown, length: number): value is string {
  return (
    typeof value === 'string' &&
    value.length === length &&
    new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value)
  );
}

function validateContact(contact: unknown): asserts contact is BushMeshContact {
  if (!contact || typeof contact !== 'object') {
    throw new Error('Persisted Bushmesh contact is not an object.');
  }

  const candidate = contact as Partial<BushMeshContact>;
  if (!validHex(candidate.publicKey, 64)) {
    throw new Error('Persisted Bushmesh contact has an invalid public key.');
  }
  if (!validHex(candidate.publicKeyPrefix, 12)) {
    throw new Error('Persisted Bushmesh contact has an invalid public-key prefix.');
  }
  if (
    candidate.publicKey.slice(0, 12).toUpperCase() !==
    candidate.publicKeyPrefix.toUpperCase()
  ) {
    throw new Error('Persisted Bushmesh contact public-key prefix does not match.');
  }
  if (typeof candidate.name !== 'string') {
    throw new Error('Persisted Bushmesh contact has an invalid name.');
  }
  if (
    !Number.isInteger(candidate.type) ||
    !Number.isInteger(candidate.flags) ||
    !Number.isInteger(candidate.outPathLength)
  ) {
    throw new Error('Persisted Bushmesh contact has invalid radio metadata.');
  }
  if (!nonNegativeIntegerOrNull(candidate.lastAdvert)) {
    throw new Error('Persisted Bushmesh contact has an invalid advert timestamp.');
  }
  if (!finiteOrNull(candidate.latitude) || !finiteOrNull(candidate.longitude)) {
    throw new Error('Persisted Bushmesh contact has an invalid location.');
  }
  if (
    candidate.latitude !== null &&
    (candidate.latitude < -90 || candidate.latitude > 90)
  ) {
    throw new Error('Persisted Bushmesh contact latitude is out of range.');
  }
  if (
    candidate.longitude !== null &&
    (candidate.longitude < -180 || candidate.longitude > 180)
  ) {
    throw new Error('Persisted Bushmesh contact longitude is out of range.');
  }
  if (!nonNegativeIntegerOrNull(candidate.lastModified)) {
    throw new Error('Persisted Bushmesh contact has an invalid modified timestamp.');
  }
}

function normalizeContact(contact: BushMeshContact): BushMeshContact {
  return {
    ...contact,
    publicKey: contact.publicKey.toUpperCase(),
    publicKeyPrefix: contact.publicKeyPrefix.toUpperCase(),
  };
}

export function createContactSnapshot(
  contacts: BushMeshContact[],
  savedAtMs = Date.now(),
): BushMeshContactSnapshotV1 {
  if (!Number.isFinite(savedAtMs) || savedAtMs < 0) {
    throw new Error('Contact snapshot savedAtMs is invalid.');
  }

  const byPublicKey = new Map<string, BushMeshContact>();
  contacts.forEach(contact => {
    validateContact(contact);
    const normalized = normalizeContact(contact);
    const existing = byPublicKey.get(normalized.publicKey);
    if (
      !existing ||
      (normalized.lastModified ?? normalized.lastAdvert ?? 0) >=
        (existing.lastModified ?? existing.lastAdvert ?? 0)
    ) {
      byPublicKey.set(normalized.publicKey, normalized);
    }
  });

  return {
    version: BUSHMESH_CONTACT_SNAPSHOT_VERSION,
    savedAtMs,
    contacts: Array.from(byPublicKey.values()),
  };
}

export function encodeContactSnapshot(snapshot: BushMeshContactSnapshotV1): string {
  validateContactSnapshot(snapshot);
  return JSON.stringify(snapshot);
}

export function decodeContactSnapshot(serialized: string): BushMeshContactSnapshotV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Contact snapshot is not valid JSON.');
  }

  validateContactSnapshot(parsed);
  const snapshot = parsed as BushMeshContactSnapshotV1;
  return {
    ...snapshot,
    contacts: snapshot.contacts.map(normalizeContact),
  };
}

export function validateContactSnapshot(
  snapshot: unknown,
): asserts snapshot is BushMeshContactSnapshotV1 {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Contact snapshot is not an object.');
  }

  const candidate = snapshot as Partial<BushMeshContactSnapshotV1>;
  if (candidate.version !== BUSHMESH_CONTACT_SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported contact snapshot version ${String(candidate.version)}.`,
    );
  }
  if (
    typeof candidate.savedAtMs !== 'number' ||
    !Number.isFinite(candidate.savedAtMs) ||
    candidate.savedAtMs < 0
  ) {
    throw new Error('Contact snapshot has an invalid savedAtMs value.');
  }
  if (!Array.isArray(candidate.contacts)) {
    throw new Error('Contact snapshot contacts are invalid.');
  }

  candidate.contacts.forEach(validateContact);
}
