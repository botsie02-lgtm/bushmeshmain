import {
  BushMeshCompressionProfile,
  BushMeshLocationDeltaDecoder,
  BushMeshLocationDeltaEncoder,
  BushMeshPacketType,
  BushMeshPriority,
  CompactLocation,
  DecodedBushMeshWireMessage,
  decodeLocationPayload,
  encodeBushMeshWire,
} from '../protocol';

export type BushMeshPreparedLocationUpdate = {
  messageId: number;
  mode: 'absolute' | 'delta';
  location: CompactLocation;
  wireBytes: number[];
};

export type BushMeshReceivedLocationUpdate =
  | {
      accepted: true;
      mode: 'absolute' | 'delta';
      location: CompactLocation;
      needsAbsolute: false;
    }
  | {
      accepted: false;
      mode: 'delta';
      location?: never;
      needsAbsolute: true;
    };

export class BushMeshLocationPublisher {
  private readonly encoder: BushMeshLocationDeltaEncoder;

  constructor(options?: {absoluteEvery?: number; maxDeltaMetres?: number}) {
    this.encoder = new BushMeshLocationDeltaEncoder(
      options?.absoluteEvery,
      options?.maxDeltaMetres,
    );
  }

  prepare(
    location: CompactLocation,
    messageId: number,
    options?: {
      forceAbsolute?: boolean;
      ackRequested?: boolean;
    },
  ): BushMeshPreparedLocationUpdate {
    const update = this.encoder.encode(
      location,
      options?.forceAbsolute ?? false,
    );

    return {
      messageId,
      mode: update.mode,
      location: {...update.location},
      wireBytes: encodeBushMeshWire({
        type: BushMeshPacketType.Location,
        priority: BushMeshPriority.Location,
        compression:
          update.mode === 'absolute'
            ? BushMeshCompressionProfile.Gps
            : BushMeshCompressionProfile.SensorDelta,
        messageId,
        ackRequested: options?.ackRequested ?? false,
        payload: [...update.payload],
      }),
    };
  }

  reset(): void {
    this.encoder.reset();
  }
}

export class BushMeshLocationReceiver {
  private readonly decoders = new Map<number, BushMeshLocationDeltaDecoder>();

  accept(
    sourceNodeId: number,
    wire: DecodedBushMeshWireMessage,
  ): BushMeshReceivedLocationUpdate {
    if (wire.envelope.type !== BushMeshPacketType.Location) {
      throw new Error('BushMesh location receiver requires a LOCATION packet.');
    }

    let decoder = this.decoders.get(sourceNodeId);
    if (!decoder) {
      decoder = new BushMeshLocationDeltaDecoder();
      this.decoders.set(sourceNodeId, decoder);
    }

    if (wire.envelope.compression === BushMeshCompressionProfile.Gps) {
      const absolute = decodeLocationPayload(wire.envelope.payload);
      const location = decoder.acceptAbsolute({
        latitude: absolute.latitude,
        longitude: absolute.longitude,
        precision: absolute.precision,
        batteryPercent: absolute.batteryPercent ?? undefined,
      });
      return {
        accepted: true,
        mode: 'absolute',
        location,
        needsAbsolute: false,
      };
    }

    if (
      wire.envelope.compression === BushMeshCompressionProfile.SensorDelta
    ) {
      try {
        return {
          accepted: true,
          mode: 'delta',
          location: decoder.acceptDelta(wire.envelope.payload),
          needsAbsolute: false,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('before an absolute location')
        ) {
          return {
            accepted: false,
            mode: 'delta',
            needsAbsolute: true,
          };
        }
        throw error;
      }
    }

    throw new Error(
      `Unsupported BushMesh LOCATION compression profile ${wire.envelope.compression}.`,
    );
  }

  current(sourceNodeId: number): CompactLocation | null {
    return this.decoders.get(sourceNodeId)?.current() ?? null;
  }

  resetSource(sourceNodeId: number): void {
    this.decoders.delete(sourceNodeId);
  }

  clear(): void {
    this.decoders.clear();
  }
}
