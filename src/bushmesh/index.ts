/**
 * Canonical BushMesh package facade.
 *
 * Application layers should import from this module, `./protocol/public`, or
 * `./runtime/public`. MeshCore and other hardware integrations belong outside
 * the canonical BushMesh protocol/runtime surface.
 */
export * from './protocol/public';
export * from './runtime/public';

export * as BushMeshProtocol from './protocol/public';
export * as BushMeshRuntime from './runtime/public';
