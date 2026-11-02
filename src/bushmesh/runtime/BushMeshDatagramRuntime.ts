import {BushMeshPriority, assertIntegerInRange} from '../protocol/codec';
import {
  BushMeshRecentMessageCache,
  BushMeshSeenMessageSnapshot,
} from '../protocol/messageIdentity';
import {
  BushMeshSecurityTrafficClass,
  bushMeshAuthenticatedHeadersEqual,
  createBushMeshSecurityProtocolContext,
  securityTreatmentFor,
} from '../protocol/securityBoundary';
import {
  DecodedBushMeshWireMessage,
  decodeBushMeshWire,
} from '../protocol/transport';
import {
  BushMeshTypedPacket,
  decodeBushMeshTypedPacket,
} from '../protocol/typedPackets';
import type {
  BushMeshInboundDatagram,
  BushMeshOutboundDatagram,
  BushMeshOutboundPriority,
  BushMeshRetryIntent,
  BushMeshRuntimeClock,
  BushMeshRuntimePersistence,
  BushMeshSecurityAdapter,
  BushMeshSecurityAssociation,
  BushMeshTransportAvailability,
  BushMeshTransportAvailabilityPort,
} from './integration';
import {systemBushMeshRuntimeClock} from './integration';

const DEDUP_SNAPSHOT_KEY = 'bushmesh.runtime.dedup.v1';
const DEDUP_SNAPSHOT_VERSION = 1;

type DedupSnapshot = {
  version: 1;
  entries: BushMeshSeenMessageSnapshot[];
};

export type BushMeshOutboundPreparationOptions = {
  channelIndex: number;
  dataType: number;
  transport: string;
  expiresAtMs?: number | null;
  retryIntent?: BushMeshRetryIntent;
  identityAssociation?: BushMeshSecurityAssociation;
  trafficClass?: BushMeshSecurityTrafficClass;
  label?: string;
};

export type BushMeshInboundAccepted = {
  status: 'accepted';
  datagram: BushMeshInboundDatagram;
  decoded: DecodedBushMeshWireMessage;
  typed: BushMeshTypedPacket;
  securityAssociation: BushMeshSecurityAssociation;
  protected: boolean;
};

export type BushMeshInboundDuplicate = {
  status: 'duplicate';
  datagram: BushMeshInboundDatagram;
  messageId: number;
};

export type BushMeshInboundRejected = {
  status: 'rejected';
  datagram: BushMeshInboundDatagram;
  reason:
    | 'malformed'
    | 'unsupported-version'
    | 'security-failed'
    | 'security-unavailable';
  error: string;
};

export type BushMeshInboundResult =
  | BushMeshInboundAccepted
  | BushMeshInboundDuplicate
  | BushMeshInboundRejected;

export type BushMeshDatagramRuntimeOptions = {
  clock?: BushMeshRuntimeClock;
  persistence?: BushMeshRuntimePersistence;
  security?: BushMeshSecurityAdapter;
  transportAvailability?: BushMeshTransportAvailabilityPort;
  dedupTtlMs?: number;
  dedupMaxEntries?: number;
  dedupSnapshotKey?: string;
};

function mapPriority(priority: number): BushMeshOutboundPriority {
  switch (priority) {
    case BushMeshPriority.Emergency:
      return 'safety';
    case BushMeshPriority.DirectMessage:
      return 'message';
    case BushMeshPriority.Location:
      return 'position';
    case BushMeshPriority.Telemetry:
      return 'control';
    case BushMeshPriority.Background:
    default:
      return 'bulk';
  }
}

function defaultRetryIntent(ackRequested: boolean): BushMeshRetryIntent {
  return ackRequested
    ? {mode: 'protocol-managed', maxTransportAttempts: 1}
    : {mode: 'none', maxTransportAttempts: 1};
}

function validateRetryIntent(intent: BushMeshRetryIntent): void {
  if (
    !Number.isInteger(intent.maxTransportAttempts) ||
    intent.maxTransportAttempts < 1 ||
    intent.maxTransportAttempts > 255
  ) {
    throw new Error(
      'BushMesh transport retry attempts must be an integer from 1 to 255.',
    );
  }
  if (
    intent.mode !== 'transport-retry' &&
    intent.maxTransportAttempts !== 1
  ) {
    throw new Error(
      'Protocol-managed/none retry intent must use one transport attempt.',
    );
  }
}

function validateAssociationForTraffic(
  trafficClass: BushMeshSecurityTrafficClass | undefined,
  association: BushMeshSecurityAssociation,
): void {
  if (!trafficClass) {
    return;
  }

  const treatment = securityTreatmentFor(trafficClass);
  if (treatment.requirement === 'unassigned-v1-control-schema') {
    throw new Error(
      `BushMesh v1 transport schema is not frozen for ${trafficClass}.`,
    );
  }
  if (
    treatment.requirement === 'required-direct-session' &&
    association.kind !== 'direct-session'
  ) {
    throw new Error(
      `${trafficClass} requires a direct-session security association.`,
    );
  }
  if (
    treatment.requirement === 'required-group' &&
    association.kind !== 'group'
  ) {
    throw new Error(`${trafficClass} requires a group security association.`);
  }
}

