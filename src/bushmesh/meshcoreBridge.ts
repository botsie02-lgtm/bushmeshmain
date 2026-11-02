import {BushMeshInboundMetadata} from './inboundBus';
import {MeshCoreChannelDataFrame} from '../meshcore/meshcoreChannelData';
import {meshCoreFrameToReceivedDatagram} from '../meshcore/MeshCoreReceivedDatagramAdapter';
import {
  BushMeshInboundMessage,
  legacyBushMeshInboundAdapter,
} from '../radio/LegacyBushMeshInboundAdapter';

export type {BushMeshInboundMessage} from '../radio/LegacyBushMeshInboundAdapter';

/**
 * Legacy compatibility facade for callers/tests that still hand MeshCore frames
 * directly to the old BushMesh decoder. New radio lifecycle code must publish
 * ReceivedDatagram instead and let a runtime/compatibility subscriber consume it.
 */
export function decodeBushMeshMeshCoreFrame(
  frame: MeshCoreChannelDataFrame,
  metadata?: Partial<BushMeshInboundMetadata>,
): BushMeshInboundMessage | null {
  return legacyBushMeshInboundAdapter.consume(
    meshCoreFrameToReceivedDatagram(frame, {
      receivedAtMs: metadata?.receivedAtMs,
      source: metadata?.source,
    }),
  );
}
