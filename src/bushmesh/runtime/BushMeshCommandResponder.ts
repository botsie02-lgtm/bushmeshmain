import {
  BushMeshCompressionProfile,
  BushMeshControlCommand,
  BushMeshNodeHello,
  BushMeshPacketType,
  BushMeshPriority,
  BushMeshSyncNamespace,
  BushMeshTypedPacket,
  CompactLocation,
  LocationPrecision,
  createPong,
  encodeBushMeshNodeHelloWire,
  encodeBushMeshPingWire,
  encodeBushMeshSyncWire,
  encodeBushMeshWire,
  encodeLocationPayload,
} from '../protocol';
import {BushMeshSyncManager} from './BushMeshSyncManager';

export type BushMeshLocationSnapshot = {
  location: CompactLocation;
  capturedAtMs: number;
};

export type BushMeshCommandResponderDependencies = {
  localHello: () => BushMeshNodeHello;
  currentLocation?: () => BushMeshLocationSnapshot | null;
  syncManager?: BushMeshSyncManager;
  nextMessageId: () => number;
};

export type BushMeshCommandResponse = {
  kind: 'pong' | 'node-hello' | 'location' | 'sync-summary';
  wireBytes: number[];
};

export class BushMeshCommandResponder {
  constructor(private readonly dependencies: BushMeshCommandResponderDependencies) {}

  respond(
    packet: BushMeshTypedPacket,
    now = Date.now(),
  ): BushMeshCommandResponse[] {
    if (packet.kind === 'ping') {
      if (packet.value.response) {
        return [];
      }

      const pong = createPong(packet.value, Math.floor(now / 1000));
      return [
        {
          kind: 'pong',
          wireBytes: encodeBushMeshPingWire(
            pong,
            this.dependencies.nextMessageId(),
            false,
          ),
        },
      ];
    }

    if (packet.kind !== 'command') {
      return [];
    }

    switch (packet.value.command) {
      case BushMeshControlCommand.RequestNodeHello:
        return [
          {
            kind: 'node-hello',
            wireBytes: encodeBushMeshNodeHelloWire(
              this.dependencies.localHello(),
              this.dependencies.nextMessageId(),
            ),
          },
        ];

      case BushMeshControlCommand.RequestAbsoluteLocation:
        return this.locationResponse(LocationPrecision.Approx1M, undefined, now);

      case BushMeshControlCommand.RequestLocation:
        return this.locationResponse(
          packet.value.precision,
          packet.value.maxAgeSeconds,
          now,
        );

      case BushMeshControlCommand.RequestSync: {
        const manager = this.dependencies.syncManager;

        if (!manager) {
          return [];
        }

        const namespace = packet.value.namespace as BushMeshSyncNamespace;
        const summary = manager.createSummary(namespace);
        return [
          {
            kind: 'sync-summary',
            wireBytes: encodeBushMeshSyncWire(
              summary,
              this.dependencies.nextMessageId(),
            ),
          },
        ];
      }

      default:
        return [];
    }
  }

  private locationResponse(
    requestedPrecision: LocationPrecision | number,
    maxAgeSeconds: number | undefined,
    now: number,
  ): BushMeshCommandResponse[] {
    const snapshot = this.dependencies.currentLocation?.();

    if (!snapshot) {
      return [];
    }

    if (
      maxAgeSeconds !== undefined &&
      now - snapshot.capturedAtMs > maxAgeSeconds * 1000
    ) {
      return [];
    }

    const precision = Math.max(
      LocationPrecision.Approx1Km,
      Math.min(LocationPrecision.Approx1M, requestedPrecision),
    ) as LocationPrecision;
    const location: CompactLocation = {
      ...snapshot.location,
      precision,
    };

    return [
      {
        kind: 'location',
        wireBytes: encodeBushMeshWire({
          type: BushMeshPacketType.Location,
          priority: BushMeshPriority.Location,
          compression: BushMeshCompressionProfile.Gps,
          messageId: this.dependencies.nextMessageId(),
          ackRequested: false,
          payload: encodeLocationPayload(location),
        }),
      },
    ];
  }
}