function classifyDecodeError(error: unknown): BushMeshInboundRejected['reason'] {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Unsupported BushMesh protocol version')
    ? 'unsupported-version'
    : 'malformed';
}

function assertFiniteOptional(value: number | undefined, label: string): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`${label} must be finite when supplied.`);
  }
}

function validateInboundDatagram(datagram: BushMeshInboundDatagram): void {
  assertIntegerInRange(datagram.channelIndex, 0, 0xffffffff, 'Channel index');
  assertIntegerInRange(datagram.dataType, 0, 0xffff, 'Datagram data type');
  if (!Number.isFinite(datagram.receivedAtMs) || datagram.receivedAtMs < 0) {
    throw new Error('Received timestamp must be a non-negative finite number.');
  }
  if (!datagram.transport.trim()) {
    throw new Error('Inbound transport discriminator cannot be empty.');
  }
  if (datagram.sourceNodeId !== undefined) {
    assertIntegerInRange(datagram.sourceNodeId, 0, 0xffffffff, 'Source node ID');
  }
  assertFiniteOptional(datagram.link?.rssiDbm, 'RSSI');
  assertFiniteOptional(datagram.link?.snrDb, 'SNR');
  assertFiniteOptional(datagram.link?.pathLength, 'Path length');
  if (
    datagram.link?.pathLength !== undefined &&
    (!Number.isInteger(datagram.link.pathLength) || datagram.link.pathLength < 0)
  ) {
    throw new Error('Path length must be a non-negative integer when supplied.');
  }
}

function malformedInbound(
  datagram: BushMeshInboundDatagram,
  error: unknown,
): BushMeshInboundRejected {
  return {
    status: 'rejected',
    datagram,
    reason: 'malformed',
    error:
      error instanceof Error ? error.message : 'Malformed BushMesh datagram.',
  };
}

/**
 * Canonical protocol/runtime seam. This class does not send radio packets and
 * does not import MeshCore or radio-core. It prepares opaque outbound datagrams
 * and accepts opaque inbound datagrams supplied by an application adapter.
 */
export class BushMeshDatagramRuntime {
  private readonly clock: BushMeshRuntimeClock;
  private readonly persistence?: BushMeshRuntimePersistence;
  private readonly security?: BushMeshSecurityAdapter;
  private readonly availability?: BushMeshTransportAvailabilityPort;
  private readonly recentMessages: BushMeshRecentMessageCache;
  private readonly dedupSnapshotKey: string;
  private initialized = false;

  constructor(options: BushMeshDatagramRuntimeOptions = {}) {
    this.clock = options.clock ?? systemBushMeshRuntimeClock;
    this.persistence = options.persistence;
    this.security = options.security;
    this.availability = options.transportAvailability;
    this.recentMessages = new BushMeshRecentMessageCache(
      options.dedupTtlMs,
      options.dedupMaxEntries,
    );
    this.dedupSnapshotKey = options.dedupSnapshotKey ?? DEDUP_SNAPSHOT_KEY;
  }

