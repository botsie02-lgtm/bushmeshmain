import {
  BushMeshCompressionProfile,
  BushMeshPeerPolicy,
  BushMeshPriority,
} from '../protocol';

export type BushMeshPayloadKind =
  | 'text'
  | 'location'
  | 'telemetry'
  | 'command'
  | 'file'
  | 'sync'
  | 'distress';

export type BushMeshAdaptivePayloadDecision = {
  kind: BushMeshPayloadKind;
  transport: 'text-safe' | 'binary';
  compression: BushMeshCompressionProfile;
  allowFragmentation: boolean;
  allowSelectiveAck: boolean;
  allowStoreAndForward: boolean;
  priority: BushMeshPriority;
  reason: string;
};

/**
 * Centralises feature selection for a known peer. This prevents individual
 * runtime services from making subtly different assumptions about compression,
 * fragmentation or binary transport support.
 */
export class BushMeshAdaptivePayloadPolicy {
  decide(
    kind: BushMeshPayloadKind,
    peer: BushMeshPeerPolicy | null | undefined,
    options?: {
      preferSemanticText?: boolean;
      preferDelta?: boolean;
      allowExperimentalBinary?: boolean;
      storeAndForward?: boolean;
    },
  ): BushMeshAdaptivePayloadDecision {
    const compatible = peer?.compatible === true;
    const transport =
      compatible &&
      options?.allowExperimentalBinary === true &&
      peer?.transport === 'binary'
        ? 'binary'
        : 'text-safe';

    const priority = this.priorityFor(kind);
    let compression = BushMeshCompressionProfile.Raw;
    let reason = compatible
      ? 'Using mutually supported peer capabilities.'
      : 'Peer capabilities are unknown or incompatible; using conservative fallback.';

    if (compatible) {
      if (
        kind === 'text' &&
        options?.preferSemanticText !== false &&
        peer.allowSemantic
      ) {
        compression = BushMeshCompressionProfile.Semantic;
      } else if (kind === 'text' && peer.allowDictionary) {
        compression = BushMeshCompressionProfile.TextDictionary;
      } else if (
        kind === 'location' &&
        options?.preferDelta !== false &&
        peer.allowLocationDelta
      ) {
        compression = BushMeshCompressionProfile.Gps;
      } else if (kind === 'telemetry') {
        compression = BushMeshCompressionProfile.SensorDelta;
      } else if (kind === 'command') {
        compression = BushMeshCompressionProfile.Command;
      } else if (kind === 'file' || kind === 'sync') {
        compression = BushMeshCompressionProfile.CompressedBinary;
      }
    }

    if (kind === 'distress') {
      compression = BushMeshCompressionProfile.Raw;
      reason = 'Distress traffic uses deterministic raw schema and emergency priority.';
    }

    return {
      kind,
      transport,
      compression,
      allowFragmentation: compatible ? peer.allowFragmentation : false,
      allowSelectiveAck: compatible ? peer.allowSelectiveAck : false,
      allowStoreAndForward:
        options?.storeAndForward !== false &&
        (compatible ? peer.allowStoreAndForward : kind === 'distress'),
      priority,
      reason,
    };
  }

  private priorityFor(kind: BushMeshPayloadKind): BushMeshPriority {
    switch (kind) {
      case 'distress':
        return BushMeshPriority.Emergency;
      case 'text':
      case 'command':
        return BushMeshPriority.DirectMessage;
      case 'location':
        return BushMeshPriority.Location;
      case 'telemetry':
        return BushMeshPriority.Telemetry;
      case 'file':
      case 'sync':
      default:
        return BushMeshPriority.Background;
    }
  }
}
