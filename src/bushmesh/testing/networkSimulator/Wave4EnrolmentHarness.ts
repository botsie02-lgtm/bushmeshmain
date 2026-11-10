import {
  BushMeshPacketType,
  BushMeshPriority,
  encodeBushMeshWire,
} from '../../protocol/public';
import type {BushMeshOutboundDatagram} from '../../runtime/public';
import {ConvoyMobilityHarness, ConvoyRegressionReport} from './ConvoyMobilityHarness';
import {SecurityDecisionTestAdapter} from './convoyCampaigns';

/**
 * Non-production Security-v2 proposal probe. Its decision results are
 * externally supplied; no unsigned application state is an authority.
 * A future integration adapter must map to independently reviewed Security v2
 * operations, not pretend frozen Security v1 can add group members.
 */
export type Wave4Request = {
  requestId: string;
  nodeId: number;
  fingerprint: string;
  identityEpoch: number;
  atMs: number;
};
export type Wave4Approval = {
  transactionId: string;
  requestId: string;
  approverNodeId: number;
  expectedEpoch: number;
  requesterFingerprint: string;
  claim: string;
};
export type Wave4InstallReceipt = {
  transactionId: string;
  recipientNodeId: number;
  committedEpoch: number;
  rosterRevision: string;
};

export interface Wave4SecurityDecisionProbe {
  readonly assurance: 'fake-decision-only' | 'external-provider-unverified';
  authenticateApproval(input: {
    request: Wave4Request;
    approval: Wave4Approval;
    activeAuthorityNodeIds: readonly number[];
  }): Promise<boolean>;
  verifyInstalledReceipt(input: Wave4InstallReceipt): Promise<boolean>;
}

/** Only simulates positive/negative policy decisions, NEVER signatures. */
export class FakeWave4SecurityDecisionProbe implements Wave4SecurityDecisionProbe {
  readonly assurance = 'fake-decision-only' as const;
  async authenticateApproval(input: {
    request: Wave4Request;
    approval: Wave4Approval;
    activeAuthorityNodeIds: readonly number[];
  }): Promise<boolean> {
    return input.activeAuthorityNodeIds.includes(input.approval.approverNodeId) &&
      input.request.fingerprint === input.approval.requesterFingerprint &&
      input.approval.claim === 'simulated-positive-approval';
  }
  async verifyInstalledReceipt(input: Wave4InstallReceipt): Promise<boolean> {
    return input.rosterRevision.length > 0 && input.committedEpoch > 0;
  }
}

export type Wave4Transaction = {
  transactionId: string;
  requestId: string;
  requestNodeId: number;
  fingerprint: string;
  expectedEpoch: number;
  committedEpoch: number | null;
  rosterRevision: string | null;
  status: 'prepared' | 'committed' | 'aborted';
  acknowledgedRecipients: number[];
  pendingRecipients: number[];
};

export type Wave4SecurityEvent = {
  atMs: number;
  kind: string;
  nodeId?: number;
  transactionId?: string;
  reason?: string;
  epoch: number;
};

export type Wave4SecurityMetrics = {
  acceptedRequests: number;
  preparedTransactions: number;
  committedTransactions: number;
  rejectedInvalidTransitions: number;
  rejectedApprovals: number;
  conflictingApprovals: number;
  replayedApprovals: number;
  partialCommitsPrevented: number;
  distributionsAttempted: number;
  distributionsDelivered: number;
  installedRecipients: number;
  verifiedInstallAcks: number;
  lostInstallAcks: number;
  rejectedInstallAcks: number;
  rejectedUnauthorizedPositions: number;
  epochDisagreementSamples: number[];
  convergenceLagSamplesMs: number[];
  rollbackBlocked: number;
};

export type Wave4SecurityReport = {
  assurance: Wave4SecurityDecisionProbe['assurance'];
  seed: number;
  nodeCount: number;
  currentEpoch: number;
  authorityAvailable: boolean;
  journalHealthy: boolean;
  activeMemberIds: number[];
  localEpochs: Record<string, number>;
  ackConverged: boolean;
  epochDisagreement: number;
  transactions: Wave4Transaction[];
  metrics: Wave4SecurityMetrics;
  events: Wave4SecurityEvent[];
  transport: ConvoyRegressionReport;
};

