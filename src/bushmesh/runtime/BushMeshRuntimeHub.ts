import {BushMeshNetworkRuntime} from './BushMeshNetworkRuntime';

let activeRuntime: BushMeshNetworkRuntime | null = null;

export function setActiveBushMeshRuntime(
  runtime: BushMeshNetworkRuntime | null,
): void {
  activeRuntime = runtime;
}

export function getActiveBushMeshRuntime(): BushMeshNetworkRuntime | null {
  return activeRuntime;
}

export async function acceptBushMeshMeshCoreFrame(
  bytes: number[],
  now = Date.now(),
): Promise<boolean> {
  if (!activeRuntime) {
    return false;
  }

  return activeRuntime.acceptMeshCoreFrame(bytes, now);
}
