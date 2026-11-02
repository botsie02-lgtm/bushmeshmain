import {
  BushMeshSyncNamespace,
  scoreBushMeshNeighbor,
} from '../protocol';
import {BushMeshNodeRuntime} from './BushMeshNodeRuntime';

export type BushMeshPeerDiagnostic = {
  nodeId: number;
  role: number;
  lastSeenAt: number;
  compatible: boolean;
  transport: 'text-safe' | 'binary';
  batteryPercent?: number;
  rssi?: number;
  snr?: number;
  hopCount?: number;
  linkScore?: number;
};

export type BushMeshNodeDiagnostics = {
  running: boolean;
  localNodeId: number | null;
  protocolVersion: number | null;
  network: ReturnType<BushMeshNodeRuntime['network']['stats']>;
  peerCount: number;
  peers: BushMeshPeerDiagnostic[];
  activeIncomingFileTransfers: number[];
  activeOutgoingFileTransfers: number[];
  syncGenerations: {
    messages: number;
    contacts: number;
    channels: number;
    mapMarkers: number;
    configuration: number;
  };
};

export function buildBushMeshDiagnostics(
  runtime: BushMeshNodeRuntime,
  now = Date.now(),
): BushMeshNodeDiagnostics {
  const local = runtime.localHello();
  const peers = runtime.peers()?.all(now) ?? [];

  return {
    running: runtime.isRunning(),
    localNodeId: local?.nodeId ?? null,
    protocolVersion: local?.protocolMaxVersion ?? null,
    network: runtime.network.stats(),
    peerCount: peers.length,
    peers: peers.map(peer => ({
      nodeId: peer.nodeId,
      role: peer.hello.role,
      lastSeenAt: peer.lastSeenAt,
      compatible: peer.policy.compatible,
      transport: peer.policy.transport,
      batteryPercent: peer.hello.batteryPercent,
      rssi: peer.neighbor?.smoothedRssi,
      snr: peer.neighbor?.smoothedSnr,
      hopCount: peer.neighbor?.hopCount,
      linkScore: peer.neighbor
        ? scoreBushMeshNeighbor(peer.neighbor, now)
        : undefined,
    })),
    activeIncomingFileTransfers: runtime.files.activeIncomingTransferIds(),
    activeOutgoingFileTransfers: runtime.files.activeOutgoingTransferIds(),
    syncGenerations: {
      messages: runtime.sync.generation(BushMeshSyncNamespace.Messages),
      contacts: runtime.sync.generation(BushMeshSyncNamespace.Contacts),
      channels: runtime.sync.generation(BushMeshSyncNamespace.Channels),
      mapMarkers: runtime.sync.generation(BushMeshSyncNamespace.MapMarkers),
      configuration: runtime.sync.generation(BushMeshSyncNamespace.Configuration),
    },
  };
}
