import type {BushMeshInboundResult} from '../../bushmesh/runtime/public';
import type {AuthorizedConvoyMembership, AuthorizedConvoyDirectory} from '../../app/activeContext/operationalConvoy';
import type {ConvoyMapMember} from '../../maps/convoyMapModel';
import type {VerifiedConvoyTelemetry} from '../verifiedTelemetry/VerifiedConvoyTelemetry';

export type CanonicalRuntimeInboundPort = {
  subscribeInboundResults(listener: (value: BushMeshInboundResult) => void): () => void;
};

/** Only canonical authenticated runtime results are eligible for the existing
 * VerifiedConvoyTelemetry.ingest() boundary; channel text never reaches here.
 * No application-wide subscription or verified send is installed by default.
 */
export function attachVerifiedTelemetryIngress(
  runtime: CanonicalRuntimeInboundPort,
  telemetry: Pick<VerifiedConvoyTelemetry, 'ingest'>,
): () => void {
  let active = true;
  const unsubscribe = runtime.subscribeInboundResults(result => {
    if (!active || result.status !== 'accepted' || result.kind !== 'protocol' ||
        result.protected !== true || result.securityMode !== 'protected-group' ||
        result.securityAssociation.kind !== 'group' ||
        result.typed.kind !== 'convoy') return;
    // The verified telemetry service must revalidate current group membership,
    // group epoch, sender identity and node mapping. A callback is not proof.
    telemetry.ingest(result).catch(() => undefined);
  });
  return () => {
    active = false;
    unsubscribe();
  };
}

/** Fail-closed map projection. This returns ONLY genuine verified roster views.
 * Never use this function for optional channel-only field-test positions.
 */
export async function verifiedMapMembersIfAuthorized(
  telemetry: Pick<VerifiedConvoyTelemetry, 'project'>,
  directory: AuthorizedConvoyDirectory,
  activeConvoy: AuthorizedConvoyMembership | null,
  localDeviceId: string | null,
): Promise<readonly ConvoyMapMember[]> {
  if (!activeConvoy || !localDeviceId ||
      activeConvoy.localIdentityRef !== localDeviceId ||
      activeConvoy.authorizationState !== 'authorized' ||
      activeConvoy.verifiedBy !== 'security-v1') return [];
  try {
    const before = await directory.resolveAuthorized(activeConvoy.convoyId, localDeviceId);
    if (!before || before.authorizationState !== 'authorized' ||
        before.verifiedBy !== 'security-v1' ||
        before.localIdentityRef !== localDeviceId ||
        before.membershipRecordRef !== activeConvoy.membershipRecordRef) return [];
    const projected = await telemetry.project();
    if (!projected || projected.convoyId !== activeConvoy.convoyId) return [];
    const after = await directory.resolveAuthorized(activeConvoy.convoyId, localDeviceId);
    if (!after || after.authorizationState !== 'authorized' ||
        after.verifiedBy !== 'security-v1' ||
        after.localIdentityRef !== localDeviceId ||
        after.membershipRecordRef !== before.membershipRecordRef) return [];
    return projected.mapMembers.map(member => ({
      id: member.id,
      label: member.label,
      position: member.position ? {...member.position} : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Wave 5 production gate. The frozen v1 and Wave 4 staging integration do not
 * yet provide authentic node assignments and an approved live security roster.
 * UI workers MUST NOT infer authorization from any private channel key.
 */
export const VERIFIED_WAVE5_PRODUCTION_ACTIVATION = 'disabled-pending-security-membership-and-node-binding' as const;
