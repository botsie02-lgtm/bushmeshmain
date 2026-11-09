import {BushMeshConvoyTracker} from '../src/bushmesh/runtime/BushMeshConvoyTracker';
import type {BushMeshInboundResult} from '../src/bushmesh/runtime/public';
import {
  acceptAuthenticatedConvoyPosition,
  type VerifiedConvoyPositionPolicy,
} from '../src/convoy/membership/authenticatedPositionIngress';

function packet(embedded: number, authenticated: number, groupId = 'security-group'): BushMeshInboundResult {
  return {
    status: 'accepted', kind: 'protocol',
    protected: true, securityMode: 'protected-group',
    securityAssociation: {kind: 'group', groupId},
    securityRouting: {sourceNodeId: authenticated, groupId},
    typed: {kind: 'convoy', value: {
      convoyId: 17, nodeId: embedded, sequence: 1,
      orderIndex: 1, role: 1, location: {latitude: -37.8, longitude: 144.9},
    }},
    datagram: {receivedAtMs: 1_000},
  } as unknown as BushMeshInboundResult;
}

const authorised: VerifiedConvoyPositionPolicy = {
  securityGroupId: 'security-group',
  protocolConvoyId: 17,
  authorisedSourceNodeIds: new Set([12]),
};

describe('authenticated convoy position ingress - simulator identity mismatch regression', () => {
  it('rejects an accepted group packet whose embedded node differs from authenticated source', () => {
    const tracker = new BushMeshConvoyTracker();
    expect(acceptAuthenticatedConvoyPosition(tracker, packet(99, 12), authorised)).toBe(false);
    expect(tracker.snapshot(17, 1_000).members).toHaveLength(0);
  });

  it('accepts only a matching and currently authorised source for the exact group', () => {
    const tracker = new BushMeshConvoyTracker();
    expect(acceptAuthenticatedConvoyPosition(tracker, packet(12, 12), authorised)).toBe(true);
    expect(tracker.snapshot(17, 1_000).members).toHaveLength(1);
    expect(acceptAuthenticatedConvoyPosition(tracker, packet(13, 13), authorised)).toBe(false);
    expect(acceptAuthenticatedConvoyPosition(tracker, packet(12, 12, 'other-group'), authorised)).toBe(false);
    expect(tracker.snapshot(17, 1_000).members).toHaveLength(1);
  });

  it('fails closed without a real verified source roster or for plaintext traffic', () => {
    const tracker = new BushMeshConvoyTracker();
    expect(acceptAuthenticatedConvoyPosition(tracker, packet(12, 12), null)).toBe(false);
    const plain = {...packet(12, 12), protected: false} as BushMeshInboundResult;
    expect(acceptAuthenticatedConvoyPosition(tracker, plain, authorised)).toBe(false);
    expect(tracker.snapshot(17, 1_000).members).toHaveLength(0);
  });
});
