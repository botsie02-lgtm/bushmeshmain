import {
  bushMeshAuthenticatedHeadersEqual,
  createBushMeshSecurityProtocolContext,
  decodeBushMeshSecurityContainer,
  encodeBushMeshConvoyWire,
} from '../../bushmesh/protocol/public';
import type {BushMeshInboundResult} from '../../bushmesh/runtime/public';
import type {ConvoyMapMember} from '../../maps/convoyMapModel';
import {ConservativePositionCadence, encodeGpsConvoyStatus} from './cadence';
import type {
  AndroidTelemetryFix,
  PositionPublishResult,
  ProtectedConvoyRuntimePort,
  ProtectedTelemetryCheckpointStore,
  TelemetryAirtimePort,
  TelemetryCarrierTarget,
  TelemetrySequencePort,
  VerifiedTelemetryAuthority,
  VerifiedTelemetryMember,
  VerifiedTelemetryMemberView,
  VerifiedTelemetryProjection,
  VerifiedTelemetryRoster,
  VerifiedMemberPresence,
} from './contracts';

const MAX_MEMBERS = 32;
const MAX_UINT32 = 0xffffffff;
const MAX_INBOUND_AGE_MS = 90_000;
const MAX_INBOUND_FUTURE_SKEW_MS = 5_000;
const POSITION_RETENTION_MS = 600_000;
const POSITIVE_ID = /^[A-Za-z0-9_.:-]{1,160}$/;

type SavedPosition = {
  deviceId: string;
  fingerprint: string;
  nodeId: number;
  sequence: number;
  messageId: number;
  receivedAtMs: number;
  latitude: number | null;
  longitude: number | null;
  headingDegrees: number | null;
};

type CheckpointV1 = {
  schema: 'bushmesh-verified-telemetry';
  version: 1;
  binding: string;
  rows: SavedPosition[];
};

function uint32(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_UINT32;
}
function stringRef(value: string): boolean {
  return typeof value === 'string' && POSITIVE_ID.test(value);
}
function coordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

/** Defensive structural check. Only an independently trusted port can attest the values. */
function exactRoster(input: VerifiedTelemetryRoster | null): VerifiedTelemetryRoster | null {
  if (!input || input.verifiedBy !== 'security-group-and-node-bindings' ||
      !stringRef(input.convoyId) || !/^bmg1_[A-Za-z0-9_-]{8,128}$/.test(input.securityGroupId) ||
      !uint32(input.protocolConvoyId) ||
      !Number.isSafeInteger(input.currentEpoch) || input.currentEpoch < 1 ||
      !stringRef(input.localDeviceId) || !stringRef(input.localFingerprint) ||
      !uint32(input.localNodeId) || !stringRef(input.revision) ||
      !Array.isArray(input.members) || input.members.length < 1 ||
      input.members.length > MAX_MEMBERS) return null;
  const devices = new Set<string>();
  const nodes = new Set<number>();
  const members: VerifiedTelemetryMember[] = [];
  for (const member of input.members) {
    if (!member || !stringRef(member.deviceId) || !stringRef(member.fingerprint) ||
        !uint32(member.nodeId) || !Number.isSafeInteger(member.orderIndex) ||
        member.orderIndex < 0 || member.orderIndex > 0xffff ||
        !Number.isInteger(member.role) || member.role < 0 || member.role > 7 ||
        (member.state !== 'active' && member.state !== 'revoked') ||
        typeof member.label !== 'string' || member.label.length > 120 ||
        devices.has(member.deviceId) || nodes.has(member.nodeId)) return null;
    devices.add(member.deviceId);
    nodes.add(member.nodeId);
    members.push({...member});
  }
  const local = members.find(member => member.deviceId === input.localDeviceId);
  if (!local || local.state !== 'active' ||
      local.fingerprint !== input.localFingerprint ||
      local.nodeId !== input.localNodeId) return null;
  return {...input, members};
}

