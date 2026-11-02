import type {BushMeshRuntimeClock, BushMeshTimerHandle} from '../bushmesh/runtime/public';

/**
 * Integration-owned application clock for the canonical BushMesh runtime.
 * Keeping this adapter explicit makes runtime lifetime/test substitution a
 * composition concern rather than a screen/runtime implementation detail.
 */
export const radioCoreBushMeshRuntimeClock: BushMeshRuntimeClock = {
  now: () => Date.now(),
  setTimeout: (handler, delayMs): BushMeshTimerHandle =>
    setTimeout(handler, delayMs),
  clearTimeout: handle => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
