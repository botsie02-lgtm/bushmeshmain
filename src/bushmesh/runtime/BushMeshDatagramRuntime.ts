import {
  BushMeshPacketType,
  BushMeshPriority,
  assertIntegerInRange,
} from '../protocol/codec';
import {
  BushMeshRecentMessageCache,
  BushMeshSeenMessageSnapshot,
} from '../protocol/messageIdentity';
import {
  BushMeshEmergencySecurityPolicy,
  BushMeshSecurityTrafficClass,
  bushMeshAuthenticatedHeadersEqual,
  createBushMeshSecurityProtocolContext,
  securityTreatmentFor,
} from '../protocol/securityBoundary';
import {
  BushMeshDecodedProtectedSecurityContainer,
  BushMeshDecodedSecurityContainer,
  BushMeshDecodedSecurityControlContainer,
  BushMeshSecurityRoutingContext,
  classifyBushMeshDatagramPayload,
  decodeBushMeshSecurityContainer,
  encodeBushMeshProtectedDirectContainer,
  encodeBushMeshProtectedGroupContainer,
} from '../protocol/securityWire';
import {
  BushMeshDatagramFragmentReassembler,
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
  securityRouting?: BushMeshSecurityRoutingContext;
  emergencySecurityPolicy?: BushMeshEmergencySecurityPolicy;
  label?: string;
};

export type BushMeshSecurityControlOutboundOptions = {
  channelIndex: number;
  dataType: number;
  transport: string;
  expiresAtMs?: number | null;
  retryIntent?: BushMeshRetryIntent;
  identityAssociation?: BushMeshSecurityAssociation;
  label?: string;
};

export type BushMeshInboundProtocolAccepted = {
  status: 'accepted';
  kind: 'protocol';
  datagram: BushMeshInboundDatagram;
  decoded: DecodedBushMeshWireMessage;
  typed: BushMeshTypedPacket;
  securityAssociation: BushMeshSecurityAssociation;
  securityRouting?: BushMeshSecurityRoutingContext;
  protected: boolean;
  securityMode:
    | 'plain'
    | 'protected-direct'
    | 'protected-group'
    | 'unauthenticated-emergency-fallback';
};

export type BushMeshInboundSecurityControlAccepted = {
  status: 'accepted';
  kind: 'security-control';
  datagram: BushMeshInboundDatagram;
  control: BushMeshDecodedSecurityControlContainer;
};

export type BushMeshInboundAccepted =
  | BushMeshInboundProtocolAccepted
  | BushMeshInboundSecurityControlAccepted;

export type BushMeshInboundFragmentPending = {
  status: 'fragment-pending';
  datagram: BushMeshInboundDatagram;
  messageId: number;
  missingFragments: number[];
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
    | 'security-unavailable'
    | 'security-required';
  error: string;
};

export type BushMeshInboundResult =
  | BushMeshInboundAccepted
  | BushMeshInboundFragmentPending
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
  fragmentTimeoutMs?: number;
  emergencySecurityPolicy?: BushMeshEmergencySecurityPolicy;
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

function validateCarrierOptions(options: {
  channelIndex: number;
  dataType: number;
  transport: string;
}): void {
  assertIntegerInRange(options.channelIndex, 0, 0xffffffff, 'Channel index');
  assertIntegerInRange(options.dataType, 0, 0xffff, 'Datagram data type');
  if (!options.transport.trim()) {
    throw new Error('BushMesh transport discriminator cannot be empty.');
  }
}

function validateExpiry(expiresAtMs: number | null, now: number): void {
  if (
    expiresAtMs !== null &&
    (!Number.isFinite(expiresAtMs) || expiresAtMs < now)
  ) {
    throw new Error(
      'BushMesh outbound expiry must be null or a future timestamp.',
    );
  }
}

function inferTrafficClass(
  decoded: DecodedBushMeshWireMessage,
  explicit?: BushMeshSecurityTrafficClass,
): BushMeshSecurityTrafficClass | undefined {
  if (explicit) {
    return explicit;
  }
  if (decoded.envelope.type === BushMeshPacketType.Convoy) {
    return 'convoy-group';
  }
  if (decoded.envelope.type === BushMeshPacketType.Distress) {
    return 'emergency-distress';
  }
  return undefined;
}

