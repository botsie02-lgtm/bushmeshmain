import {BushMeshIdentityRef} from '../bushmesh/protocol';
import {BushMeshFormationShare} from './formationProtocol';

export type FormationProposalTrust = 'normal-review' | 'caution-review';

export type FormationProposalTransportContext = {
  channelIndex: number;
  snrDb: number;
  pathLength: number;
};

export type FormationProposalAcceptance = {
  allowed: boolean;
  reason: string | null;
  ageSeconds: number;
  futureSkewSeconds: number;
};

export type BushMeshFormationProposal = {
  id: string;
  share: BushMeshFormationShare;
  receivedAtMs: number;
  packetAgeSeconds: number;
  clockSkewSeconds: number;
  claimedLeaderId: BushMeshIdentityRef;
  senderIncluded: boolean;
  senderClaimsLead: boolean;
  localMemberIncluded: boolean | null;
  transport: FormationProposalTransportContext | null;
  trust: FormationProposalTrust;
  warnings: string[];
  requiresExplicitAcceptance: true;
};

export type AcceptedFormationMember = {
  id: string;
  kind: 'self' | 'vehicle';
};

export type AcceptedFormationPlan = {
  members: AcceptedFormationMember[];
  cautionGapMeters: number;
  criticalGapMeters: number;
  sourceSenderId: BushMeshIdentityRef;
  sourceRevision: number;
  sourceTimestampSeconds: number;
};

const MAX_ACCEPTABLE_PROPOSAL_AGE_SECONDS = 15 * 60;
const MAX_ACCEPTABLE_FUTURE_SKEW_SECONDS = 5 * 60;

function normalizeIdentity(identity: BushMeshIdentityRef): string {
  return identity.replace(/[^0-9a-f]/gi, '').toUpperCase();
}

/**
 * Re-evaluates proposal freshness at the moment the driver tries to accept it.
 * A proposal can remain visible for review/history after this window, but stale
 * or severely future-skewed order changes cannot be applied.
 */
export function getFormationProposalAcceptance(
  proposal: BushMeshFormationProposal,
  nowMs = Date.now(),
): FormationProposalAcceptance {
  const packetTimestampMs = proposal.share.timestampSeconds * 1000;
  const signedAgeSeconds = Math.floor((nowMs - packetTimestampMs) / 1000);
  const futureSkewSeconds = Math.max(0, -signedAgeSeconds);
  const ageSeconds = Math.max(0, signedAgeSeconds);

  if (futureSkewSeconds > MAX_ACCEPTABLE_FUTURE_SKEW_SECONDS) {
    return {
      allowed: false,
      reason:
        'This formation timestamp is too far in the future to apply safely. Check device clocks or wait for a fresh share.',
      ageSeconds,
      futureSkewSeconds,
    };
  }

  if (ageSeconds > MAX_ACCEPTABLE_PROPOSAL_AGE_SECONDS) {
    return {
      allowed: false,
      reason:
        'This formation share is more than fifteen minutes old. Ask for a fresh order before applying it.',
      ageSeconds,
      futureSkewSeconds,
    };
  }

  return {allowed: true, reason: null, ageSeconds, futureSkewSeconds};
}

/**
 * Creates a review-only proposal from a decoded formation share. Bushmesh v1
 * sender references are not signed formation authority, so this function never
 * marks a proposal as trusted enough for automatic application. Radio metrics
 * are retained only as transport context and never increase identity trust.
 */
export function buildFormationProposal(
  share: BushMeshFormationShare,
  receivedAtMs = Date.now(),
  localIdentityRef?: BushMeshIdentityRef | null,
  transport?: FormationProposalTransportContext | null,
): BushMeshFormationProposal {
  const senderId = normalizeIdentity(share.senderId);
  const memberIds = share.memberIds.map(normalizeIdentity);
  const claimedLeaderId = memberIds[0];
  const senderIncluded = memberIds.includes(senderId);
  const senderClaimsLead = claimedLeaderId === senderId;
  const localIdentity = localIdentityRef
    ? normalizeIdentity(localIdentityRef)
    : null;
  const localMemberIncluded =
    localIdentity === null ? null : memberIds.includes(localIdentity);
  const packetTimestampMs = share.timestampSeconds * 1000;
  const clockSkewSeconds = Math.round((packetTimestampMs - receivedAtMs) / 1000);
  const packetAgeSeconds = Math.max(
    0,
    Math.floor((receivedAtMs - packetTimestampMs) / 1000),
  );

  const warnings: string[] = [];
  if (!senderIncluded) {
    warnings.push('The claimed sender is not present in the shared formation.');
  }
  if (!senderClaimsLead) {
    warnings.push(
      'The claimed sender is not first in the formation and therefore is not claiming the lead position.',
    );
  }
  if (localMemberIncluded === false) {
    warnings.push('This vehicle is not included in the shared formation.');
  }
  if (clockSkewSeconds > 120) {
    warnings.push('The formation packet timestamp is more than two minutes in the future.');
  }
  if (packetAgeSeconds > MAX_ACCEPTABLE_PROPOSAL_AGE_SECONDS) {
    warnings.push('The formation packet is more than fifteen minutes old.');
  }

  return {
    id: `formation-proposal:${senderId}:${share.timestampSeconds}:${share.sequence}`,
    share: {
      ...share,
      senderId,
      memberIds,
    },
    receivedAtMs,
    packetAgeSeconds,
    clockSkewSeconds,
    claimedLeaderId,
    senderIncluded,
    senderClaimsLead,
    localMemberIncluded,
    transport: transport ? {...transport} : null,
    trust: warnings.length === 0 ? 'normal-review' : 'caution-review',
    warnings,
    requiresExplicitAcceptance: true,
  };
}

/**
 * Converts an explicitly accepted proposal into the local formation model. The
 * receiver's own radio identity must appear in the proposal so the special
 * local-self placeholder cannot be assigned to somebody else's vehicle.
 */
export function acceptFormationProposal(
  proposal: BushMeshFormationProposal,
  localIdentityRef: BushMeshIdentityRef,
  selfFormationId = '__bushmesh_self__',
  nowMs = Date.now(),
): AcceptedFormationPlan {
  const acceptance = getFormationProposalAcceptance(proposal, nowMs);
  if (!acceptance.allowed) {
    throw new Error(acceptance.reason ?? 'Formation proposal can no longer be accepted.');
  }

  const localIdentity = normalizeIdentity(localIdentityRef);
  const memberIds = proposal.share.memberIds.map(normalizeIdentity);
  if (!memberIds.includes(localIdentity)) {
    throw new Error(
      'Cannot accept a formation proposal that does not include this vehicle.',
    );
  }

  return {
    members: memberIds.map(memberId =>
      memberId === localIdentity
        ? {id: selfFormationId, kind: 'self' as const}
        : {id: memberId, kind: 'vehicle' as const},
    ),
    cautionGapMeters: proposal.share.cautionGapMeters,
    criticalGapMeters: proposal.share.criticalGapMeters,
    sourceSenderId: proposal.share.senderId,
    sourceRevision: proposal.share.revision,
    sourceTimestampSeconds: proposal.share.timestampSeconds,
  };
}
