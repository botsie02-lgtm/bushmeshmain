import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  describeJoinMilestones,
  EnrolmentMilestones,
  RoleGuide,
} from '../src/convoy/ui/EnrolmentMilestones';
import type {EnrolmentUiRequest} from '../src/convoy/ui/enrolmentViewModel';

const request: EnrolmentUiRequest = {
  id: 'request-001', convoyId: 'convoy',
  deviceId: 'bm1_requester', fingerprint: 'public_fingerprint',
  createdAt: 1800000000000, state: 'pending',
  displayState: 'pending-approval',
  mayApprove: true, mayReject: true,
  diagnostic: 'Authenticated request awaiting approval.',
  grantsAccess: false,
};

test('request receipt and administrative approval remain separate from Security installation', () => {
  const first = describeJoinMilestones(request);
  expect(first[0].status).toBe('RECEIVED');
  expect(first[1].status).toBe('AWAITING REVIEW');
  expect(first[2].status).toBe('NOT EXECUTED');
  expect(first[3].status).toBe('NOT VERIFIED');
  expect(first[4].status).toBe('NOT GRANTED');

  const approved = describeJoinMilestones({
    ...request,
    state: 'approved-awaiting-security',
    displayState: 'pending-security-enrolment',
    mayApprove: false,
  });
  expect(approved[1].status).toBe('APPROVAL RECORDED');
  expect(approved[2].status).toBe('NOT EXECUTED');
  expect(approved[4].status).toBe('NOT GRANTED');
});

test('rejected expired and blocked request stages stay non-authorising', () => {
  for (const [state, status] of [
    ['rejected', 'REJECTED'],
    ['expired', 'EXPIRED'],
    ['blocked', 'RECHECK REQUIRED'],
  ] as const) {
    const stages = describeJoinMilestones({...request, displayState: state});
    expect(stages[1].status).toBe(status);
    expect(stages[3].status).toBe('NOT VERIFIED');
    expect(stages[4].status).toBe('NOT GRANTED');
  }
});

test('join milestones and role guide are rendered as readable non-interactive status', async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <>
        <EnrolmentMilestones request={request} />
        <RoleGuide />
      </>,
    );
  });
  const text = JSON.stringify(tree.toJSON());
  expect(text).toContain('SECURE JOIN PROGRESS');
  expect(text).toContain('NOT GRANTED');
  expect(text).toContain('WHO CAN DO WHAT?');
  expect(text).toContain('ADMIN');
  expect(text).toContain('MEMBER');
  expect(text).toContain('owner/admin credential distribution is not yet active');
  await act(async () => {tree.unmount();});
});
