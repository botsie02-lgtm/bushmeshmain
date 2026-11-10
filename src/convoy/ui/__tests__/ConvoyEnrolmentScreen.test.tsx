import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import {ConvoyEnrolmentScreen} from '../ConvoyEnrolmentScreen';
import type {EnrolmentUiView} from '../enrolmentViewModel';

const NOW = 1800000000000;

function baseView(): EnrolmentUiView {
  return {
    identity: null,
    headerState: 'no-identity',
    headerTitle: 'Authenticated identity unavailable',
    headerDescription: 'Connect production security.',
    canCreate: false, canInvite: false, canReviewRequests: false,
    canPrepareJoinRequest: false,
    blockers: ['Security v2 enrolment disabled', 'No authenticated local identity'],
    localRole: null, selected: null, authorizedConvoys: [],
    verifiedMemberCount: null, members: [], invitations: [], requests: [],
    receivedInvitations: [],
    transportLabel: 'Authenticated transport unavailable',
    securityLabel: 'Production Security v1 provider not ready',
    sourceState: 'ready',
    diagnostic: null,
  };
}

function verified(): EnrolmentUiView {
  const view = baseView();
  const selected = {
    convoyId: 'convoy1', displayName: 'High Country',
    localIdentityRef: 'bm1_owner',
    authorizationState: 'authorized' as const,
    verifiedBy: 'security-v1' as const,
    membershipRecordRef: 'security-v1:group:3',
  };
  return {
    ...view,
    identity: {deviceId: 'bm1_owner', fingerprint: 'public-owner-fp', keyEpoch: 3},
    headerState: 'verified-membership',
    headerTitle: 'High Country',
    headerDescription: 'Security v1 verified current membership',
    securityLabel: 'Security v1 verified, v2 unavailable',
    transportLabel: 'Authenticated direct session available',
    canCreate: true, canInvite: true, canReviewRequests: true,
    canPrepareJoinRequest: true,
    localRole: 'owner', selected,
    authorizedConvoys: [selected], verifiedMemberCount: 2,
    members: [
      {
        deviceId: 'bm1_owner', fingerprint: 'public-owner-fp',
        role: 'owner', securityRole: 'leader',
        status: 'verified-active', position: 'live',
        positionLabel: 'Fresh authenticated position',
        isSelf: true, mayRemove: false,
      },
      {
        deviceId: 'bm1_peer', fingerprint: 'public-peer-fp',
        role: 'member', securityRole: 'member',
        status: 'verified-active', position: 'stale',
        positionLabel: 'Stale position — last known only',
        isSelf: false, mayRemove: true,
      },
    ],
    invitations: [{
      id: 'inv1', convoyId: 'convoy1',
      recipientDeviceId: 'bm1_invited',
      recipientFingerprint: 'public-invited-fp',
      createdAt: NOW - 5000, expiresAt: NOW + 50000,
      state: 'pending', displayState: 'pending', mayCancel: true,
      grantsAccess: false,
    }],
    requests: [{
      id: 'req1', convoyId: 'convoy1',
      deviceId: 'bm1_requester', fingerprint: 'public-requester-fp',
      createdAt: NOW - 1000, state: 'pending',
      displayState: 'pending-approval',
      diagnostic: 'No group access.',
      mayApprove: true, mayReject: true, grantsAccess: false,
    }],
    receivedInvitations: [],
  };
}

function props(view = baseView()) {
  return {
    view, busy: false, notice: null,
    onRefresh: jest.fn(),
    onCreate: jest.fn(),
    onSelect: jest.fn(),
    onPrepareInvite: jest.fn(),
    onCancelInvite: jest.fn(),
    onApprove: jest.fn(),
    onReject: jest.fn(),
    onRemoveMember: jest.fn(),
    onRequestJoin: jest.fn(),
    onOpenDrive: jest.fn(),
    onOpenMap: jest.fn(),
  };
}

function press(tree: TestRenderer.ReactTestRenderer, label: string) {
  const found = tree.root.findAllByProps({accessibilityLabel: label})
    .find(node => typeof node.props.onPress === 'function');
  if (!found) throw new Error('Missing actionable ' + label);
  found.props.onPress();
}