type LocalIdentity = {fingerprint: string; epoch: number};
type LocalTransaction = Wave4Transaction & {
  approvedClaim: string;
  approverNodeId: number;
  startedAtMs: number;
  observedReceipts: Set<number>;
};

/**
 * Shadow ledger for test assertions only. Never supplied to production
 * AuthorizedConvoyDirectory, application convoy membership, or Security v1.
 */
export class Wave4EnrolmentHarness {
  readonly fleet: ConvoyMobilityHarness;
  readonly decisionProbe: Wave4SecurityDecisionProbe;
  readonly securityEvents: Wave4SecurityEvent[] = [];
  readonly securityMetrics: Wave4SecurityMetrics = {
    acceptedRequests: 0, preparedTransactions: 0, committedTransactions: 0,
    rejectedInvalidTransitions: 0, rejectedApprovals: 0,
    conflictingApprovals: 0, replayedApprovals: 0, partialCommitsPrevented: 0,
    distributionsAttempted: 0, distributionsDelivered: 0,
    installedRecipients: 0, verifiedInstallAcks: 0, lostInstallAcks: 0,
    rejectedInstallAcks: 0, rejectedUnauthorizedPositions: 0,
    epochDisagreementSamples: [], convergenceLagSamplesMs: [], rollbackBlocked: 0,
  };
  private readonly policies = new Map<number, SecurityDecisionTestAdapter>();
  private readonly identities = new Map<number, LocalIdentity>();
  private readonly members = new Set<number>([1, 2]);
  private readonly installedEpoch = new Map<number, number>();
  private readonly requests = new Map<string, Wave4Request>();
  private readonly transactions = new Map<string, LocalTransaction>();
  private readonly approvalsByRequest = new Map<string, string>();
  private readonly authorityRoles = new Set<number>([1, 2]);
  private currentEpoch = 1;
  private journalHealthy = true;
  private nextMessageId = 850_000;
  private lastCommitAtMs = 0;

  constructor(
    seed: number,
    private readonly count = 8,
    probe: Wave4SecurityDecisionProbe = new FakeWave4SecurityDecisionProbe(),
    options: {bitrateBps?: number; maxQueueBytes?: number; lossRate?: number} = {},
  ) {
    if (!Number.isInteger(count) || count < 2 || count > 20) {
      throw new Error('Wave4 synthetic convoy must contain 2–20 nodes');
    }
    this.decisionProbe = probe;
    const securityAdapters: Record<number, SecurityDecisionTestAdapter> = {};
    for (let id = 1; id <= count; id++) {
      const policy = new SecurityDecisionTestAdapter();
      policy.senderDeviceId = this.deviceId(id);
      policy.senderEpoch = id <= 2 ? 1 : 1;
      this.policies.set(id, policy);
      securityAdapters[id] = policy;
      this.identities.set(id, {fingerprint: `fake-pin-${id}-1`, epoch: 1});
      this.installedEpoch.set(id, id <= 2 ? 1 : 0);
    }
    this.fleet = new ConvoyMobilityHarness(seed, {
      radioRangeMetres: 500,
      positionStaleAfterMs: 20_000,
      link: {
        bitrateBps: options.bitrateBps ?? 12_000,
        maxQueueBytes: options.maxQueueBytes ?? 2048,
        lossRate: options.lossRate ?? 0,
        baseDelayMs: 1,
      },
      securityAdapters,
    });
  }

  async initialize(): Promise<this> {
    await this.fleet.addFleet(this.count, 9);
    for (const id of this.fleet.ids()) {
      this.applyLocalSecurityPolicy(id);
      for (const from of this.fleet.ids()) {
        if (from !== id) this.policies.get(id)!.activeSessions.add(`wave4-shadow-${from}-${id}`);
      }
    }
    return this;
  }

  private deviceId(id: number): string {return `shadow-device-${id}`;}
  private now(): number {return this.fleet.network.clock.now();}
  private event(kind: string, nodeId?: number, transactionId?: string, reason?: string): void {
    this.securityEvents.push({atMs: this.now(), kind, nodeId, transactionId, reason, epoch: this.currentEpoch});
  }

