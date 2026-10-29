export const BUSHMESH_FORMATION_SNAPSHOT_VERSION = 2 as const;
const LEGACY_FORMATION_SNAPSHOT_VERSION = 1 as const;

export type BushMeshFormationMemberSnapshot = {
  id: string;
  kind: 'self' | 'vehicle';
};

export type BushMeshFormationSource =
  | {
      kind: 'local-manual';
      updatedAtMs: number;
    }
  | {
      kind: 'accepted-remote';
      senderId: string;
      revision: number;
      timestampSeconds: number;
      acceptedAtMs: number;
    }
  | {
      kind: 'legacy-unknown';
      migratedAtMs: number;
    };

export type BushMeshFormationSnapshotV2 = {
  version: typeof BUSHMESH_FORMATION_SNAPSHOT_VERSION;
  configured: boolean;
  members: BushMeshFormationMemberSnapshot[];
  cautionGapMeters: number;
  criticalGapMeters: number;
  source: BushMeshFormationSource;
  savedAtMs: number;
};

export type BushMeshFormationSnapshot = BushMeshFormationSnapshotV2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validMember(value: unknown): value is BushMeshFormationMemberSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    value.id.length <= 128 &&
    (value.kind === 'self' || value.kind === 'vehicle')
  );
}

function normalizeSenderId(value: string): string {
  const normalized = value.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(normalized)) {
    throw new Error('Remote formation source identity is invalid.');
  }
  return normalized;
}

function validateSource(source: BushMeshFormationSource): BushMeshFormationSource {
  switch (source.kind) {
    case 'local-manual':
      if (!validTimestamp(source.updatedAtMs)) {
        throw new Error('Local formation source timestamp is invalid.');
      }
      return {...source};

    case 'accepted-remote':
      if (
        !Number.isInteger(source.revision) ||
        source.revision < 0 ||
        source.revision > 0xffff ||
        !Number.isInteger(source.timestampSeconds) ||
        source.timestampSeconds < 0 ||
        source.timestampSeconds > 0xffffffff ||
        !validTimestamp(source.acceptedAtMs)
      ) {
        throw new Error('Remote formation source metadata is invalid.');
      }
      return {
        ...source,
        senderId: normalizeSenderId(source.senderId),
      };

    case 'legacy-unknown':
      if (!validTimestamp(source.migratedAtMs)) {
        throw new Error('Legacy formation source timestamp is invalid.');
      }
      return {...source};
  }
}

function sourceFromUnknown(value: unknown): BushMeshFormationSource {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('Bushmesh formation source metadata is invalid.');
  }

  switch (value.kind) {
    case 'local-manual':
      return validateSource({
        kind: 'local-manual',
        updatedAtMs: value.updatedAtMs as number,
      });
    case 'accepted-remote':
      if (typeof value.senderId !== 'string') {
        throw new Error('Remote formation source identity is missing.');
      }
      return validateSource({
        kind: 'accepted-remote',
        senderId: value.senderId,
        revision: value.revision as number,
        timestampSeconds: value.timestampSeconds as number,
        acceptedAtMs: value.acceptedAtMs as number,
      });
    case 'legacy-unknown':
      return validateSource({
        kind: 'legacy-unknown',
        migratedAtMs: value.migratedAtMs as number,
      });
    default:
      throw new Error('Unsupported Bushmesh formation source type.');
  }
}

export function createFormationSnapshot(input: {
  configured: boolean;
  members: BushMeshFormationMemberSnapshot[];
  cautionGapMeters: number;
  criticalGapMeters: number;
  source?: BushMeshFormationSource;
  savedAtMs?: number;
}): BushMeshFormationSnapshotV2 {
  if (!Number.isFinite(input.cautionGapMeters) || input.cautionGapMeters <= 0) {
    throw new Error('Formation caution gap must be a positive number.');
  }
  if (
    !Number.isFinite(input.criticalGapMeters) ||
    input.criticalGapMeters <= input.cautionGapMeters
  ) {
    throw new Error('Formation critical gap must be greater than caution gap.');
  }

  const seen = new Set<string>();
  const members = input.members.map(member => {
    if (!validMember(member) || seen.has(member.id)) {
      throw new Error('Formation snapshot contains an invalid or duplicate member.');
    }
    seen.add(member.id);
    return {id: member.id, kind: member.kind};
  });
  const savedAtMs = input.savedAtMs ?? Date.now();
  if (!validTimestamp(savedAtMs)) {
    throw new Error('Formation snapshot save timestamp is invalid.');
  }

  return {
    version: BUSHMESH_FORMATION_SNAPSHOT_VERSION,
    configured: input.configured,
    members,
    cautionGapMeters: input.cautionGapMeters,
    criticalGapMeters: input.criticalGapMeters,
    source: validateSource(
      input.source ?? {kind: 'local-manual', updatedAtMs: savedAtMs},
    ),
    savedAtMs,
  };
}

export function encodeFormationSnapshot(
  snapshot: BushMeshFormationSnapshotV2,
): string {
  return JSON.stringify(createFormationSnapshot(snapshot));
}

export function decodeFormationSnapshot(
  serialized: string,
): BushMeshFormationSnapshotV2 {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('Bushmesh formation snapshot is not valid JSON.');
  }

  if (
    !isRecord(value) ||
    typeof value.configured !== 'boolean' ||
    !Array.isArray(value.members) ||
    typeof value.cautionGapMeters !== 'number' ||
    typeof value.criticalGapMeters !== 'number' ||
    !validTimestamp(value.savedAtMs)
  ) {
    throw new Error('Bushmesh formation snapshot has an unsupported shape.');
  }

  if (value.version === LEGACY_FORMATION_SNAPSHOT_VERSION) {
    return createFormationSnapshot({
      configured: value.configured,
      members: value.members as BushMeshFormationMemberSnapshot[],
      cautionGapMeters: value.cautionGapMeters,
      criticalGapMeters: value.criticalGapMeters,
      source: {
        kind: 'legacy-unknown',
        migratedAtMs: Date.now(),
      },
      savedAtMs: value.savedAtMs,
    });
  }

  if (value.version !== BUSHMESH_FORMATION_SNAPSHOT_VERSION) {
    throw new Error('Bushmesh formation snapshot version is unsupported.');
  }

  return createFormationSnapshot({
    configured: value.configured,
    members: value.members as BushMeshFormationMemberSnapshot[],
    cautionGapMeters: value.cautionGapMeters,
    criticalGapMeters: value.criticalGapMeters,
    source: sourceFromUnknown(value.source),
    savedAtMs: value.savedAtMs,
  });
}
