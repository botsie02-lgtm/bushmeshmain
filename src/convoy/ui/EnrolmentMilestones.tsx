import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors} from '../../theme/colors';
import type {EnrolmentUiRequest} from './enrolmentViewModel';

type Stage = {title: string; status: string; detail: string; kind: 'good' | 'wait' | 'blocked'};

export function describeJoinMilestones(request: EnrolmentUiRequest): readonly Stage[] {
  const rejected = request.displayState === 'rejected';
  const expired = request.displayState === 'expired';
  const blocked = request.displayState === 'blocked';
  const approved = request.displayState === 'pending-security-enrolment';
  return [
    {
      title: '1 · Authenticated request',
      status: 'RECEIVED',
      detail: 'Recorded after Security v1 direct-session verification. Not membership.',
      kind: 'good',
    },
    {
      title: '2 · Owner/admin decision',
      status: rejected ? 'REJECTED' : expired ? 'EXPIRED'
        : blocked ? 'RECHECK REQUIRED'
          : approved ? 'APPROVAL RECORDED' : 'AWAITING REVIEW',
      detail: approved
        ? 'An approval is administrative intent only; it did not change the roster.'
        : 'Local owner/admin authority must be verified by Security v1.',
      kind: approved ? 'wait' : rejected || expired || blocked ? 'blocked' : 'wait',
    },
    {
      title: '3 · Security v2 group transaction',
      status: 'NOT EXECUTED',
      detail: 'Atomic member-add, epoch change and protected distribution remain disabled.',
      kind: 'blocked',
    },
    {
      title: '4 · Recipient installation',
      status: 'NOT VERIFIED',
      detail: 'No validated recipient key/roster installation or authenticated acknowledgement.',
      kind: 'blocked',
    },
    {
      title: '5 · Operational membership',
      status: 'NOT GRANTED',
      detail: 'Only the separately refreshed Security v1 directory can verify membership.',
      kind: 'blocked',
    },
  ];
}

/** A status timeline, not a transaction runner or an authorisation result. */
export function EnrolmentMilestones({
  request,
}: {request: EnrolmentUiRequest}): React.JSX.Element {
  return (
    <View style={styles.container} accessibilityLabel={'Security progress for ' + request.deviceId}>
      <Text style={styles.heading}>SECURE JOIN PROGRESS</Text>
      {describeJoinMilestones(request).map(stage => (
        <View style={styles.row} key={stage.title}>
          <View style={[styles.dot, {
            backgroundColor: stage.kind === 'good' ? colors.success :
              stage.kind === 'wait' ? colors.warning : colors.textSecondary,
          }]} />
          <View style={styles.body}>
            <Text style={styles.title}>{stage.title}</Text>
            <Text style={[styles.status, {
              color: stage.kind === 'good' ? colors.success :
                stage.kind === 'wait' ? colors.warning : colors.textSecondary,
            }]}>{stage.status}</Text>
            <Text style={styles.detail}>{stage.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function RoleGuide(): React.JSX.Element {
  return (
    <View style={styles.container} accessibilityLabel="Verified convoy role guide">
      <Text style={styles.heading}>WHO CAN DO WHAT?</Text>
      <Text style={styles.detail}>
        OWNER — may invite, review requests, remove non-owners and grant local admin
        designation. Requires verified group-leader authority.
      </Text>
      <Text style={styles.detail}>
        ADMIN — may invite, review requests and remove regular members.
        Cannot remove other admins or owners.
      </Text>
      <Text style={styles.detail}>
        MEMBER — may inspect their authorised convoy and roster.
        Cannot approve, invite or remove members.
      </Text>
      <Text style={styles.caution}>
        A displayed role is local application policy. Security v2 anchored
        owner/admin credential distribution is not yet active.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 14, backgroundColor: colors.surfaceSoft,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border, gap: 10,
  },
  heading: {color: colors.textPrimary, fontSize: 13, fontWeight: '900'},
  row: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  dot: {width: 10, height: 10, borderRadius: 5, marginTop: 5},
  body: {flex: 1, gap: 3},
  title: {color: colors.textPrimary, fontSize: 14, fontWeight: '800'},
  status: {fontSize: 12, fontWeight: '900'},
  detail: {color: colors.textSecondary, fontSize: 13, lineHeight: 19},
  caution: {color: colors.warning, fontSize: 13, lineHeight: 19},
});
