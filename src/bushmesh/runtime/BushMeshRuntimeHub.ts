import {BushMeshNetworkRuntime} from './BushMeshNetworkRuntime';
import {
  clearMeshCorePublicKey,
  publishMeshCorePublicKey,
} from './BushMeshIdentityHub';

let activeRuntime: BushMeshNetworkRuntime | null = null;

export function setActiveBushMeshRuntime(
  runtime: BushMeshNetworkRuntime | null,
): void {
  activeRuntime = runtime;

  if (!runtime) {
    clearMeshCorePublicKey();
  }
}

export function getActiveBushMeshRuntime(): BushMeshNetworkRuntime | null {
  return activeRuntime;
}

function inspectMeshCoreIdentity(bytes: number[]): void {
  // MeshCore PACKET_SELF_INFO (0x05) carries the 32-byte public key at offset 4.
  if (bytes[0] !== 0x05 || bytes.length < 36) {
    return;
  }

  const publicKey = bytes
    .slice(4, 36)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

  publishMeshCorePublicKey(publicKey);
}

export async function acceptBushMeshMeshCoreFrame(
  bytes: number[],
  now = Date.now(),
): Promise<boolean> {
  inspectMeshCoreIdentity(bytes);

  if (!activeRuntime) {
    return false;
  }

  return activeRuntime.acceptMeshCoreFrame(bytes, now);
}