  private reject(reason: string, nodeId?: number, tx?: string): false {
    this.securityMetrics.rejectedInvalidTransitions++;
    this.event('rejected-transition', nodeId, tx, reason);
    return false;
  }

  private allowed(): boolean {
    if (this.journalHealthy) return true;
    this.securityMetrics.rollbackBlocked++;
    this.event('fail-closed', undefined, undefined, 'journal-unavailable');
    return false;
  }

  private applyLocalSecurityPolicy(receiverId: number): void {
    const policy = this.policies.get(receiverId)!;
    const epoch = this.installedEpoch.get(receiverId) ?? 0;
    policy.acceptedGroupEpochs.clear();
    policy.approvedGroupDevices.clear();
    policy.boundSourceBySenderDevice.clear();
    if (epoch === 0) return;
    policy.acceptedGroupEpochs.add(epoch);
    for (const active of this.members) {
      policy.approvedGroupDevices.add(this.deviceId(active));
      policy.boundSourceBySenderDevice.set(this.deviceId(active), active);
    }
  }

  private observeDisagreement(): void {
    const epochs = Array.from(this.members, id => this.installedEpoch.get(id) ?? 0);
    this.securityMetrics.epochDisagreementSamples.push(
      epochs.filter(epoch => epoch !== this.currentEpoch).length,
    );
  }

  get epoch(): number {return this.currentEpoch;}
  get memberIds(): number[] {return [...this.members].sort((a, b) => a - b);}
  get installed(): ReadonlyMap<number, number> {return this.installedEpoch;}

  request(nodeId: number, requestId: string): boolean {
    if (!this.allowed()) return false;
    this.fleet.node(nodeId);
    if (this.members.has(nodeId)) return this.reject('already-member', nodeId);
    const identity = this.identities.get(nodeId)!;
    const request: Wave4Request = {
      requestId, nodeId, fingerprint: identity.fingerprint,
      identityEpoch: identity.epoch, atMs: this.now(),
    };
    const existing = this.requests.get(requestId);
    if (existing) {
      if (existing.nodeId === request.nodeId &&
          existing.fingerprint === request.fingerprint &&
          existing.identityEpoch === request.identityEpoch) {
        this.event('duplicate-request-observed', nodeId, undefined, requestId);
        return true;
      }
      return this.reject('conflicting-request-id', nodeId);
    }
    this.requests.set(requestId, request);
    this.securityMetrics.acceptedRequests++;
    this.event('join-request-observed', nodeId, undefined, requestId);
    return true;
  }

  async approve(input: Wave4Approval): Promise<boolean> {
    if (!this.allowed()) return false;
    const request = this.requests.get(input.requestId);
    if (!request) return this.reject('unknown-request', undefined, input.transactionId);
    const prevTx = this.approvalsByRequest.get(input.requestId);
    if (prevTx) {
      const existing = this.transactions.get(prevTx)!;
      if (prevTx === input.transactionId &&
          existing.fingerprint === input.requesterFingerprint &&
          existing.expectedEpoch === input.expectedEpoch &&
          existing.approvedClaim === input.claim &&
          existing.approverNodeId === input.approverNodeId) {
        this.securityMetrics.replayedApprovals++;
        if (existing.status !== 'prepared' || existing.expectedEpoch !== this.currentEpoch) {
          return this.reject('stale-committed-approval-replay', request.nodeId, prevTx);
        }
        this.event('prepared-approval-replay-no-op', request.nodeId, prevTx);
        return true;
      }
      this.securityMetrics.conflictingApprovals++;
      return this.reject('conflicting-approval', request.nodeId, input.transactionId);
    }
    if (this.transactions.has(input.transactionId)) {
      return this.reject('duplicate-transaction-id', request.nodeId, input.transactionId);
    }
    if (!this.fleet.node(1).present || !this.fleet.node(input.approverNodeId).present) {
      return this.reject('authority-unavailable', request.nodeId, input.transactionId);
    }
    if (!this.authorityRoles.has(input.approverNodeId) ||
        !this.members.has(input.approverNodeId)) {
      return this.reject('approver-not-anchored', request.nodeId, input.transactionId);
    }
    const pinned = this.identities.get(request.nodeId)!;
    if (pinned.fingerprint !== request.fingerprint ||
        pinned.epoch !== request.identityEpoch ||
        input.requesterFingerprint !== request.fingerprint) {
      return this.reject('requester-identity-changed', request.nodeId, input.transactionId);
    }
    if (input.expectedEpoch !== this.currentEpoch) {
      return this.reject('approval-epoch-conflict', request.nodeId, input.transactionId);
    }
    const valid = await this.decisionProbe.authenticateApproval({
      request, approval: input, activeAuthorityNodeIds: [...this.authorityRoles],
    });
    if (!valid) {
      this.securityMetrics.rejectedApprovals++;
      return this.reject('provider-rejected-approval', request.nodeId, input.transactionId);
    }
    this.approvalsByRequest.set(input.requestId, input.transactionId);
    this.transactions.set(input.transactionId, {
      transactionId: input.transactionId, requestId: input.requestId,
      requestNodeId: request.nodeId, fingerprint: request.fingerprint,
      expectedEpoch: input.expectedEpoch, committedEpoch: null,
      rosterRevision: null, status: 'prepared',
      pendingRecipients: [], acknowledgedRecipients: [],
      approvedClaim: input.claim, approverNodeId: input.approverNodeId,
      startedAtMs: this.now(), observedReceipts: new Set(),
    });
    this.securityMetrics.preparedTransactions++;
    this.event('approval-prepared-shadow', request.nodeId, input.transactionId);
    return true;
  }

