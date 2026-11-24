import type {BushMeshInboundResult} from '../src/bushmesh/runtime/public';
import type {AuthorizedConvoyDirectory, AuthorizedConvoyMembership} from '../src/app/activeContext/operationalConvoy';
import {
  attachVerifiedTelemetryIngress,
  verifiedMapMembersIfAuthorized,
  VERIFIED_WAVE5_PRODUCTION_ACTIVATION,
} from '../src/convoy/fieldLocation/verifiedBoundary';
import {VerifiedConvoyTelemetry} from '../src/convoy/verifiedTelemetry/VerifiedConvoyTelemetry';

const membership: AuthorizedConvoyMembership = {
  convoyId: 'bmc1_verified_01',
  displayName: 'Private convoy',
  localIdentityRef: 'device-A',
  authorizationState: 'authorized',
  verifiedBy: 'security-v1',
  membershipRecordRef: 'security-v1:bmg1_verified_01:3',
};

describe('Wave 5 verified security and field-test isolation gates', () => {
  it('never activates live verified location sharing from channel membership alone', async () => {
    const verified = new VerifiedConvoyTelemetry();
    expect(VERIFIED_WAVE5_PRODUCTION_ACTIVATION)
      .toBe('disabled-pending-security-membership-and-node-binding');
    expect(await verified.project()).toBeNull();
    expect((await verified.publish({
      providerId: 'android-gps',
      fix: {latitude: -37.8, longitude: 145, accuracyMeters: 5, timestampMs: Date.now()},
    }, {channelIndex: 4, dataType: 1, transport: 'meshcore'})).status)
      .toBe('suppressed');
  });

  it('does not accept channel-only text into canonical protected group ingress', async () => {
    let listener: ((result: BushMeshInboundResult) => void) | null = null;
    const seen: BushMeshInboundResult[] = [];
    const stop = attachVerifiedTelemetryIngress({
      subscribeInboundResults(fn) {
        listener = fn;
        return () => {listener = null;};
      },
    }, {
      ingest: async result => {seen.push(result); return true;},
    } as unknown as VerifiedConvoyTelemetry);
    const unprotected = {
      status: 'accepted', kind: 'protocol', protected: false,
      securityMode: 'plain', typed: {kind: 'convoy'},
      securityAssociation: {kind: 'none'},
    } as unknown as BushMeshInboundResult;
    listener?.(unprotected);
    const wrong = {
      ...unprotected, protected: true, securityMode: 'protected-group',
      securityAssociation: {kind: 'group', groupId: 'bmg1_fake'},
      typed: {kind: 'location'},
    } as BushMeshInboundResult;
    listener?.(wrong);
    await Promise.resolve();
    expect(seen).toHaveLength(0);
    stop();
    expect(listener).toBeNull();
  });

  it('verified map projection is empty without independently revalidated authorization', async () => {
    const fakeProjection = {
      project: async () => ({
        convoyId: membership.convoyId,
        mapMembers: [{
          id: 'member-B', label: 'Verified B',
          position: {latitude: -37.8, longitude: 145, receivedAtMs: 1,
            headingDegrees: null},
        }],
      }),
    } as unknown as VerifiedConvoyTelemetry;
    let directoryMember: AuthorizedConvoyMembership | null = null;
    const directory: AuthorizedConvoyDirectory = {
      listAuthorized: async () => [],
      resolveAuthorized: async () => directoryMember,
    };
    expect(await verifiedMapMembersIfAuthorized(fakeProjection, directory, null, 'device-A'))
      .toEqual([]);
    expect(await verifiedMapMembersIfAuthorized(fakeProjection, directory, membership, 'device-A'))
      .toEqual([]);
    directoryMember = {...membership, membershipRecordRef: 'security-v1:bmg1_verified_01:2'};
    expect(await verifiedMapMembersIfAuthorized(fakeProjection, directory, membership, 'device-A'))
      .toEqual([]);
    directoryMember = membership;
    expect(await verifiedMapMembersIfAuthorized(fakeProjection, directory, membership, 'device-A'))
      .toHaveLength(1);
    directoryMember = null;
    expect(await verifiedMapMembersIfAuthorized(fakeProjection, directory, membership, 'device-A'))
      .toEqual([]);
  });

  it('rejects authorization revoked between first and second projection checks', async () => {
    let count = 0;
    const directory: AuthorizedConvoyDirectory = {
      listAuthorized: async () => [],
      resolveAuthorized: async () => {
        count++;
        return count === 1 ? membership : null;
      },
    };
    const verified = {
      project: async () => ({convoyId: membership.convoyId, mapMembers: [{
        id: 'B', label: 'B', position: null,
      }]}),
    } as unknown as VerifiedConvoyTelemetry;
    expect(await verifiedMapMembersIfAuthorized(verified, directory, membership, 'device-A'))
      .toEqual([]);
    expect(count).toBe(2);
  });
});
