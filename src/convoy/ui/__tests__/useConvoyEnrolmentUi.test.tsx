import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useActiveOperationalConvoy} from '../../../app/activeContext/ActiveOperationalConvoyContext';
import {
  useConvoyEnrolmentUi,
  type ConvoyEnrolmentUiActions,
  type ConvoyEnrolmentUiDependencies,
  type ConvoyEnrolmentUiService,
} from '../useConvoyEnrolmentUi';
import type {AuthorizedConvoyMembership} from '../../../app/activeContext/operationalConvoy';
import type {ConvoyMembershipSnapshot} from '../../membership/model';
import {emptyConvoyMembershipSnapshot} from '../../membership/model';
import type {DeviceIdentity} from '../../../security/types';

jest.mock('../../../app/activeContext/ActiveOperationalConvoyContext', () => ({
  useActiveOperationalConvoy: jest.fn(),
}));

const ID = 'bm1_local';
const FP = 'fingerprint_local';
const CONVOY = 'bmc1_demo00000000';
const RECORD = 'security-v1:bmg1_demo00000000:1';
const authorized: AuthorizedConvoyMembership = {
  convoyId: CONVOY, displayName: 'Trusted Convoy',
  localIdentityRef: ID, authorizationState: 'authorized',
  verifiedBy: 'security-v1', membershipRecordRef: RECORD,
};

function fullIdentity(deviceId = ID, fingerprint = FP): DeviceIdentity {
  return {
    identityVersion: 1,
    deviceId, fingerprint,
    signingPublicKey: 'public-signing-key',
    agreementPublicKey: 'public-agreement-key',
    keyEpoch: 1, createdAt: 1000,
  };
}

function snapshot(): ConvoyMembershipSnapshot {
  return {
    ...emptyConvoyMembershipSnapshot(),
    convoys: [{
      convoyId: CONVOY, groupId: 'bmg1_demo00000000',
      displayName: 'Trusted Convoy', ownerDeviceId: ID, createdAt: 1000,
    }],
    requests: [{
      id: 'request1', convoyId: CONVOY,
      deviceId: 'bm1_remote', fingerprint: 'fingerprint_remote',
      createdAt: Date.now() - 1000, state: 'pending',
    }],
  };
}

function fixtures() {
  const current = {
    ...authorized,
  };
  let invalidation: () => void = () => undefined;
  const service = {
    createConvoy: jest.fn(async () => ({
      convoyId: CONVOY, groupId: 'bmg1_demo00000000',
      displayName: 'Created', ownerDeviceId: ID, createdAt: 1000,
    })),
    invite: jest.fn(async () => ({
      id: 'invite1', convoyId: CONVOY, recipientDeviceId: 'bm1_remote',
      recipientFingerprint: 'fingerprint_remote',
      state: 'pending' as const, createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    })),
    cancelInvitation: jest.fn(async () => undefined),
    approveJoinRequest: jest.fn(async () => ({
      ...snapshot().requests[0],
      state: 'approved-awaiting-security' as const,
    })),
    rejectJoinRequest: jest.fn(async () => ({
      ...snapshot().requests[0],
      state: 'rejected' as const,
    })),
    removeMember: jest.fn(async () => ({})),
    listAdministration: jest.fn(async () => snapshot()),
    listMembers: jest.fn(async () => [{
      deviceId: ID, identityFingerprint: FP,
      role: 'owner' as const, securityGroupRole: 'leader' as const,
      state: 'active' as const, presence: 'live' as const,
    }, {
      deviceId: 'bm1_remote', identityFingerprint: 'fingerprint_remote',
      role: 'member' as const, securityGroupRole: 'member' as const,
      state: 'active' as const, presence: 'stale' as const,
    }]),
    resolveAuthorized: jest.fn(async () => current),
    subscribeInvalidations: jest.fn((listener: () => void) => {
      invalidation = listener;
      return () => {invalidation = () => undefined;};
    }),
  };
  const identityProvider = {currentIdentity: jest.fn(async () => fullIdentity())};
  const selected = jest.fn(async () => true);
  const refreshActive = jest.fn(async () => undefined);
  (useActiveOperationalConvoy as jest.Mock).mockReturnValue({
    activeConvoy: authorized,
    selectableConvoys: [authorized],
    localIdentityRef: ID,
    status: 'ready',
    notice: null,
    selectionDurable: true,
    selectConvoy: selected,
    clearActiveConvoy: jest.fn(),
    refresh: refreshActive,
  });

  return {
    service,
    identityProvider,
    selected,
    refreshActive,
    invalidate: () => invalidation(),
  };
}