function validateAssociationForTraffic(
  trafficClass: BushMeshSecurityTrafficClass | undefined,
  association: BushMeshSecurityAssociation,
): void {
  if (!trafficClass) {
    if (association.kind !== 'none') {
      throw new Error(
        'Protected BushMesh traffic requires an explicit or packet-implied traffic class.',
      );
    }
    return;
  }

  const treatment = securityTreatmentFor(trafficClass);
  if (treatment.requirement === 'security-control-container') {
    throw new Error(
      `${trafficClass} must use a dedicated BushMesh Security v1 control container.`,
    );
  }
  if (treatment.requirement === 'local-only') {
    throw new Error(`${trafficClass} is local-only in BushMesh Protocol v1.`);
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

function validateRoutingForAssociation(
  association: BushMeshSecurityAssociation,
  routing: BushMeshSecurityRoutingContext,
): void {
  if (association.kind === 'direct-session') {
    if (
      routing.sourceNodeId === undefined ||
      routing.destinationNodeId === undefined ||
      routing.groupId !== undefined
    ) {
      throw new Error(
        'Protected direct traffic requires authenticated source/destination node IDs and no group ID.',
      );
    }
    return;
  }
  if (association.kind === 'group') {
    if (
      routing.sourceNodeId === undefined ||
      routing.destinationNodeId !== undefined ||
      routing.groupId !== association.groupId
    ) {
      throw new Error(
        'Protected group traffic requires authenticated source/group IDs, no destination node ID, and a group ID matching the Security association.',
      );
    }
    return;
  }
  throw new Error(
    'Protected BushMesh payload traffic requires a direct-session or group association.',
  );
}

function classifyDecodeError(error: unknown): BushMeshInboundRejected['reason'] {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Unsupported') && message.includes('version')
    ? 'unsupported-version'
    : 'malformed';
}

function assertFiniteOptional(value: number | undefined, label: string): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`${label} must be finite when supplied.`);
  }
}

