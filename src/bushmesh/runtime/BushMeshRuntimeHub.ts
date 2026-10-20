import {decodeBushMeshTypedPacket} from '../protocol';
import {tryDecodeBushMeshChannelFrame} from '../../meshcore/meshcoreBushMeshBridge';
import {BushMeshNetworkRuntime} from './BushMeshNetworkRuntime';
import {
  publishBushMeshDistressAlert,
  publishBushMeshPeerLocation,
} from './BushMeshLiveStateHub';
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

function inspectBushMeshLiveState(bytes: number[], now: number): void {
  try {
    const channelFrame = tryDecodeBushMeshChannelFrame(bytes);
    if (!channelFrame) {
      return;
    }

    const outer = decodeBushMeshTypedPacket(channelFrame.decoded.wireBytes);
    if (outer.kind !== 'routed') {
      return;
    }

    const sourceNodeId = outer.value.sourceNodeId;
    const inner = decodeBushMeshTypedPacket(outer.value.innerWireBytes);

    if (inner.kind === 'location') {
      publishBushMeshPeerLocation({
        nodeId: sourceNodeId,
        channelIndex: channelFrame.channelIndex,
        latitude: inner.value.latitude,
        longitude: inner.value.longitude,
        precision: inner.value.precision,
        batteryPercent: inner.value.batteryPercent,
        receivedAt: now,
      });
      return;
    }

    if (inner.kind === 'distress') {
      publishBushMeshDistressAlert({
        key: `${sourceNodeId}:${channelFrame.decoded.envelope.messageId}`,
        nodeId: sourceNodeId,
        channelIndex: channelFrame.channelIndex,
        messageId: channelFrame.decoded.envelope.messageId,
        type: inner.value.type,
        latitude: inner.value.location?.latitude,
        longitude: inner.value.location?.longitude,
        precision: inner.value.location?.precision,
        batteryPercent: inner.value.batteryPercent,
        receivedAt: now,
      });
    }
  } catch {
    // Live-state extraction is best-effort and must never interfere with normal
    // MeshCore parsing or the main BushMesh reliability/runtime pipeline.
  }
}

export async function acceptBushMeshMeshCoreFrame(
  bytes: number[],
  now = Date.now(),
): Promise<boolean> {
  inspectMeshCoreIdentity(bytes);
  inspectBushMeshLiveState(bytes, now);

  if (!activeRuntime) {
    return false;
  }

  return activeRuntime.acceptMeshCoreFrame(bytes, now);
}
