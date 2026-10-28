export const BUSHMESH_FORMATION_SNAPSHOT_VERSION = 1 as const;

export type BushMeshFormationMemberSnapshot = {
  id: string;
  kind: 'self' | 'vehicle';
};

export type BushMeshFormationSnapshotV1 = {
  version: typeof BUSHMESH_FORMATION_SNAPSHOT_VERSION;
  configured: boolean;
  members: BushMeshFormationMemberSnapshot[];
  cautionGapMeters: number;
  criticalGapMeters: number;
  savedAtMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function createFormationSnapshot(input: {
  configured: boolean;
  members: BushMeshFormationMemberSnapshot[];
  cautionGapMeters: number;
  criticalGapMeters: number;
  savedAtMs?: number;
}): BushMeshFormationSnapshotV1 {
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

  return {
    version: BUSHMESH_FORMATION_SNAPSHOT_VERSION,
    configured: input.configured,
    members,
    cautionGapMeters: input.cautionGapMeters,
    criticalGapMeters: input.criticalGapMeters,
    savedAtMs: input.savedAtMs ?? Date.now(),
  };
}

export function encodeFormationSnapshot(
  snapshot: BushMeshFormationSnapshotV1,
): string {
  return JSON.stringify(createFormationSnapshot(snapshot));
}

export function decodeFormationSnapshot(
  serialized: string,
): BushMeshFormationSnapshotV1 {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('Bushmesh formation snapshot is not valid JSON.');
  }

  if (
    !isRecord(value) ||
    value.version !== BUSHMESH_FORMATION_SNAPSHOT_VERSION ||
    typeof value.configured !== 'boolean' ||
    !Array.isArray(value.members) ||
    typeof value.cautionGapMeters !== 'number' ||
    typeof value.criticalGapMeters !== 'number' ||
    typeof value.savedAtMs !== 'number' ||
    !Number.isFinite(value.savedAtMs) ||
    value.savedAtMs < 0
  ) {
    throw new Error('Bushmesh formation snapshot has an unsupported shape.');
  }

  return createFormationSnapshot({
    configured: value.configured,
    members: value.members as BushMeshFormationMemberSnapshot[],
    cautionGapMeters: value.cautionGapMeters,
    criticalGapMeters: value.criticalGapMeters,
    savedAtMs: value.savedAtMs,
  });
}
