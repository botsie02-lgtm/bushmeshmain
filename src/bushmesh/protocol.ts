/**
 * Integration compatibility barrel.
 *
 * Canonical protocol/runtime code historically imports `../protocol`, while
 * radio-core application code historically imported this flat module for the
 * pre-canonical position/quick-action packet set. TypeScript resolves a flat
 * file before the sibling `protocol/` directory, so this barrel deliberately
 * exposes the canonical protocol first and only the legacy-only symbols needed
 * during incremental migration.
 *
 * New integration code must use `protocol/public` or `runtime/public`.
 */
export * from './protocol/index';

export {
  BUSHMESH_MESHCORE_DEV_DATA_TYPE,
  BushMeshMessageType,
  BushMeshQuickActionCode,
  decodeBushMeshPosition,
  decodeBushMeshQuickAction,
  encodeBushMeshPosition,
  encodeBushMeshQuickAction,
} from './legacyProtocol';

export type {
  BushMeshIdentityRef,
  BushMeshPosition,
  DecodedBushMeshPosition,
  BushMeshQuickAction,
  DecodedBushMeshQuickAction,
} from './legacyProtocol';
