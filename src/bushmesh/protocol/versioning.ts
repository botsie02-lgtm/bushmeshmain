import {
  BUSHMESH_PROTOCOL_VERSION,
  DecodedBushMeshEnvelope,
  assertIntegerInRange,
} from './codec';
import {getBushMeshPacketDefinition} from './packetTypes';

export const BUSHMESH_MIN_SUPPORTED_PROTOCOL_VERSION = 1;
export const BUSHMESH_MAX_SUPPORTED_PROTOCOL_VERSION = BUSHMESH_PROTOCOL_VERSION;

export enum BushMeshPacketTypeClass {
  Invalid = 'invalid',
  Core = 'core',
  ReservedCore = 'reserved-core',
  Experimental = 'experimental',
  VendorPrivate = 'vendor-private',
}

export type BushMeshProtocolCompatibility = {
  compatible: boolean;
  negotiatedVersion: number | null;
  reason: string;
};

export type BushMeshProtocolMigration = {
  fromVersion: number;
  toVersion: number;
  migrate: (wireBytes: number[]) => number[];
};

/** The v1 envelope allocates two bits to the protocol version. */
export const BUSHMESH_MAX_ENVELOPE_PROTOCOL_VERSION = 3;

export function negotiateBushMeshProtocolRanges(
  localMinVersion: number,
  localMaxVersion: number,
  remoteMinVersion: number,
  remoteMaxVersion: number,
): BushMeshProtocolCompatibility {
  assertIntegerInRange(
    localMinVersion,
    0,
    BUSHMESH_MAX_ENVELOPE_PROTOCOL_VERSION,
    'Local minimum protocol version',
  );
  assertIntegerInRange(
    localMaxVersion,
    localMinVersion,
    BUSHMESH_MAX_ENVELOPE_PROTOCOL_VERSION,
    'Local maximum protocol version',
  );
  assertIntegerInRange(
    remoteMinVersion,
    0,
    BUSHMESH_MAX_ENVELOPE_PROTOCOL_VERSION,
    'Remote minimum protocol version',
  );
  assertIntegerInRange(
    remoteMaxVersion,
    remoteMinVersion,
    BUSHMESH_MAX_ENVELOPE_PROTOCOL_VERSION,
    'Remote maximum protocol version',
  );

  const minimum = Math.max(localMinVersion, remoteMinVersion);
  const maximum = Math.min(localMaxVersion, remoteMaxVersion);

  if (minimum > maximum) {
    return {
      compatible: false,
      negotiatedVersion: null,
      reason: `No overlapping BushMesh protocol version (local ${localMinVersion}-${localMaxVersion}, remote ${remoteMinVersion}-${remoteMaxVersion}).`,
    };
  }

  return {
    compatible: true,
    negotiatedVersion: maximum,
    reason: `BushMesh protocol v${maximum} is mutually supported.`,
  };
}

export function negotiateBushMeshProtocolVersion(
  remoteMinVersion: number,
  remoteMaxVersion: number,
): BushMeshProtocolCompatibility {
  return negotiateBushMeshProtocolRanges(
    BUSHMESH_MIN_SUPPORTED_PROTOCOL_VERSION,
    BUSHMESH_MAX_SUPPORTED_PROTOCOL_VERSION,
    remoteMinVersion,
    remoteMaxVersion,
  );
}

/**
 * Packet allocation for the six-bit packet type field.
 *
 * Registered v1 packet definitions are authoritative. Unallocated 0x01-0x1f
 * values remain reserved for standardized core use; 0x20-0x2f are experimental
 * and 0x30-0x3f are vendor/private extensions.
 */
export function classifyBushMeshPacketType(
  type: number,
): BushMeshPacketTypeClass {
  assertIntegerInRange(type, 0, 0x3f, 'BushMesh packet type');

  if (type === 0) {
    return BushMeshPacketTypeClass.Invalid;
  }

  const definition = getBushMeshPacketDefinition(type);
  if (definition?.stability === 'core') {
    return BushMeshPacketTypeClass.Core;
  }
  if (definition?.stability === 'reserved-core') {
    return BushMeshPacketTypeClass.ReservedCore;
  }

  if (type <= 0x1f) {
    return BushMeshPacketTypeClass.ReservedCore;
  }
  if (type <= 0x2f) {
    return BushMeshPacketTypeClass.Experimental;
  }
  return BushMeshPacketTypeClass.VendorPrivate;
}