  /**
   * A shadow atomic compare-and-swap model; no GroupKeyManager or secret-store
   * writes. The failure injection leaves ALL simulated state untouched.
   */
  commit(transactionId: string, failBeforeAtomicCommit = false): boolean {
    if (!this.allowed()) return false;
    const tx = this.transactions.get(transactionId);
    if (!tx) return this.reject('commit-without-prepared-approval', undefined, transactionId);
    if (tx.status === 'committed') return true;
    if (tx.status !== 'prepared') return this.reject('aborted-transaction', tx.requestNodeId, transactionId);
    if (tx.expectedEpoch !== this.currentEpoch) {
      return this.reject('stale-epoch-cas-conflict', tx.requestNodeId, transactionId);
    }
    if (!this.fleet.node(1).present) return this.reject('authority-unavailable', tx.requestNodeId, transactionId);
    if (this.identities.get(tx.requestNodeId)!.fingerprint !== tx.fingerprint) {
      return this.reject('identity-rotated-before-commit', tx.requestNodeId, transactionId);
    }
    if (failBeforeAtomicCommit) {
      this.securityMetrics.partialCommitsPrevented++;
      this.event('injected-atomic-commit-failure', tx.requestNodeId, transactionId);
      return false;
    }

    // Single local assignment boundary of shadow state; never a production
    // atomic persistence or Security-v2 transaction implementation.
    this.currentEpoch++;
    this.members.add(tx.requestNodeId);
    tx.status = 'committed';
    tx.committedEpoch = this.currentEpoch;
    tx.rosterRevision = `shadow-revision-${this.currentEpoch}-${this.memberIds.join('_')}`;
    tx.pendingRecipients = this.memberIds;
    this.installedEpoch.set(1, this.currentEpoch); // mock owner install
    this.policies.get(1)!.senderEpoch = this.currentEpoch;
    this.lastCommitAtMs = this.now();
    this.applyLocalSecurityPolicy(1);
    this.securityMetrics.committedTransactions++;
    this.event('fake-epoch-committed', tx.requestNodeId, transactionId);
    this.observeDisagreement();
    return true;
  }

  rotateIdentity(nodeId: number): void {
    const identity = this.identities.get(nodeId)!;
    const epoch = identity.epoch + 1;
    this.identities.set(nodeId, {epoch, fingerprint: `fake-pin-${nodeId}-${epoch}`});
    this.event('identity-rotation-injected', nodeId);
  }