function mount(deps: ConvoyEnrolmentUiDependencies = {}) {
  let latest!: ConvoyEnrolmentUiActions;
  function Harness() {
    latest = useConvoyEnrolmentUi(deps);
    return null;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  return {
    render: async () => {
      await act(async () => {tree = TestRenderer.create(<Harness />);});
    },
    get: () => latest,
    unmount: async () => {
      await act(async () => {tree.unmount();});
    },
  };
}

describe('connected convoy enrolment read / action boundary', () => {
  test('without production Security v1, view and all mutations fail closed', async () => {
    fixtures();
    const view = mount();
    await view.render();
    expect(view.get().view.identity).toBeNull();
    expect(view.get().view.selected).toBeNull();
    expect(view.get().view.canCreate).toBe(false);
    let accepted = true;
    await act(async () => {accepted = await view.get().create('Fake convoy');});
    expect(accepted).toBe(false);
    expect(view.get().notice).toContain('Production Security v1');
    await view.unmount();
  });

  test('restart revalidates directory before showing roster', async () => {
    const f = fixtures();
    const view = mount({
      service: f.service as unknown as ConvoyEnrolmentUiService,
      identityProvider: f.identityProvider,
      productionSecurityReady: true,
      authenticatedTransportReady: false,
    });
    await view.render();
    expect(f.service.resolveAuthorized).toHaveBeenCalledTimes(2);
    expect(f.service.listMembers).toHaveBeenCalledTimes(1);
    expect(view.get().view.headerState).toBe('verified-membership');
    expect(view.get().view.verifiedMemberCount).toBe(2);
    expect(view.get().view.transportLabel).toContain('unavailable');
    await view.unmount();
  });

  test('revoked membership discards existing verified roster on invalidation', async () => {
    const f = fixtures();
    const view = mount({
      service: f.service as unknown as ConvoyEnrolmentUiService,
      identityProvider: f.identityProvider,
      productionSecurityReady: true,
    });
    await view.render();
    f.service.resolveAuthorized.mockImplementation(async () => null as never);
    await act(async () => {f.invalidate();});
    expect(view.get().view.selected).toBeNull();
    expect(view.get().view.members).toEqual([]);
    expect(view.get().view.headerState).toBe('revoked-or-rotated');
    await view.unmount();
  });

  test('epoch rotation between roster load and second resolve never grants status', async () => {
    const f = fixtures();
    let counter = 0;
    f.service.resolveAuthorized.mockImplementation(async () => {
      counter += 1;
      return counter === 1
        ? authorized
        : {...authorized, membershipRecordRef: 'security-v1:bmg1_demo00000000:2'};
    });
    const view = mount({
      service: f.service as unknown as ConvoyEnrolmentUiService,
      identityProvider: f.identityProvider,
      productionSecurityReady: true,
    });
    await view.render();
    expect(view.get().view.selected).toBeNull();
    expect(view.get().view.verifiedMemberCount).toBeNull();
    await view.unmount();
  });

  test('identity rotation invalidates local selection even if stale metadata exists', async () => {
    const f = fixtures();
    f.identityProvider.currentIdentity.mockImplementation(async () =>
      fullIdentity('bm1_rotated', 'fingerprint_rotated'));
    const view = mount({
      service: f.service as unknown as ConvoyEnrolmentUiService,
      identityProvider: f.identityProvider,
      productionSecurityReady: true,
    });
    await view.render();
    expect(view.get().view.identity).toBeNull();
    expect(view.get().view.selected).toBeNull();
    expect(view.get().view.diagnostic).toContain('does not match');
    expect(f.service.listAdministration).not.toHaveBeenCalled();
    await view.unmount();
  });

  test('admin approval never adds an active group member', async () => {
    const f = fixtures();
    const view = mount({
      service: f.service as unknown as ConvoyEnrolmentUiService,
      identityProvider: f.identityProvider,
      productionSecurityReady: true,
    });
    await view.render();
    expect(view.get().view.requests[0].mayApprove).toBe(true);
    let accepted = false;
    await act(async () => {accepted = await view.get().approve('request1');});
    expect(accepted).toBe(true);
    expect(view.get().notice).toContain('SECURITY ENROLMENT PENDING');
    expect(f.service.approveJoinRequest).toHaveBeenCalledWith('request1');
    expect(f.service.createConvoy).not.toHaveBeenCalled();
    expect(f.service.removeMember).not.toHaveBeenCalled();
    await view.unmount();
  });

  test('removal calls only the existing revocation service and notes pending rekey', async () => {
    const f = fixtures();
    const view = mount({
      service: f.service as unknown as ConvoyEnrolmentUiService,
      identityProvider: f.identityProvider,
      productionSecurityReady: true,
    });
    await view.render();
    let accepted = false;
    await act(async () => {accepted = await view.get().remove('bm1_remote');});
    expect(accepted).toBe(true);
    expect(f.service.removeMember).toHaveBeenCalledWith(CONVOY, 'bm1_remote');
    expect(view.get().notice).toContain('global revocation is NOT confirmed');
    await view.unmount();
  });

  test('unavailable authenticated direct transport prevents join-request dispatch', async () => {
    const f = fixtures();
    const dispatch = jest.fn(async () => undefined);
    const invitation = {
      id: 'incoming1', convoyId: CONVOY,
      recipientDeviceId: ID, recipientFingerprint: FP,
      createdAt: Date.now() - 1000, expiresAt: Date.now() + 60000,
      state: 'pending' as const,
    };
    const view = mount({
      service: f.service as unknown as ConvoyEnrolmentUiService,
      identityProvider: f.identityProvider,
      productionSecurityReady: true,
      authenticatedTransportReady: false,
      onSubmitAuthenticatedJoinRequest: dispatch,
      receivedInvitations: [{
        authenticatedBy: 'security-v1-direct-session',
        invitation,
      }],
    });
    await view.render();
    let accepted = true;
    await act(async () => {accepted = await view.get().requestJoin('incoming1');});
    expect(accepted).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(view.get().notice).toContain('unavailable');
    await view.unmount();
  });
});