  async initialize(): Promise<number> {
    if (this.initialized) {
      return this.recentMessages.size();
    }

    if (!this.persistence) {
      this.initialized = true;
      return 0;
    }

    const stored = await this.persistence.getItem(this.dedupSnapshotKey);
    if (!stored) {
      this.initialized = true;
      return 0;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error(
        'Stored BushMesh runtime dedup snapshot is not valid JSON.',
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error(
        'Stored BushMesh runtime dedup snapshot has invalid shape.',
      );
    }
    const snapshot = parsed as Partial<DedupSnapshot>;
    if (
      snapshot.version !== DEDUP_SNAPSHOT_VERSION ||
      !Array.isArray(snapshot.entries)
    ) {
      throw new Error('Unsupported BushMesh runtime dedup snapshot.');
    }

    const restored = this.recentMessages.restore(
      snapshot.entries as BushMeshSeenMessageSnapshot[],
      this.clock.now(),
      true,
    );
    this.initialized = true;
    return restored;
  }

  transportAvailability(): BushMeshTransportAvailability | null {
    const value = this.availability?.getAvailability();
    return value ? {...value} : null;
  }

  async prepareOutbound(
    wireBytes: number[] | Uint8Array,
    options: BushMeshOutboundPreparationOptions,
  ): Promise<BushMeshOutboundDatagram> {
    assertIntegerInRange(options.channelIndex, 0, 0xffffffff, 'Channel index');
    assertIntegerInRange(options.dataType, 0, 0xffff, 'Datagram data type');
    if (!options.transport.trim()) {
      throw new Error(
        'BushMesh outbound transport discriminator cannot be empty.',
      );
    }

    const plainBytes = Array.from(wireBytes);
    const decoded = decodeBushMeshWire(plainBytes);
    const now = this.clock.now();
    const expiresAtMs = options.expiresAtMs ?? null;
    if (
      expiresAtMs !== null &&
      (!Number.isFinite(expiresAtMs) || expiresAtMs < now)
    ) {
      throw new Error(
        'BushMesh outbound expiry must be null or a future timestamp.',
      );
    }

    const retryIntent =
      options.retryIntent ?? defaultRetryIntent(decoded.envelope.ackRequested);
    validateRetryIntent(retryIntent);

    const association = options.identityAssociation ?? {kind: 'none' as const};
    validateAssociationForTraffic(options.trafficClass, association);

    let payload = Uint8Array.from(plainBytes);
    let protectedPayload = false;

    if (association.kind !== 'none') {
      if (!options.trafficClass) {
        throw new Error(
          'Protected BushMesh traffic requires an explicit traffic class.',
        );
      }
      if (!this.security) {
        throw new Error(
          'BushMesh security adapter is required for protected traffic.',
        );
      }
      const context = createBushMeshSecurityProtocolContext(plainBytes);
      const result = await this.security.protect({
        plaintextWireBytes: Uint8Array.from(plainBytes),
        context,
        association,
        trafficClass: options.trafficClass,
      });
      payload = Uint8Array.from(result.datagramPayload);
      protectedPayload = true;
    }

    const availability = this.transportAvailability();
    return {
      channelIndex: options.channelIndex,
      dataType: options.dataType,
      payload,
      transport: options.transport,
      priority: mapPriority(decoded.envelope.priority),
      createdAtMs: now,
      expiresAtMs,
      retryIntent,
      identityAssociation: association,
      diagnostics: {
        protocolVersion: decoded.envelope.version,
        packetType: decoded.envelope.type,
        messageId: decoded.envelope.messageId,
        protected: protectedPayload,
        label:
          options.label ??
          `BushMesh packet ${decoded.envelope.type} message ${decoded.envelope.messageId}`,
        transportAvailable:
          availability?.transport === options.transport
            ? availability.available
            : undefined,
      },
    };
  }

  async acceptInbound(
    datagram: BushMeshInboundDatagram,
  ): Promise<BushMeshInboundResult> {
    try {
      validateInboundDatagram(datagram);
    } catch (error) {
      return malformedInbound(datagram, error);
    }

    let wireBytes: number[];
    let association: BushMeshSecurityAssociation = {kind: 'none'};
    let protectedPayload = false;

    if (datagram.securityProtected) {
      if (!this.security) {
        return {
          status: 'rejected',
          datagram,
          reason: 'security-unavailable',
          error: 'BushMesh security adapter is not configured.',
        };
      }

      try {
        const unprotected = await this.security.unprotect({
          datagramPayload: Uint8Array.from(datagram.payload),
          channelIndex: datagram.channelIndex,
          dataType: datagram.dataType,
          transport: datagram.transport,
          receivedAtMs: datagram.receivedAtMs,
        });
        wireBytes = Array.from(unprotected.plaintextWireBytes);
        const expectedContext = createBushMeshSecurityProtocolContext(wireBytes);
        if (
          !bushMeshAuthenticatedHeadersEqual(
            expectedContext.authenticatedHeader,
            unprotected.authenticatedHeader,
          )
        ) {
          throw new Error(
            'Security adapter authenticated a non-canonical BushMesh header.',
          );
        }
        association = unprotected.association;
        protectedPayload = true;
      } catch (error) {
        return {
          status: 'rejected',
          datagram,
          reason: 'security-failed',
          error:
            error instanceof Error
              ? error.message
              : 'BushMesh security verification failed.',
        };
      }
    } else {
      wireBytes = Array.from(datagram.payload);
    }

    let decoded: DecodedBushMeshWireMessage;
    let typed: BushMeshTypedPacket;
    try {
      decoded = decodeBushMeshWire(wireBytes);
      typed = decodeBushMeshTypedPacket(wireBytes);
    } catch (error) {
      return {
        status: 'rejected',
        datagram,
        reason: classifyDecodeError(error),
        error:
          error instanceof Error
            ? error.message
            : 'BushMesh datagram decode failed.',
      };
    }

    if (datagram.sourceNodeId !== undefined) {
      const identity = {
        sourceNodeId: datagram.sourceNodeId,
        messageId: decoded.envelope.messageId,
      };
      if (
        this.recentMessages.checkAndRemember(identity, datagram.receivedAtMs)
      ) {
        return {
          status: 'duplicate',
          datagram,
          messageId: decoded.envelope.messageId,
        };
      }
      await this.persistDedup();
    }

    return {
      status: 'accepted',
      datagram,
      decoded,
      typed,
      securityAssociation: association,
      protected: protectedPayload,
    };
  }

  async flush(): Promise<void> {
    await this.persistDedup();
  }

  private async persistDedup(): Promise<void> {
    if (!this.persistence) {
      return;
    }
    const snapshot: DedupSnapshot = {
      version: DEDUP_SNAPSHOT_VERSION,
      entries: this.recentMessages.snapshot(this.clock.now()),
    };
    await this.persistence.setItem(
      this.dedupSnapshotKey,
      JSON.stringify(snapshot),
    );
  }
}