  /**
   * The payload is ONLY a neutral, protected-direct Protocol v1 message
   * that acts as a carrier-leg probe. It is NOT Security v2 control wire.
   */
  private async controlLeg(from: number, to: number, label: string): Promise<boolean> {
    const messageId = this.nextMessageId++;
    const payload = encodeBushMeshWire({
      type: BushMeshPacketType.Message,
      priority: BushMeshPriority.Control,
      messageId,
      ackRequested: false,
      payload: [0x34, from, to, messageId & 0xff],
    });
    const datagram: BushMeshOutboundDatagram = await this.fleet.node(from).prepareOutbound(payload, {
      identityAssociation: {kind: 'direct-session', sessionId: `wave4-shadow-${from}-${to}`},
      trafficClass: 'direct-message',
      securityRouting: {sourceNodeId: from, destinationNodeId: to},
      label: `wave4-carrier-only:${label}`,
    });
    const packetId = await this.fleet.network.transmit(from, to, datagram);
    await this.fleet.network.runUntilIdle();
    return this.fleet.network.trace.some(x => x.kind === 'delivered' && x.packetId === packetId);
  }

  async distribute(transactionId: string, recipientId: number): Promise<boolean> {
    if (!this.allowed()) return false;
    const tx = this.transactions.get(transactionId);
    if (!tx || tx.status !== 'committed' || tx.committedEpoch !== this.currentEpoch ||
        !tx.pendingRecipients.includes(recipientId) ||
        !this.members.has(recipientId)) {
      return this.reject('invalid-distribution-target', recipientId, transactionId);
    }
    this.securityMetrics.distributionsAttempted++;
    if (!await this.controlLeg(1, recipientId, `distribution:${transactionId}`)) {
      this.event('key-distribution-carrier-loss', recipientId, transactionId);
      return false;
    }
    this.securityMetrics.distributionsDelivered++;
    const wasInstalled = this.installedEpoch.get(recipientId);
    if ((wasInstalled ?? 0) > this.currentEpoch) return this.reject('epoch-rollback-install', recipientId, transactionId);
    this.installedEpoch.set(recipientId, this.currentEpoch);
    this.policies.get(recipientId)!.senderEpoch = this.currentEpoch;
    this.applyLocalSecurityPolicy(recipientId);
    if (wasInstalled !== this.currentEpoch) this.securityMetrics.installedRecipients++;
    this.event('fake-recipient-install', recipientId, transactionId);
    this.observeDisagreement();
    return true;
  }

  async acknowledge(transactionId: string, recipientId: number): Promise<boolean> {
    if (!this.allowed()) return false;
    const tx = this.transactions.get(transactionId);
    if (!tx || tx.status !== 'committed' || tx.committedEpoch !== this.currentEpoch ||
        !tx.pendingRecipients.includes(recipientId) ||
        this.installedEpoch.get(recipientId) !== this.currentEpoch) {
      this.securityMetrics.rejectedInstallAcks++;
      return this.reject('invalid-install-ack', recipientId, transactionId);
    }
    if (tx.observedReceipts.has(recipientId)) {
      this.securityMetrics.rejectedInstallAcks++;
      return this.reject('replayed-install-ack', recipientId, transactionId);
    }
    if (recipientId !== 1 && !await this.controlLeg(recipientId, 1, `install-ack:${transactionId}`)) {
      this.securityMetrics.lostInstallAcks++;
      this.event('install-ack-carrier-loss', recipientId, transactionId);
      return false;
    }
    const ok = await this.decisionProbe.verifyInstalledReceipt({
      transactionId, recipientNodeId: recipientId,
      committedEpoch: this.currentEpoch, rosterRevision: tx.rosterRevision!,
    });
    if (!ok) {
      this.securityMetrics.rejectedInstallAcks++;
      return this.reject('provider-rejected-install-ack', recipientId, transactionId);
    }
    tx.observedReceipts.add(recipientId);
    tx.acknowledgedRecipients.push(recipientId);
    tx.pendingRecipients = tx.pendingRecipients.filter(id => id !== recipientId);
    this.securityMetrics.verifiedInstallAcks++;
    this.event('fake-install-ack-verified', recipientId, transactionId);
    if (this.ackConverged()) {
      this.securityMetrics.convergenceLagSamplesMs.push(this.now() - this.lastCommitAtMs);
      this.event('fake-epoch-ack-converged', undefined, transactionId);
    }
    return true;
  }