function validateInboundDatagram(datagram: BushMeshInboundDatagram): void {
  validateCarrierOptions(datagram);
  if (!Number.isFinite(datagram.receivedAtMs) || datagram.receivedAtMs < 0) {
    throw new Error('Received timestamp must be a non-negative finite number.');
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

function rejected(
  datagram: BushMeshInboundDatagram,
  reason: BushMeshInboundRejected['reason'],
  error: unknown,
): BushMeshInboundRejected {
  return {
    status: 'rejected',
    datagram,
    reason,
    error:
      error instanceof Error ? error.message : String(error || 'BushMesh error'),
  };
}

function malformedInbound(
  datagram: BushMeshInboundDatagram,
  error: unknown,
): BushMeshInboundRejected {
  return rejected(datagram, classifyDecodeError(error), error);
}

function isSecurityControlContainer(
  container: BushMeshDecodedSecurityContainer,
): container is BushMeshDecodedSecurityControlContainer {
  return (
    container.kind !== 'protected-direct' &&
    container.kind !== 'protected-group'
  );
}

function protectedProtocolVersion(
  container: BushMeshDecodedProtectedSecurityContainer,
): number {
  return container.protectedPayload.message.protocolVersion;
}

function validateUnprotectedAssociation(
  container: BushMeshDecodedProtectedSecurityContainer,
  association: BushMeshSecurityAssociation,
): void {
  if (container.kind === 'protected-direct') {
    if (container.protectedPayload.kind !== 'direct') {
      throw new Error('Protected-direct container/object kind mismatch.');
    }
    const message = container.protectedPayload.message;
    if (
      association.kind !== 'direct-session' ||
      association.sessionId !== message.sessionId
    ) {
      throw new Error(
        'Security adapter returned a direct-session association that does not match the protected direct object.',
      );
    }
    return;
  }

  if (container.protectedPayload.kind !== 'group') {
    throw new Error('Protected-group container/object kind mismatch.');
  }
  const message = container.protectedPayload.message;
  if (
    association.kind !== 'group' ||
    association.groupId !== message.groupId
  ) {
    throw new Error(
      'Security adapter returned a group association that does not match the protected group object.',
    );
  }
}

/**
 * Canonical protocol/runtime seam. It does not send radio packets and imports
 * neither radio-core nor MeshCore. Radio adapters hand it opaque datagrams.
 * BushMesh owns classification, fragmentation, Security dispatch and decode.
 */
export class BushMeshDatagramRuntime {
  private readonly clock: BushMeshRuntimeClock;
  private readonly persistence?: BushMeshRuntimePersistence;
  private readonly security?: BushMeshSecurityAdapter;
  private readonly availability?: BushMeshTransportAvailabilityPort;
  private readonly recentMessages: BushMeshRecentMessageCache;
  private readonly fragments: BushMeshDatagramFragmentReassembler;
  private readonly dedupSnapshotKey: string;
  private readonly emergencySecurityPolicy: BushMeshEmergencySecurityPolicy;
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
    this.fragments = new BushMeshDatagramFragmentReassembler(
      options.fragmentTimeoutMs,
    );
    this.dedupSnapshotKey = options.dedupSnapshotKey ?? DEDUP_SNAPSHOT_KEY;
    this.emergencySecurityPolicy =
      options.emergencySecurityPolicy ?? 'require-authentication';
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
    validateCarrierOptions(options);
    const plainBytes = Array.from(wireBytes);
    const decoded = decodeBushMeshWire(plainBytes);
    const now = this.clock.now();
    const expiresAtMs = options.expiresAtMs ?? null;
    validateExpiry(expiresAtMs, now);

    const retryIntent =
      options.retryIntent ?? defaultRetryIntent(decoded.envelope.ackRequested);
    validateRetryIntent(retryIntent);

    const trafficClass = inferTrafficClass(decoded, options.trafficClass);
    const association = options.identityAssociation ?? {kind: 'none' as const};
    validateAssociationForTraffic(trafficClass, association);

    if (trafficClass && trafficClass !== 'emergency-distress') {
      const treatment = securityTreatmentFor(trafficClass);
      if (
        treatment.packetType !== null &&
        treatment.packetType !== decoded.envelope.type
      ) {
        throw new Error(
          `${trafficClass} does not match BushMesh packet type ${decoded.envelope.type}.`,
        );
      }
    }

    const emergencyPolicy =
      options.emergencySecurityPolicy ?? this.emergencySecurityPolicy;
    let payload = Uint8Array.from(plainBytes);
    let securityMode:
      | 'plain'
      | 'protected-direct'
      | 'protected-group'
      | 'unauthenticated-emergency-fallback' = 'plain';

    if (trafficClass === 'emergency-distress' && association.kind === 'none') {
      if (emergencyPolicy !== 'allow-unauthenticated-fallback') {
        throw new Error(
          'Unauthenticated BushMesh distress is forbidden by the active Security v1 emergency policy.',
        );
      }
      securityMode = 'unauthenticated-emergency-fallback';
    } else if (association.kind !== 'none') {
      if (!trafficClass) {
        throw new Error('Protected BushMesh traffic requires a traffic class.');
      }
      if (!this.security) {
        throw new Error(
          'BushMesh security adapter is required for protected traffic.',
        );
      }

      const routing = options.securityRouting ?? {};
      validateRoutingForAssociation(association, routing);
      const context = createBushMeshSecurityProtocolContext(plainBytes, routing);
      const result = await this.security.protect({
        plaintextWireBytes: Uint8Array.from(plainBytes),
        context,
        routing,
        association,
        trafficClass,
      });

      if (association.kind === 'direct-session') {
        if (
          result.protectedPayload.kind !== 'direct' ||
          result.protectedPayload.message.sessionId !== association.sessionId ||
          result.protectedPayload.message.protocolVersion !==
            decoded.envelope.version
        ) {
          throw new Error(
            'Security adapter returned a protected direct object inconsistent with the requested session/protocol version.',
          );
        }
        payload = Uint8Array.from(
          encodeBushMeshProtectedDirectContainer({
            routing: {
              sourceNodeId: routing.sourceNodeId!,
              destinationNodeId: routing.destinationNodeId!,
            },
            authenticatedHeader: context.authenticatedHeader,
            message: result.protectedPayload.message,
          }),
        );
        securityMode = 'protected-direct';
      } else if (association.kind === 'group') {
        if (
          result.protectedPayload.kind !== 'group' ||
          result.protectedPayload.message.groupId !== association.groupId ||
          result.protectedPayload.message.protocolVersion !==
            decoded.envelope.version
        ) {
          throw new Error(
            'Security adapter returned a protected group object inconsistent with the requested group/protocol version.',
          );
        }
        payload = Uint8Array.from(
          encodeBushMeshProtectedGroupContainer({
            routing: {
              sourceNodeId: routing.sourceNodeId!,
              groupId: routing.groupId!,
            },
            authenticatedHeader: context.authenticatedHeader,
            message: result.protectedPayload.message,
          }),
        );
        securityMode = 'protected-group';
      } else {
        throw new Error(
          'Identity-only associations cannot protect direct/group BushMesh payloads.',
        );
      }
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
        wireKind: 'protocol',
        protocolVersion: decoded.envelope.version,
        packetType: decoded.envelope.type,
        messageId: decoded.envelope.messageId,
        protected:
          securityMode === 'protected-direct' ||
          securityMode === 'protected-group',
        securityMode,
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

  prepareSecurityControlOutbound(
    containerBytes: number[] | Uint8Array,
    options: BushMeshSecurityControlOutboundOptions,
  ): BushMeshOutboundDatagram {
    validateCarrierOptions(options);
    const now = this.clock.now();
    const expiresAtMs = options.expiresAtMs ?? null;
    validateExpiry(expiresAtMs, now);
    const retryIntent =
      options.retryIntent ?? ({mode: 'none', maxTransportAttempts: 1} as const);
    validateRetryIntent(retryIntent);

    const decoded = decodeBushMeshSecurityContainer(containerBytes);
    if (!isSecurityControlContainer(decoded)) {
      throw new Error(
        'Protected direct/group payloads must be prepared from plaintext through prepareOutbound().',
      );
    }

    const availability = this.transportAvailability();
    return {
      channelIndex: options.channelIndex,
      dataType: options.dataType,
      payload: Uint8Array.from(containerBytes),
      transport: options.transport,
      priority: 'control',
      createdAtMs: now,
      expiresAtMs,
      retryIntent,
      identityAssociation: options.identityAssociation ?? {kind: 'none'},
      diagnostics: {
        wireKind: 'security-control',
        securityContainerKind: decoded.kindId,
        protected: false,
        securityMode: 'security-control',
        label: options.label ?? `BushMesh Security control ${decoded.kind}`,
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

    let logicalDatagram = datagram;
    let classification;
    try {
      classification = classifyBushMeshDatagramPayload(datagram.payload);
      if (classification.kind === 'ordinary-bushmesh') {
        const decodedOuter = decodeBushMeshWire(Array.from(datagram.payload));
        if (decodedOuter.envelope.type === BushMeshPacketType.Fragment) {
          const fragment = this.fragments.accept(
            Array.from(datagram.payload),
            datagram.receivedAtMs,
          );
          if (!fragment.complete || !fragment.datagramPayload) {
            return {
              status: 'fragment-pending',
              datagram,
              messageId: decodedOuter.envelope.messageId,
              missingFragments: fragment.reassembly?.missingFragments ?? [],
            };
          }
          logicalDatagram = {
            ...datagram,
            payload: Uint8Array.from(fragment.datagramPayload),
          };
          classification = classifyBushMeshDatagramPayload(
            fragment.datagramPayload,
          );
        }
      }
    } catch (error) {
      return malformedInbound(datagram, error);
    }

    if (classification.kind === 'unknown') {
      return malformedInbound(
        datagram,
        new Error(
          'Datagram is neither ordinary BushMesh nor a BushMesh Security v1 container.',
        ),
      );
    }

    let wireBytes: number[];
    let association: BushMeshSecurityAssociation = {kind: 'none'};
    let securityRouting: BushMeshSecurityRoutingContext | undefined;
    let securityMode:
      | 'plain'
      | 'protected-direct'
      | 'protected-group'
      | 'unauthenticated-emergency-fallback' = 'plain';

    if (classification.kind === 'security-container') {
      let container: BushMeshDecodedSecurityContainer;
      try {
        container = decodeBushMeshSecurityContainer(logicalDatagram.payload);
      } catch (error) {
        return malformedInbound(logicalDatagram, error);
      }

      if (isSecurityControlContainer(container)) {
        return {
          status: 'accepted',
          kind: 'security-control',
          datagram: logicalDatagram,
          control: container,
        };
      }

      if (!this.security) {
        return rejected(
          logicalDatagram,
          'security-unavailable',
          'BushMesh security adapter is not configured.',
        );
      }

      try {
        const context = {
          protocolVersion: protectedProtocolVersion(container),
          authenticatedHeader: container.authenticatedHeader,
        };
        const unprotected = await this.security.unprotect({
          protectedPayload: container.protectedPayload,
          context,
          routing: container.routing,
          channelIndex: logicalDatagram.channelIndex,
          dataType: logicalDatagram.dataType,
          transport: logicalDatagram.transport,
          receivedAtMs: logicalDatagram.receivedAtMs,
        });
        validateUnprotectedAssociation(container, unprotected.association);
        wireBytes = Array.from(unprotected.plaintextWireBytes);
        const expectedContext = createBushMeshSecurityProtocolContext(
          wireBytes,
          container.routing,
        );
        if (
          expectedContext.protocolVersion !== context.protocolVersion ||
          !bushMeshAuthenticatedHeadersEqual(
            expectedContext.authenticatedHeader,
            container.authenticatedHeader,
          )
        ) {
          throw new Error(
            'Protected BushMesh payload does not match its canonical authenticated header.',
          );
        }
        association = unprotected.association;
        securityRouting = container.routing;
        securityMode = container.kind;
      } catch (error) {
        return rejected(logicalDatagram, 'security-failed', error);
      }
    } else {
      wireBytes = Array.from(logicalDatagram.payload);
    }

    let decoded: DecodedBushMeshWireMessage;
    try {
      decoded = decodeBushMeshWire(wireBytes);
    } catch (error) {
      return rejected(
        logicalDatagram,
        classifyDecodeError(error),
        error,
      );
    }

    if (securityMode === 'plain') {
      if (decoded.envelope.type === BushMeshPacketType.Convoy) {
        return rejected(
          logicalDatagram,
          'security-required',
          'BushMesh Protocol v1 requires group protection for Convoy traffic.',
        );
      }
      if (decoded.envelope.type === BushMeshPacketType.Distress) {
        if (this.emergencySecurityPolicy !== 'allow-unauthenticated-fallback') {
          return rejected(
            logicalDatagram,
            'security-required',
            'Unauthenticated BushMesh distress is forbidden by the active Security v1 emergency policy.',
          );
        }
        securityMode = 'unauthenticated-emergency-fallback';
      }
    }

    let typed: BushMeshTypedPacket;
    try {
      typed = decodeBushMeshTypedPacket(wireBytes);
    } catch (error) {
      return rejected(logicalDatagram, 'malformed', error);
    }

    const semanticSourceNodeId =
      securityRouting?.sourceNodeId ?? logicalDatagram.sourceNodeId;
    if (semanticSourceNodeId !== undefined) {
      const identity = {
        sourceNodeId: semanticSourceNodeId,
        messageId: decoded.envelope.messageId,
      };
      if (
        this.recentMessages.checkAndRemember(
          identity,
          logicalDatagram.receivedAtMs,
        )
      ) {
        return {
          status: 'duplicate',
          datagram: logicalDatagram,
          messageId: decoded.envelope.messageId,
        };
      }
      await this.persistDedup();
    }

    return {
      status: 'accepted',
      kind: 'protocol',
      datagram: logicalDatagram,
      decoded,
      typed,
      securityAssociation: association,
      securityRouting,
      protected:
        securityMode === 'protected-direct' ||
        securityMode === 'protected-group',
      securityMode,
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