/** Only a cache discriminator. It is NOT a signature or membership proof. */
function rosterBinding(roster: VerifiedTelemetryRoster): string {
  return JSON.stringify([
    roster.convoyId, roster.protocolConvoyId, roster.securityGroupId,
    roster.currentEpoch, roster.localDeviceId, roster.localFingerprint,
    roster.localNodeId, roster.revision,
    roster.members.map(member => [
      member.deviceId, member.fingerprint, member.nodeId,
      member.orderIndex, member.role, member.state,
    ]),
  ]);
}
function sequenceNewer(incoming: number, previous: number): boolean {
  const delta = (incoming - previous) >>> 0;
  return delta > 0 && delta < 0x80000000;
}
function validSavedRow(value: unknown): value is SavedPosition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as SavedPosition;
  return stringRef(row.deviceId) && stringRef(row.fingerprint) &&
    uint32(row.nodeId) && uint32(row.sequence) && uint32(row.messageId) &&
    Number.isSafeInteger(row.receivedAtMs) && row.receivedAtMs >= 0 &&
    ((row.latitude === null && row.longitude === null) ||
      (typeof row.latitude === 'number' && typeof row.longitude === 'number' &&
        coordinate(row.latitude, row.longitude))) &&
    (row.headingDegrees === null ||
      (typeof row.headingDegrees === 'number' && Number.isFinite(row.headingDegrees) &&
        row.headingDegrees >= 0 && row.headingDegrees < 360));
}
function parsedCheckpoint(input: unknown): CheckpointV1 | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Partial<CheckpointV1>;
  if (record.schema !== 'bushmesh-verified-telemetry' || record.version !== 1 ||
      typeof record.binding !== 'string' || record.binding.length > 8192 ||
      !Array.isArray(record.rows) || record.rows.length > MAX_MEMBERS ||
      !record.rows.every(validSavedRow) ||
      new Set(record.rows.map(row => row.deviceId)).size !== record.rows.length) return null;
  return record as CheckpointV1;
}

export type VerifiedTelemetryDependencies = {
  authority?: VerifiedTelemetryAuthority | null;
  runtime?: ProtectedConvoyRuntimePort | null;
  sequences?: TelemetrySequencePort | null;
  airtime?: TelemetryAirtimePort | null;
  checkpoint?: ProtectedTelemetryCheckpointStore | null;
  clock?: () => number;
};

/**
 * Feature-local coordinator. No group/key/route/radio engine is implemented.
 * All live dependencies default to unavailable, not simulated.
 */
export class VerifiedConvoyTelemetry {
  private readonly authority: VerifiedTelemetryAuthority | null;
  private readonly runtime: ProtectedConvoyRuntimePort | null;
  private readonly sequences: TelemetrySequencePort | null;
  private readonly airtime: TelemetryAirtimePort | null;
  private readonly checkpoint: ProtectedTelemetryCheckpointStore | null;
  private readonly clock: () => number;
  private readonly cadence = new ConservativePositionCadence();
  private readonly positions = new Map<string, SavedPosition>();
  private activeRoster: VerifiedTelemetryRoster | null = null;
  private binding: string | null = null;
  private invalidation = 0;
  private work: Promise<void> = Promise.resolve();
  private readonly unsubscribe: (() => void) | null;

  constructor(deps: VerifiedTelemetryDependencies = {}) {
    this.authority = deps.authority ?? null;
    this.runtime = deps.runtime ?? null;
    this.sequences = deps.sequences ?? null;
    this.airtime = deps.airtime ?? null;
    this.checkpoint = deps.checkpoint ?? null;
    this.clock = deps.clock ?? Date.now;
    this.unsubscribe = this.authority
      ? this.authority.subscribeInvalidations(() => this.invalidate())
      : null;
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const run = this.work.then(action);
    this.work = run.then(() => undefined, () => undefined);
    return run;
  }
  private wipeState(): void {
    this.positions.clear();
    this.cadence.reset();
    this.activeRoster = null;
    this.binding = null;
  }
  invalidate(): void {
    ++this.invalidation;
    this.wipeState();
    if (this.checkpoint?.isDurableAndProtected()) {
      void this.checkpoint.clear().catch(() => undefined);
    }
  }
  dispose(): void {
    this.unsubscribe?.();
    this.invalidate();
  }

  private async resolve(): Promise<VerifiedTelemetryRoster | null> {
    const generation = this.invalidation;
    let candidate: VerifiedTelemetryRoster | null;
    try {
      candidate = exactRoster(await this.authority?.resolveActiveRoster() ?? null);
    } catch {
      candidate = null;
    }
    if (this.invalidation !== generation) return null;
    if (!candidate) {
      this.wipeState();
      return null;
    }
    const binding = rosterBinding(candidate);
    if (binding !== this.binding) {
      this.positions.clear();
      this.cadence.reset();
      this.binding = binding;
    }
    this.activeRoster = candidate;
    return candidate;
  }

