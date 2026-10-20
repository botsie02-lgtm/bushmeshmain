import {
  BUSHMESH_PROTOCOL_VERSION,
  BushMeshPacketType,
  DecodedBushMeshEnvelope,
  assertIntegerInRange,
} from './codec';

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

/**
 * The wire envelope allocates two version bits, therefore protocol versions are
 * intentionally limited to 0..3 unless a future outer framing revision expands
 * that field.
 */
export function negotiateBushMeshProtocolVersion(
  remoteMinVersion: number,
  remoteMaxVersion: number,
): BushMeshProtocolCompatibility {
  assertIntegerInRange(remoteMinVersion, 0, 3, 'Remote minimum protocol version');
  assertIntegerInRange(remoteMaxVersion, remoteMinVersion, 3, 'Remote maximum protocol version');

  const minimum = Math.max(
    BUSHMESH_MIN_SUPPORTED_PROTOCOL_VERSION,
    remoteMinVersion,
  );
  const maximum = Math.min(
    BUSHMESH_MAX_SUPPORTED_PROTOCOL_VERSION,
    remoteMaxVersion,
  );

  if (minimum > maximum) {
    return {
      compatible: false,
      negotiatedVersion: null,
      reason: `No overlapping BushMesh protocol version (local ${BUSHMESH_MIN_SUPPORTED_PROTOCOL_VERSION}-${BUSHMESH_MAX_SUPPORTED_PROTOCOL_VERSION}, remote ${remoteMinVersion}-${remoteMaxVersion}).`,
    };
  }

  return {
    compatible: true,
    negotiatedVersion: maximum,
    reason: `BushMesh protocol v${maximum} is mutually supported.`,
  };
}

/**
 * Packet type allocation for the six-bit type field.
 *
 * 0x00       invalid / never transmit
 * 0x01-0x0E current v1 core types
 * 0x0F-0x1F reserved for future standardized core types
 * 0x20-0x2F experimental BushMesh extensions; never release-critical by default
 * 0x30-0x3F vendor/private extensions; must be capability-gated
 */
export function classifyBushMeshPacketType(
  type: number,
): BushMeshPacketTypeClass {
  assertIntegerInRange(type, 0, 0x3f, 'BushMesh packet type');

  if (type === 0) {
    return BushMeshPacketTypeClass.Invalid;
  }

  if (type >= BushMeshPacketType.Message && type <= BushMeshPacketType.Routed) {
    return BushMeshPacketTypeClass.Core;
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
        `BushMesh packet type 0x${envelope.type.toString(16).padStart(2, '0')} is reserved for a future standardized extension.`,
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
 * intentionally explicit and one version step at a time; there is no implicit
 * "best effort" reinterpretation of an unknown wire schema.
 */
export class BushMeshProtocolMigrationRegistry {
  private readonly migrations = new Map<number, BushMeshProtocolMigration>();

  register(migration: BushMeshProtocolMigration): void {
    assertIntegerInRange(migration.fromVersion, 0, 3, 'Migration source version');
    assertIntegerInRange(migration.toVersion, 0, 3, 'Migration target version');

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