function typeIn(tree: TestRenderer.ReactTestRenderer, label: string, value: string) {
  const node = tree.root.findAllByProps({accessibilityLabel: label})
    .find(item => typeof item.props.onChangeText === 'function');
  if (!node) throw new Error('Missing input ' + label);
  node.props.onChangeText(value);
}

describe('Secure convoy enrolment screen', () => {
  test('no identity shows disabled creation and no fabricated memberships', async () => {
    const p = props();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {tree = TestRenderer.create(<ConvoyEnrolmentScreen {...p} />);});
    const snapshot = JSON.stringify(tree.toJSON());
    expect(snapshot).toContain('Authenticated identity unavailable');
    expect(snapshot).toContain('No verified memberships');
    expect(snapshot).toContain('Requires a live authenticated identity');
    expect(snapshot).not.toContain('SECURITY VERIFIED');
    const button = tree.root.findAllByProps({accessibilityLabel: 'Review convoy creation'})
      .find(n => typeof n.props.onPress === 'function');
    expect(button?.props.disabled).toBe(true);
    await act(async () => {press(tree, 'Why enrolment is unavailable');});
    expect(JSON.stringify(tree.toJSON())).toContain('Security v2 enrolment disabled');
    expect(p.onCreate).not.toHaveBeenCalled();
    await act(async () => {tree.unmount();});
  });

  test('verified directory selection and Drive/Map navigation use explicit callbacks', async () => {
    const p = props(verified());
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {tree = TestRenderer.create(<ConvoyEnrolmentScreen {...p} />);});
    await act(async () => {
      press(tree, 'Select High Country');
      press(tree, 'Open Drive');
      press(tree, 'Open ConvoyMap');
    });
    expect(p.onSelect).toHaveBeenCalledWith('convoy1');
    expect(p.onOpenDrive).toHaveBeenCalledTimes(1);
    expect(p.onOpenMap).toHaveBeenCalledTimes(1);
    await act(async () => {tree.unmount();});
  });

  test('creation is reviewed and explicitly confirmed before service callback', async () => {
    const p = props(verified());
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {tree = TestRenderer.create(<ConvoyEnrolmentScreen {...p} />);});
    await act(async () => {typeIn(tree, 'New convoy name', 'Mountains');});
    await act(async () => {press(tree, 'Review convoy creation');});
    expect(p.onCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('Confirm action');
    await act(async () => {press(tree, 'Cancel confirmation');});
    expect(p.onCreate).not.toHaveBeenCalled();
    await act(async () => {press(tree, 'Review convoy creation');});
    await act(async () => {press(tree, 'Create Security v1 group');});
    expect(p.onCreate).toHaveBeenCalledWith('Mountains');
    await act(async () => {tree.unmount();});
  });

  test('invitation form accepts only public recipient reference and confirms local metadata', async () => {
    const p = props(verified());
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {tree = TestRenderer.create(<ConvoyEnrolmentScreen {...p} />);});
    await act(async () => {press(tree, 'Invitations');});
    expect(JSON.stringify(tree.toJSON())).toContain('not access tokens');
    await act(async () => {
      typeIn(tree, 'Recipient public device ID', 'bm1_peer2');
      typeIn(tree, 'Recipient public fingerprint', 'public-fp2');
      typeIn(tree, 'Invitation lifetime days', '1');
    });
    await act(async () => {press(tree, 'Review invitation');});
    expect(p.onPrepareInvite).not.toHaveBeenCalled();
    await act(async () => {press(tree, 'Prepare local invitation');});
    expect(p.onPrepareInvite).toHaveBeenCalledTimes(1);
    expect(p.onPrepareInvite.mock.calls[0][0]).toBe('bm1_peer2');
    expect(p.onPrepareInvite.mock.calls[0][1]).toBe('public-fp2');
    expect(p.onPrepareInvite.mock.calls[0][2]).toBeGreaterThan(Date.now());
    await act(async () => {tree.unmount();});
  });

  test('approval requires confirmation and never labels pending as joined', async () => {
    const p = props(verified());
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {tree = TestRenderer.create(<ConvoyEnrolmentScreen {...p} />);});
    await act(async () => {press(tree, 'Join requests');});
    expect(JSON.stringify(tree.toJSON())).toContain('PENDING APPROVAL');
    await act(async () => {press(tree, 'Review approval req1');});
    expect(p.onApprove).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('Security v2 add-member');
    await act(async () => {press(tree, 'Record approval only');});
    expect(p.onApprove).toHaveBeenCalledWith('req1');
    expect(JSON.stringify(tree.toJSON())).not.toContain('ENROLLED SUCCESSFULLY');
    await act(async () => {tree.unmount();});
  });

  test('expired and rejected requests cannot display approval controls', async () => {
    const v = verified();
    v.requests[0] = {...v.requests[0],
      displayState: 'expired', mayApprove: false, mayReject: false};
    const p = props(v);
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {tree = TestRenderer.create(<ConvoyEnrolmentScreen {...p} />);});
    await act(async () => {press(tree, 'Join requests');});
    expect(JSON.stringify(tree.toJSON())).toContain('EXPIRED');
    expect(JSON.stringify(tree.toJSON())).not.toContain('Review approval req1');
    expect(p.onApprove).not.toHaveBeenCalled();
    await act(async () => {tree.unmount();});
  });

  test('member removal requires confirmation and exposes actual role/position', async () => {
    const p = props(verified());
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {tree = TestRenderer.create(<ConvoyEnrolmentScreen {...p} />);});
    await act(async () => {press(tree, 'Members');});
    expect(JSON.stringify(tree.toJSON())).toContain('Stale position');
    expect(JSON.stringify(tree.toJSON())).toContain('OWNER');
    await act(async () => {press(tree, 'Inspect fingerprint bm1_peer');});
    expect(JSON.stringify(tree.toJSON())).toContain('public-peer-fp');
    expect(JSON.stringify(tree.toJSON())).not.toContain('Review removal bm1_owner');
    await act(async () => {press(tree, 'Review removal bm1_peer');});
    expect(p.onRemoveMember).not.toHaveBeenCalled();
    await act(async () => {press(tree, 'Cancel confirmation');});
    expect(p.onRemoveMember).not.toHaveBeenCalled();
    await act(async () => {press(tree, 'Review removal bm1_peer');});
    await act(async () => {press(tree, 'Revoke local group member');});
    expect(p.onRemoveMember).toHaveBeenCalledWith('bm1_peer');
    await act(async () => {tree.unmount();});
  });

  test('revocation/identity rotation disarms pending confirmations', async () => {
    const v = verified(), p = props(v);
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {tree = TestRenderer.create(<ConvoyEnrolmentScreen {...p} />);});
    await act(async () => {press(tree, 'Join requests');});
    await act(async () => {press(tree, 'Review approval req1');});
    expect(JSON.stringify(tree.toJSON())).toContain('Confirm action');
    const invalid = {...baseView(), headerState: 'revoked-or-rotated' as const};
    await act(async () => {
      tree.update(<ConvoyEnrolmentScreen {...p} view={invalid} />);
    });
    expect(JSON.stringify(tree.toJSON())).not.toContain('Confirm action');
    expect(p.onApprove).not.toHaveBeenCalled();
    await act(async () => {tree.unmount();});
  });

  test('navigation buttons and confirmation controls meet touch target sizes', async () => {
    const p = props(verified());
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {tree = TestRenderer.create(<ConvoyEnrolmentScreen {...p} />);});
    const tab = tree.root.findAllByProps({accessibilityLabel: 'Members'})
      .find(n => typeof n.props.onPress === 'function');
    const refresh = tree.root.findAllByProps({accessibilityLabel: 'Refresh verified status'})
      .find(n => typeof n.props.onPress === 'function');
    expect(StyleSheet.flatten(tab?.props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(StyleSheet.flatten(refresh?.props.style).minHeight).toBeGreaterThanOrEqual(56);
    await act(async () => {tree.unmount();});
  });

  test('no sensitive cryptographic material is requested in the identity inspector', async () => {
    const p = props(verified());
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {tree = TestRenderer.create(<ConvoyEnrolmentScreen {...p} />);});
    await act(async () => {press(tree, 'Identity');});
    const snapshot = JSON.stringify(tree.toJSON());
    expect(snapshot).toContain('public-owner-fp');
    expect(snapshot).toContain('Key epoch');
    expect(snapshot).not.toContain('privateKeyHandle');
    expect(snapshot).not.toContain('channelSecret');
    expect(snapshot).not.toContain('groupKeyBytes');
    await act(async () => {tree.unmount();});
  });
});