  /**
   * Only accepted results from BushMeshV1RuntimeService may call this.
   * Runtime must already have decrypted AEAD, validated AAD and rejected
   * Security v1 replay. We additionally bind sender, epoch and node to the
   * current trust/roster, not carrier-provided source identities.
   */
  ingest(inbound: BushMeshInboundResult): Promise<boolean> {
    return this.serial(async () => {
      const roster = await this.resolve();
      if (!roster ||
          inbound.status !== 'accepted' || inbound.kind !== 'protocol' ||
          inbound.protected !== true || inbound.securityMode !== 'protected-group' ||
          inbound.securityAssociation.kind !== 'group' ||
          inbound.securityAssociation.groupId !== roster.securityGroupId ||
          inbound.typed.kind !== 'convoy') return false;

      const now = this.clock();
      const receivedAt = inbound.datagram.receivedAtMs;
      if (!Number.isSafeInteger(now) || !Number.isSafeInteger(receivedAt) ||
          receivedAt < 0 || receivedAt > now + MAX_INBOUND_FUTURE_SKEW_MS ||
          now - receivedAt > MAX_INBOUND_AGE_MS) return false;

      const status = inbound.typed.value;
      const authenticatedSource = inbound.securityRouting?.sourceNodeId;
      if (!uint32(authenticatedSource as number) ||
          authenticatedSource !== status.nodeId ||
          status.convoyId !== roster.protocolConvoyId ||
          !uint32(status.sequence) ||
          !uint32(inbound.decoded.envelope.messageId) ||
          !Number.isInteger(status.orderIndex) || !Number.isInteger(status.role) ||
          (!status.location && !status.locationUnavailable) ||
          status.locationDelta !== undefined ||
          (status.location !== undefined &&
            !coordinate(status.location.latitude, status.location.longitude))) {
        return false;
      }

      let senderDeviceId: string;
      let epoch: number;
      try {
        const container = decodeBushMeshSecurityContainer(inbound.datagram.payload);
        if (container.kind !== 'protected-group' ||
            container.protectedPayload.kind !== 'group' ||
            container.routing.groupId !== roster.securityGroupId ||
            container.routing.sourceNodeId !== authenticatedSource ||
            inbound.securityRouting?.groupId !== container.routing.groupId ||
            !bushMeshAuthenticatedHeadersEqual(
              createBushMeshSecurityProtocolContext(
                inbound.decoded.wireBytes, container.routing,
              ).authenticatedHeader,
              container.authenticatedHeader,
            )) return false;
        senderDeviceId = container.protectedPayload.message.senderDeviceId;
        epoch = container.protectedPayload.message.epoch;
        if (container.protectedPayload.message.groupId !== roster.securityGroupId) return false;
      } catch {
        return false;
      }

      const member = roster.members.find(item => item.deviceId === senderDeviceId);
      if (!member || member.state !== 'active' ||
          member.nodeId !== authenticatedSource ||
          member.orderIndex !== status.orderIndex ||
          member.role !== status.role ||
          epoch !== roster.currentEpoch) return false;
      const previous = this.positions.get(member.deviceId);
      if (previous && !sequenceNewer(status.sequence, previous.sequence)) return false;
      if (this.activeRoster !== roster) return false;
      this.positions.set(member.deviceId, {
        deviceId: member.deviceId, fingerprint: member.fingerprint,
        nodeId: member.nodeId, sequence: status.sequence,
        messageId: inbound.decoded.envelope.messageId,
        receivedAtMs: receivedAt,
        latitude: status.location?.latitude ?? null,
        longitude: status.location?.longitude ?? null,
        headingDegrees: status.location ? status.headingDegrees ?? null : null,
      });
      await this.saveCheckpoint();
      return true;
    });
  }

  /**
   * Source must be the genuine Android GPS path. A successful result proves
   * only that the existing local radio queue accepted the protected datagram.
   */
  publish(location: AndroidTelemetryFix, target: TelemetryCarrierTarget): Promise<PositionPublishResult> {
    return this.serial<PositionPublishResult>(async () => {
      const roster = await this.resolve();
      if (!roster || !this.runtime || !this.sequences || !this.airtime) {
        return {status: 'suppressed', reason: 'verified-security-or-runtime-unavailable'};
      }
      if (location.providerId !== 'android-gps') {
        return {status: 'suppressed', reason: 'non-production-gps-provider'};
      }
      const local = roster.members.find(item => item.deviceId === roster.localDeviceId &&
        item.nodeId === roster.localNodeId && item.fingerprint === roster.localFingerprint &&
        item.state === 'active');
      if (!local || !Number.isInteger(target.channelIndex) ||
          target.channelIndex < 0 || target.channelIndex > 255 ||
          !Number.isInteger(target.dataType) || target.dataType < 0 ||
          target.dataType > 255 || !target.transport) {
        return {status: 'suppressed', reason: 'invalid-local-member-or-carrier'};
      }
      const now = this.clock();
      const decision = this.cadence.decide(location.fix, now);
      if (decision.kind === 'suppressed') {
        return {status: 'suppressed', reason: decision.reason};
      }
      const {sequence, messageId} =
        await this.sequences.next(roster.securityGroupId, roster.localDeviceId);
      if (!uint32(sequence) || !uint32(messageId)) {
        return {status: 'suppressed', reason: 'invalid-durable-sequence'};
      }
      const wire = encodeBushMeshConvoyWire(
        encodeGpsConvoyStatus(local, roster.protocolConvoyId, sequence, decision),
        messageId, {ackRequested: false},
      );
      if (!await this.airtime.allowProtectedPosition({
        transport: target.transport, plainBytes: wire.length, nowMs: now,
      })) {
        return {status: 'suppressed', reason: 'airtime-budget'};
      }
      const current = await this.resolve();
      if (!current || rosterBinding(current) !== rosterBinding(roster)) {
        return {status: 'suppressed', reason: 'authority-changed'};
      }
      await this.runtime.prepareAndQueue(wire, {
        ...target,
        expiresAtMs: now + 60_000,
        retryIntent: {mode: 'none', maxTransportAttempts: 1},
        trafficClass: 'convoy-group',
        identityAssociation: {kind: 'group', groupId: roster.securityGroupId},
        securityRouting: {sourceNodeId: roster.localNodeId, groupId: roster.securityGroupId},
        label: 'Verified convoy position (local queue only)',
      });
      this.cadence.markQueued(decision, now);
      return {status: 'queued-locally', messageId, sequence};
    });
  }

