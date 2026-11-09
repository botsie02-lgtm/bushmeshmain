import type {BushMeshInboundResult} from '../../bushmesh/runtime/public';
import {BushMeshConvoyTracker} from '../../bushmesh/runtime/BushMeshConvoyTracker';

/**
 * Application-side boundary for authenticated convoy telemetry. Never call
 * the legacy tracker directly with untrusted discovered-radio positions.
 * A production Security v1 roster owner must supply this policy; no default
 * is authorised while platform key/identity lifecycle is unavailable.
 */
export type VerifiedConvoyPositionPolicy = {
  securityGroupId: string;
  protocolConvoyId: number;
  authorisedSourceNodeIds: ReadonlySet<number>;
};

/** Reject, without mutating position state, any unprotected, unscoped,
 * revoked, or embedded-identity-mismatched convoy packet. */
export function acceptAuthenticatedConvoyPosition(
  tracker: BushMeshConvoyTracker,
  inbound: BushMeshInboundResult,
  policy: VerifiedConvoyPositionPolicy | null,
): boolean {
  if (!policy || !policy.securityGroupId ||
      !Number.isSafeInteger(policy.protocolConvoyId) ||
      inbound.status !== 'accepted' || inbound.kind !== 'protocol' ||
      inbound.protected !== true || inbound.securityMode !== 'protected-group' ||
      inbound.securityAssociation.kind !== 'group' ||
      inbound.securityAssociation.groupId !== policy.securityGroupId ||
      inbound.typed.kind !== 'convoy') {
    return false;
  }
  const authenticatedSource = inbound.securityRouting?.sourceNodeId;
  const embeddedNode = inbound.typed.value.nodeId;
  if (!Number.isSafeInteger(authenticatedSource) ||
      authenticatedSource === undefined ||
      embeddedNode !== authenticatedSource ||
      inbound.typed.value.convoyId !== policy.protocolConvoyId ||
      !policy.authorisedSourceNodeIds.has(authenticatedSource)) {
    return false;
  }
  return tracker.accept(inbound.typed.value, inbound.datagram.receivedAtMs);
}