export function assertBushMeshEnvelopeCompatibility(
  envelope: DecodedBushMeshEnvelope,
  options?: {
    allowExperimentalPacketTypes?: boolean;
    allowVendorPrivatePacketTypes?: boolean;
  },
): void {
  if (
    envelope.version < BUSHMESH_MIN_SUPPORTED_PROTOCOL_VERSION ||
    envelope.version > BUSHMESH_MAX_SUPPORTED_PROTOCOL_VERSION
  ) {
    throw new Error(
      `Unsupported BushMesh protocol version ${envelope.version}; this build supports ${BUSHMESH_MIN_SUPPORTED_PROTOCOL_VERSION}-${BUSHMESH_MAX_SUPPORTED_PROTOCOL_VERSION}.`,
    );
  }

  const typeClass = classifyBushMeshPacketType(envelope.type);

  switch (typeClass) {
    case BushMeshPacketTypeClass.Core:
      return;
    case BushMeshPacketTypeClass.Invalid:
      throw new Error('BushMesh packet type 0 is invalid.');
    case BushMeshPacketTypeClass.ReservedCore:
      throw new Error(
        `BushMesh packet type 0x${envelope.type.toString(16).padStart(2, '0')} is reserved for a future standardized schema.`,
      );
    case BushMeshPacketTypeClass.Experimental:
      if (options?.allowExperimentalPacketTypes === true) {
        return;
      }
      throw new Error(
        `Experimental BushMesh packet type 0x${envelope.type.toString(16).padStart(2, '0')} is not enabled.`,
      );
    case BushMeshPacketTypeClass.VendorPrivate:
      if (options?.allowVendorPrivatePacketTypes === true) {
        return;
      }
      throw new Error(
        `Vendor/private BushMesh packet type 0x${envelope.type.toString(16).padStart(2, '0')} requires explicit capability support.`,
      );
  }
}

/**
 * Ordered migration registry for future on-device upgrades. Migrations are
 * explicit and one version step at a time; unknown wire schemas are never
 * reinterpreted on a best-effort basis.
 */
export class BushMeshProtocolMigrationRegistry {
  private readonly migrations = new Map<number, BushMeshProtocolMigration>();

  register(migration: BushMeshProtocolMigration): void {
    assertIntegerInRange(
      migration.fromVersion,
      0,
      BUSHMESH_MAX_ENVELOPE_PROTOCOL_VERSION,
      'Migration source version',
    );
    assertIntegerInRange(
      migration.toVersion,
      0,
      BUSHMESH_MAX_ENVELOPE_PROTOCOL_VERSION,
      'Migration target version',
    );

    if (migration.toVersion !== migration.fromVersion + 1) {
      throw new Error('BushMesh migrations must advance exactly one protocol version.');
    }
    if (this.migrations.has(migration.fromVersion)) {
      throw new Error(
        `BushMesh migration from v${migration.fromVersion} is already registered.`,
      );
    }

    this.migrations.set(migration.fromVersion, migration);
  }

  canMigrate(fromVersion: number, toVersion = BUSHMESH_PROTOCOL_VERSION): boolean {
    if (fromVersion === toVersion) {
      return true;
    }
    if (fromVersion > toVersion) {
      return false;
    }

    let version = fromVersion;
    while (version < toVersion) {
      const migration = this.migrations.get(version);
      if (!migration || migration.toVersion !== version + 1) {
        return false;
      }
      version = migration.toVersion;
    }
    return true;
  }

  migrate(
    wireBytes: number[],
    fromVersion: number,
    toVersion = BUSHMESH_PROTOCOL_VERSION,
  ): number[] {
    if (!this.canMigrate(fromVersion, toVersion)) {
      throw new Error(
        `No complete BushMesh migration path from v${fromVersion} to v${toVersion}.`,
      );
    }

    let version = fromVersion;
    let migrated = [...wireBytes];
    while (version < toVersion) {
      const migration = this.migrations.get(version)!;
      migrated = migration.migrate(migrated);
      version = migration.toVersion;
    }
    return migrated;
  }

  clear(): void {
    this.migrations.clear();
  }
}
