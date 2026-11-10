import React, {useEffect, useState} from 'react';
import {
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import {colors} from '../../theme/colors';
import type {EnrolmentUiView} from './enrolmentViewModel';

export type ConvoyEnrolmentScreenProps = {
  view: EnrolmentUiView;
  busy: boolean;
  notice: string | null;
  onRefresh: () => void;
  onCreate: (name: string) => void;
  onSelect: (convoyId: string) => void;
  onPrepareInvite: (deviceId: string, fingerprint: string, expiresAt: number) => void;
  onCancelInvite: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRemoveMember: (deviceId: string) => void;
  onRequestJoin: (invitationId: string) => void;
  onOpenDrive?: () => void;
  onOpenMap?: () => void;
};

export type EnrolmentSection =
  | 'overview' | 'invitations' | 'requests' | 'members' | 'identity';

const SECTIONS: {key: EnrolmentSection; label: string}[] = [
  {key: 'overview', label: 'Convoys'},
  {key: 'invitations', label: 'Invitations'},
  {key: 'requests', label: 'Join requests'},
  {key: 'members', label: 'Members'},
  {key: 'identity', label: 'Identity'},
];

type PendingConfirmation =
  | {kind: 'create'; value: string}
  | {kind: 'invite'; deviceId: string; fingerprint: string; expiresAt: number}
  | {kind: 'approve' | 'reject' | 'cancel-invite'; id: string}
  | {kind: 'remove'; deviceId: string}
  | {kind: 'request-join'; id: string};

function Action({
  label, onPress, disabled = false, variant = 'neutral',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'neutral' | 'primary' | 'danger';
}): React.JSX.Element {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.button,
        variant === 'primary' && styles.primaryButton,
        variant === 'danger' && styles.dangerButton,
        disabled && styles.disabled,
      ]}>
      <Text style={[
        styles.buttonText,
        variant === 'primary' && styles.primaryText,
      ]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Card({children}: {children: React.ReactNode}): React.JSX.Element {
  return <View style={styles.card}>{children}</View>;
}

function Entry({label, value}: {label: string; value: string}): React.JSX.Element {
  return (
    <View style={styles.entry}>
      <Text style={styles.entryLabel}>{label}</Text>
      <Text style={styles.entryValue} selectable>{value}</Text>
    </View>
  );
}

function date(value: number): string {
  return Number.isSafeInteger(value) && value > 0
    ? new Date(value).toLocaleString()
    : 'Unknown';
}

function statusColor(state: string): string {
  return /rejected|revoked|expired|blocked|unavailable|rotated/.test(state)
    ? colors.danger : /pending|stale|awaiting|recent/.test(state)
      ? colors.warning : colors.success;
}

/** All callbacks belong to staging; this component implements NO cryptography. */
export function ConvoyEnrolmentScreen({
  view, busy, notice,
  onRefresh, onCreate, onSelect, onPrepareInvite, onCancelInvite,
  onApprove, onReject, onRemoveMember, onRequestJoin,
  onOpenDrive, onOpenMap,
}: ConvoyEnrolmentScreenProps): React.JSX.Element {
  const [section, setSection] = useState<EnrolmentSection>('overview');
  const [convoyName, setConvoyName] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [recipientFingerprint, setRecipientFingerprint] = useState('');
  const [expiryDays, setExpiryDays] = useState('1');
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [showBlockers, setShowBlockers] = useState(false);
  const [inspectedFingerprint, setInspectedFingerprint] = useState<string | null>(null);

  const selectionId = view.selected?.convoyId ?? null;
  const epochRef = view.selected?.membershipRecordRef ?? null;
  const localFingerprint = view.identity?.fingerprint ?? null;

  useEffect(() => {
    setConfirmation(null);
    setInspectedFingerprint(null);
  }, [selectionId, epochRef, localFingerprint, view.headerState]);

  function validRecipient(): boolean {
    return /^[A-Za-z0-9_.:-]{1,128}$/.test(recipientId.trim()) &&
      /^[A-Za-z0-9_.:-]{1,128}$/.test(recipientFingerprint.trim());
  }

  function confirmLabel(pending: PendingConfirmation): string {
    switch (pending.kind) {
      case 'create': return 'Create Security v1 group';
      case 'invite': return 'Prepare local invitation';
      case 'approve': return 'Record approval only';
      case 'reject': return 'Reject join request';
      case 'cancel-invite': return 'Cancel invitation';
      case 'remove': return 'Revoke local group member';
      case 'request-join': return 'Submit authenticated join request';
    }
  }

  function confirmDetail(pending: PendingConfirmation): string {
    switch (pending.kind) {
      case 'create':
        return 'Creates a NEW Security v1 group through the existing service. It does not enroll new members.';
      case 'invite':
        return 'Prepares local metadata for a trusted fingerprint. No invitation is transmitted or accepted here.';
      case 'approve':
        return 'Only records admin approval. Security v2 add-member/key distribution remains unavailable.';
      case 'reject':
        return 'Marks the authenticated request rejected without granting membership.';
      case 'cancel-invite':
        return 'Cancels local invitation metadata; it is not a group-key revocation.';
      case 'remove':
        return 'Revokes locally with Security v1 key rotation. Remote members still require rekey distribution.';
      case 'request-join':
        return 'Uses the integration-provided authenticated direct transport. Requesting does not add a member.';
    }
  }

  function runConfirmed(): void {
    const pending = confirmation;
    if (!pending || busy) return;
    setConfirmation(null);
    if (pending.kind === 'create' && view.canCreate) {
      onCreate(pending.value);
    } else if (pending.kind === 'invite' && view.canInvite) {
      onPrepareInvite(pending.deviceId, pending.fingerprint, pending.expiresAt);
    } else if (pending.kind === 'approve' &&
      view.requests.some(item => item.id === pending.id && item.mayApprove)) {
      onApprove(pending.id);
    } else if (pending.kind === 'reject' &&
      view.requests.some(item => item.id === pending.id && item.mayReject)) {
      onReject(pending.id);
    } else if (pending.kind === 'cancel-invite' &&
      view.invitations.some(item => item.id === pending.id && item.mayCancel)) {
      onCancelInvite(pending.id);
    } else if (pending.kind === 'remove' &&
      view.members.some(item => item.deviceId === pending.deviceId && item.mayRemove)) {
      onRemoveMember(pending.deviceId);
    } else if (pending.kind === 'request-join' &&
      view.receivedInvitations.some(item =>
        item.invitation.id === pending.id && item.canRequestJoin)) {
      onRequestJoin(pending.id);
    }
  }

  return (
    <ScrollView
      accessibilityLabel="Secure convoy enrolment and membership"
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>CONVOY / SECURITY</Text>
        <Text style={styles.title}>Secure convoy management</Text>
        <Text style={[styles.state, {color: statusColor(view.headerState)}]}>
          {view.headerTitle}
        </Text>
        <Text style={styles.body}>{view.headerDescription}</Text>
        <Text style={styles.safety}>Review these controls only when safely stopped.</Text>
        <Text style={styles.secondary}>{view.securityLabel}</Text>
        <Text style={styles.secondary}>{view.transportLabel}</Text>
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>
        ) : null}
        {view.diagnostic ? (
          <Text accessibilityRole="alert" style={styles.warning}>
            Verification error: {view.diagnostic}
          </Text>
        ) : null}
        <Action label="Refresh verified status" onPress={onRefresh} disabled={busy} />
        <Action label={showBlockers ? 'Hide enrolment blockers' : 'Why enrolment is unavailable'}
          onPress={() => setShowBlockers(!showBlockers)} />
        {showBlockers ? (
          <View style={styles.warningPanel}>
            <Text style={styles.cardTitle}>Security v2 joining remains disabled</Text>
            {view.blockers.map((item, i) => (
              <Text key={i} style={styles.body}>• {item}</Text>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.nav}>
        {SECTIONS.map(item => (
          <TouchableOpacity
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{selected: section === item.key}}
            onPress={() => {
              setSection(item.key);
              setConfirmation(null);
              setInspectedFingerprint(null);
            }}
            style={[styles.navItem, section === item.key && styles.navSelected]}>
            <Text style={[styles.navText,
              section === item.key && styles.navTextSelected]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {section === 'overview' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Authorised convoys</Text>
          {view.authorizedConvoys.length === 0 ? (
            <Card>
              <Text style={styles.cardTitle}>No verified memberships</Text>
              <Text style={styles.body}>
                A carrier channel, invite or discovered MeshCore contact does not grant convoy access.
              </Text>
            </Card>
          ) : view.authorizedConvoys.map(convoy => (
            <Card key={convoy.convoyId}>
              <Text style={styles.cardTitle}>{convoy.displayName}</Text>
              <Entry label="Convoy reference" value={convoy.convoyId} />
              <Text style={styles.secondary}>Security v1 authorised directory record</Text>
              <Action
                label={'Select ' + convoy.displayName}
                variant="primary"
                disabled={busy || view.sourceState !== 'ready'}
                onPress={() => onSelect(convoy.convoyId)}
              />
            </Card>
          ))}
          {view.selected ? (
            <Card>
              <Text style={styles.cardTitle}>Active operational convoy</Text>
              <Text style={styles.body}>{view.selected.displayName}</Text>
              <Text style={styles.secondary}>
                Verified current Security v1 membership; separate from MeshCore channel selection.
              </Text>
              <Entry label="Your role" value={view.localRole ?? 'Not verified'} />
              <Entry label="Verified member count"
                value={view.verifiedMemberCount === null
                  ? 'Unknown' : String(view.verifiedMemberCount)} />
              {onOpenDrive ? (
                <Action label="Open Drive" onPress={onOpenDrive} disabled={busy} />
              ) : null}
              {onOpenMap ? (
                <Action label="Open ConvoyMap" onPress={onOpenMap} disabled={busy} />
              ) : null}
            </Card>
          ) : null}
          <Text style={styles.sectionTitle}>Create a new convoy</Text>
          <Card>
            <Text style={styles.body}>
              Creation calls the existing Security v1 GroupKeyManager through
              ConvoyMembershipService. No carrier PSK or demo group is created here.
            </Text>
            <TextInput
              accessibilityLabel="New convoy name"
              placeholder="Convoy name"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              value={convoyName}
              maxLength={120}
              onChangeText={setConvoyName}
              editable={view.canCreate && !busy}
            />
            <Action label="Review convoy creation"
              disabled={!view.canCreate || busy || !convoyName.trim()}
              onPress={() => setConfirmation({kind: 'create', value: convoyName.trim()})} />
            {!view.canCreate ? (
              <Text style={styles.warning}>
                Requires a live authenticated identity and production Security v1 provider.
              </Text>
            ) : null}
          </Card>
        </View>
      ) : null}

      {section === 'invitations' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prepare a trusted invitation</Text>
          <Card>
            <Text style={styles.body}>
              Invitations are local proposals, not access tokens. An authenticated
              direct-session integration must deliver them separately.
            </Text>
            <TextInput
              accessibilityLabel="Recipient public device ID"
              autoCapitalize="none" autoCorrect={false}
              placeholder="Trusted recipient device ID"
              placeholderTextColor={colors.textSecondary}
              style={styles.input} value={recipientId}
              maxLength={128} editable={view.canInvite && !busy}
              onChangeText={setRecipientId}
            />
            <TextInput
              accessibilityLabel="Recipient public fingerprint"
              autoCapitalize="none" autoCorrect={false}
              placeholder="Verified public fingerprint (not a secret)"
              placeholderTextColor={colors.textSecondary}
              style={styles.input} value={recipientFingerprint}
              maxLength={128} editable={view.canInvite && !busy}
              onChangeText={setRecipientFingerprint}
            />
            <Text style={styles.secondary}>Expires after 1–7 days</Text>
            <TextInput
              accessibilityLabel="Invitation lifetime days"
              keyboardType="number-pad" value={expiryDays}
              maxLength={1} onChangeText={setExpiryDays}
              editable={view.canInvite && !busy}
              style={styles.input}
            />
            <Action label="Review invitation"
              disabled={!view.canInvite || busy || !validRecipient() ||
                !/^[1-7]$/.test(expiryDays)}
              onPress={() => setConfirmation({
                kind: 'invite',
                deviceId: recipientId.trim(),
                fingerprint: recipientFingerprint.trim(),
                expiresAt: Date.now() + Number(expiryDays) * 86400000,
              })}
            />
            {!view.canInvite ? (
              <Text style={styles.warning}>
                Only a verified owner/admin with Security v1 group-leader authority may invite.
              </Text>
            ) : null}
          </Card>
          <Text style={styles.sectionTitle}>Prepared invitations</Text>
          {view.invitations.length === 0 ? (
            <Card><Text style={styles.secondary}>No invitation records for the verified convoy.</Text></Card>
          ) : view.invitations.map(item => (
            <Card key={item.id}>
              <Text style={styles.cardTitle}>{item.recipientDeviceId}</Text>
              <Text style={[styles.state, {color: statusColor(item.displayState)}]}>
                {item.displayState.toUpperCase()}
              </Text>
              <Entry label="Public fingerprint" value={item.recipientFingerprint} />
              <Entry label="Expires" value={date(item.expiresAt)} />
              <Text style={styles.warning}>Invitation does not grant group membership.</Text>
              {item.mayCancel ? (
                <Action label={'Cancel invitation ' + item.id}
                  disabled={busy}
                  onPress={() => setConfirmation({kind: 'cancel-invite', id: item.id})} />
              ) : null}
            </Card>
          ))}
          <Text style={styles.sectionTitle}>Invitations received through verified direct sessions</Text>
          {view.receivedInvitations.length === 0 ? (
            <Card><Text style={styles.secondary}>No verified incoming invitations.</Text></Card>
          ) : view.receivedInvitations.map(item => (
            <Card key={item.invitation.id}>
              <Text style={styles.cardTitle}>Convoy {item.invitation.convoyId}</Text>
              <Text style={[styles.state, {color: statusColor(item.displayState)}]}>
                {item.displayState === 'review' ? 'REVIEW ONLY' : item.displayState.toUpperCase()}
              </Text>
              <Entry label="Recipient fingerprint"
                value={item.invitation.recipientFingerprint} />
              <Entry label="Expires" value={date(item.invitation.expiresAt)} />
              <Text style={styles.warning}>
                Requesting a join does not install a group key or grant membership.
              </Text>
              <Action label={'Request to join ' + item.invitation.convoyId}
                disabled={busy || !item.canRequestJoin || !view.canPrepareJoinRequest}
                onPress={() => setConfirmation({kind: 'request-join', id: item.invitation.id})} />
            </Card>
          ))}
        </View>
      ) : null}

      {section === 'requests' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Authenticated join requests</Text>
          {!view.canReviewRequests ? (
            <Card><Text style={styles.warning}>
              Owner/admin review requires verified Security v1 authority. No pending
              request is evidence of active membership.
            </Text></Card>
          ) : null}
          {view.requests.length === 0 ? (
            <Card><Text style={styles.secondary}>No authenticated join requests for the verified convoy.</Text></Card>
          ) : view.requests.map(item => (
            <Card key={item.id}>
              <Text style={styles.cardTitle}>{item.deviceId}</Text>
              <Text style={[styles.state, {color: statusColor(item.displayState)}]}>
                {item.displayState.replace(/-/g, ' ').toUpperCase()}
              </Text>
              <Entry label="Claimed public fingerprint" value={item.fingerprint} />
              <Entry label="Request timestamp" value={date(item.createdAt)} />
              <Text style={styles.body}>{item.diagnostic}</Text>
              <Text style={styles.warning}>
                No membership granted without a completed Security transaction and
                independent Security v1 directory verification.
              </Text>
              {item.mayApprove ? (
                <Action label={'Review approval ' + item.id}
                  disabled={busy}
                  onPress={() => setConfirmation({kind: 'approve', id: item.id})} />
              ) : null}
              {item.mayReject ? (
                <Action label={'Review rejection ' + item.id}
                  disabled={busy}
                  onPress={() => setConfirmation({kind: 'reject', id: item.id})} />
              ) : null}
            </Card>
          ))}
        </View>
      ) : null}

      {section === 'members' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security-verified member roster</Text>
          {view.verifiedMemberCount === null ? (
            <Card>
              <Text style={styles.warning}>
                Verified member roster unavailable. Discovered MeshCore contacts
                are deliberately excluded.
              </Text>
            </Card>
          ) : (
            <Card>
              <Text style={styles.cardTitle}>
                {view.verifiedMemberCount} active group members
              </Text>
              <Text style={styles.secondary}>
                Includes your device. Position freshness is based only on
                authenticated convoy ingress, never public radio discovery.
              </Text>
            </Card>
          )}
          {view.members.map(item => (
            <Card key={item.deviceId}>
              <Text style={styles.cardTitle}>
                {item.deviceId}{item.isSelf ? ' (you)' : ''}
              </Text>
              <Text style={[styles.state, {color: statusColor(item.status)}]}>
                {item.status === 'verified-active' ? 'SECURITY VERIFIED' : 'REVOKED'}
              </Text>
              <Entry label="Application role" value={item.role.toUpperCase()} />
              <Entry label="Security group role"
                value={item.securityRole.toUpperCase()} />
              <Text style={[styles.body, {
                color: statusColor(item.position),
              }]}>
                {item.position.toUpperCase()}: {item.positionLabel}
              </Text>
              <Action label={'Inspect fingerprint ' + item.deviceId}
                onPress={() => setInspectedFingerprint(
                  inspectedFingerprint === item.deviceId ? null : item.deviceId,
                )} />
              {inspectedFingerprint === item.deviceId ? (
                <Entry label="Verified public identity fingerprint" value={item.fingerprint} />
              ) : null}
              {item.mayRemove ? (
                <Action label={'Review removal ' + item.deviceId}
                  variant="danger" disabled={busy}
                  onPress={() => setConfirmation({kind: 'remove', deviceId: item.deviceId})} />
              ) : null}
            </Card>
          ))}
        </View>
      ) : null}

      {section === 'identity' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your public Security identity</Text>
          {!view.identity ? (
            <Card>
              <Text style={styles.warning}>
                No authenticated identity is available. MeshCore public-key
                prefixes are not Security v1 identities.
              </Text>
            </Card>
          ) : (
            <Card>
              <Entry label="Device ID" value={view.identity.deviceId} />
              <Entry label="Public fingerprint" value={view.identity.fingerprint} />
              <Entry label="Identity key epoch" value={String(view.identity.keyEpoch)} />
              <Text style={styles.secondary}>
                Public identity details only. Private key handles, group keys and
                carrier PSKs are never retrieved or displayed.
              </Text>
            </Card>
          )}
          <Card>
            <Text style={styles.cardTitle}>Security v2 enrolment</Text>
            <Text style={styles.warning}>
              Incremental authenticated add-member transactions are disabled
              pending reviewed production Security v2 contracts.
            </Text>
            <Action label="View security blockers"
              onPress={() => {setShowBlockers(true);setSection('overview');}} />
          </Card>
        </View>
      ) : null}

      {confirmation ? (
        <View style={styles.confirmation} accessibilityLiveRegion="polite">
          <Text style={styles.cardTitle}>Confirm action</Text>
          <Text style={styles.body}>{confirmDetail(confirmation)}</Text>
          <Text style={styles.secondary}>
            This is not a confirmation of new convoy membership or remote delivery.
          </Text>
          <Action label={confirmLabel(confirmation)}
            variant={confirmation.kind === 'remove' ? 'danger' : 'primary'}
            onPress={runConfirmed} disabled={busy} />
          <Action label="Cancel confirmation"
            onPress={() => setConfirmation(null)} disabled={busy} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 50, gap: 16},
  header: {backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.border, borderRadius: 18, padding: 17, gap: 10},
  eyebrow: {color: colors.accent, fontWeight: '900', fontSize: 12, letterSpacing: 1},
  title: {color: colors.textPrimary, fontWeight: '900', fontSize: 26},
  state: {color: colors.textPrimary, fontWeight: '900', fontSize: 15},
  body: {color: colors.textPrimary, fontSize: 14, lineHeight: 21},
  secondary: {color: colors.textSecondary, fontSize: 13, lineHeight: 19},
  warning: {color: colors.warning, fontSize: 13, lineHeight: 19},
  safety: {color: colors.warning, fontSize: 14, fontWeight: '700'},
  notice: {color: colors.accent, fontSize: 14, lineHeight: 21},
  warningPanel: {padding: 14, backgroundColor: colors.surfaceSoft,
    borderRadius: 13, gap: 8},
  nav: {flexDirection: 'row', flexWrap: 'wrap', gap: 9},
  navItem: {minHeight: 56, minWidth: 102, justifyContent: 'center',
    paddingHorizontal: 13, paddingVertical: 10,
    backgroundColor: colors.surfaceSoft, borderWidth: 1,
    borderColor: colors.border, borderRadius: 12},
  navSelected: {borderColor: colors.accent},
  navText: {color: colors.textPrimary, fontWeight: '800', fontSize: 14},
  navTextSelected: {color: colors.accent},
  section: {gap: 12},
  sectionTitle: {color: colors.textPrimary, fontSize: 20, fontWeight: '900'},
  card: {backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.border, borderRadius: 16, padding: 16, gap: 10},
  cardTitle: {color: colors.textPrimary, fontSize: 18, fontWeight: '900'},
  button: {minHeight: 56, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSoft},
  buttonText: {color: colors.textPrimary, fontSize: 15,
    fontWeight: '900', textAlign: 'center'},
  primaryButton: {backgroundColor: colors.accent, borderColor: colors.accent},
  primaryText: {color: colors.background},
  dangerButton: {backgroundColor: colors.danger, borderColor: colors.danger},
  disabled: {opacity: 0.45},
  input: {minHeight: 56, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, color: colors.textPrimary,
    backgroundColor: colors.surfaceSoft},
  entry: {gap: 4},
  entryLabel: {color: colors.textSecondary, fontSize: 12, fontWeight: '800'},
  entryValue: {color: colors.textPrimary, fontSize: 14, lineHeight: 21},
  confirmation: {padding: 16, backgroundColor: colors.surfaceSoft,
    borderWidth: 2, borderColor: colors.warning, borderRadius: 16, gap: 12},
});