  /** Local fake authority must never regard all peers as converged on send. */
  ackConverged(): boolean {
    const latest = [...this.transactions.values()].filter(t =>
      t.status === 'committed' && t.committedEpoch === this.currentEpoch,
    );
    return latest.length === 1 &&
      latest[0].pendingRecipients.length === 0 &&
      this.memberIds.every(id => this.installedEpoch.get(id) === this.currentEpoch);
  }

  /**
   * Simulate revocation boundary and immediate local deny, not real Security
   * group-key rotation or authenticated remote revocation dissemination.
   */
  revoke(nodeId: number): boolean {
    if (!this.allowed()) return false;
    if (nodeId <= 2 || !this.members.has(nodeId)) return this.reject('invalid-revocation', nodeId);
    this.members.delete(nodeId);
    this.currentEpoch++;
    this.installedEpoch.set(1, this.currentEpoch);
    this.policies.get(1)!.senderEpoch = this.currentEpoch;
    this.applyLocalSecurityPolicy(1);
    this.event('fake-revocation-epoch-change', nodeId);
    this.observeDisagreement();
    return true;
  }

  async position(from: number, to: number): Promise<boolean> {
    const beforeRejected = this.fleet.network.metrics.runtimeRejected;
    await this.fleet.publishPosition(from, [to]);
    await this.fleet.network.runUntilIdle();
    const result = this.fleet.node(to).lastInboundResult;
    if (result?.status === 'rejected' &&
        this.fleet.network.metrics.runtimeRejected > beforeRejected) {
      this.securityMetrics.rejectedUnauthorizedPositions++;
    }
    this.event(result?.status === 'accepted' ? 'fake-protected-position-accepted' :
      'fake-protected-position-not-accepted', from, undefined, result?.status);
    return result?.status === 'accepted';
  }

  restartAuthority(failedRestore: boolean): void {
    this.journalHealthy = !failedRestore;
    this.event('fake-authority-restart', 1, undefined, failedRestore ? 'unavailable' : 'consistent');
  }

  reconcileRestart(authoritativeStateVerified: boolean): boolean {
    if (!authoritativeStateVerified) {
      this.securityMetrics.rollbackBlocked++;
      this.event('rollback-recovery-denied', 1);
      return false;
    }
    this.journalHealthy = true;
    this.event('fake-authority-recovered', 1);
    return true;
  }

  report(): Wave4SecurityReport {
    const transactions: Wave4Transaction[] = [...this.transactions.values()].map(tx => ({
      transactionId: tx.transactionId, requestId: tx.requestId,
      requestNodeId: tx.requestNodeId, fingerprint: tx.fingerprint,
      expectedEpoch: tx.expectedEpoch, committedEpoch: tx.committedEpoch,
      rosterRevision: tx.rosterRevision, status: tx.status,
      acknowledgedRecipients: [...tx.acknowledgedRecipients],
      pendingRecipients: [...tx.pendingRecipients],
    }));
    return {
      assurance: this.decisionProbe.assurance, seed: this.fleet.network.seed,
      nodeCount: this.count, currentEpoch: this.currentEpoch,
      authorityAvailable: this.fleet.node(1).present,
      journalHealthy: this.journalHealthy,
      activeMemberIds: this.memberIds,
      localEpochs: Object.fromEntries(this.fleet.ids().map(id => [String(id), this.installedEpoch.get(id) ?? 0])),
      ackConverged: this.ackConverged(),
      epochDisagreement: this.memberIds.filter(id => this.installedEpoch.get(id) !== this.currentEpoch).length,
      transactions,
      metrics: {
        ...this.securityMetrics,
        epochDisagreementSamples: [...this.securityMetrics.epochDisagreementSamples],
        convergenceLagSamplesMs: [...this.securityMetrics.convergenceLagSamplesMs],
      },
      events: this.securityEvents.map(e => ({...e})),
      transport: this.fleet.report(),
    };
  }

  failureReport(reason: string): string {
    return JSON.stringify({
      reason, report: this.report(),
      network: this.fleet.network.failureReport(reason),
    }, null, 2);
  }
}