  /** The map sees only independently reverified, ACTIVE group members. */
  project(nowMs = this.clock()): Promise<VerifiedTelemetryProjection | null> {
    return this.serial(async () => {
      const roster = await this.resolve();
      if (!roster || !Number.isSafeInteger(nowMs) || nowMs < 0) return null;
      const members: VerifiedTelemetryMemberView[] = [];
      const mapMembers: ConvoyMapMember[] = [];
      for (const member of roster.members) {
        if (member.state !== 'active' || member.deviceId === roster.localDeviceId) continue;
        const stored = this.positions.get(member.deviceId);
        const valid = stored && stored.fingerprint === member.fingerprint &&
          stored.nodeId === member.nodeId &&
          stored.receivedAtMs <= nowMs + MAX_INBOUND_FUTURE_SKEW_MS;
        const age = valid ? Math.max(0, nowMs - stored.receivedAtMs) : Infinity;
        const position = valid && age <= POSITION_RETENTION_MS &&
          stored.latitude !== null && stored.longitude !== null
          ? {
              latitude: stored.latitude,
              longitude: stored.longitude,
              headingDegrees: stored.headingDegrees,
              receivedAtMs: stored.receivedAtMs,
            } : null;
        let presence: VerifiedMemberPresence = 'missing-position';
        if (valid) {
          presence = age <= 30_000 ? 'live' : age <= 120_000 ? 'recent' :
            age <= 300_000 ? 'stale' : 'disconnected';
        }
        members.push({
          deviceId: member.deviceId, fingerprint: member.fingerprint,
          nodeId: member.nodeId, label: member.label.trim() || member.deviceId,
          presence: stored && !position && valid && age <= POSITION_RETENTION_MS &&
            stored.latitude === null ? 'missing-position' : presence,
          position,
          lastAuthenticatedAtMs: valid ? stored.receivedAtMs : null,
        });
        mapMembers.push({
          id: member.deviceId, label: member.label.trim() || member.deviceId,
          position,
        });
      }
      return {
        convoyId: roster.convoyId, securityGroupId: roster.securityGroupId,
        currentEpoch: roster.currentEpoch, generatedAtMs: nowMs,
        members, mapMembers,
      };
    });
  }

  /** Historical positions are NOT replay or membership authority. */
  restore(): Promise<boolean> {
    return this.serial(async () => {
      const roster = await this.resolve();
      if (!roster || !this.checkpoint?.isDurableAndProtected()) return false;
      let parsed: CheckpointV1 | null;
      try {
        parsed = parsedCheckpoint(await this.checkpoint.load());
      } catch {
        return false;
      }
      if (!parsed || parsed.binding !== this.binding) return false;
      const now = this.clock();
      const active = new Map(roster.members.filter(m => m.state === 'active').map(m => [m.deviceId, m]));
      const recovered = new Map<string, SavedPosition>();
      for (const row of parsed.rows) {
        const member = active.get(row.deviceId);
        if (!member || member.fingerprint !== row.fingerprint ||
            member.nodeId !== row.nodeId ||
            row.receivedAtMs > now + MAX_INBOUND_FUTURE_SKEW_MS ||
            now - row.receivedAtMs > POSITION_RETENTION_MS) continue;
        recovered.set(row.deviceId, {...row});
      }
      this.positions.clear();
      recovered.forEach((row, deviceId) => this.positions.set(deviceId, row));
      return recovered.size > 0;
    });
  }

  private async saveCheckpoint(): Promise<void> {
    if (!this.checkpoint?.isDurableAndProtected() || !this.binding) return;
    const snapshot: CheckpointV1 = {
      schema: 'bushmesh-verified-telemetry', version: 1,
      binding: this.binding,
      rows: Array.from(this.positions.values()).slice(0, MAX_MEMBERS).map(row => ({...row})),
    };
    await this.checkpoint.save(snapshot).catch(() => undefined);
  }
}
