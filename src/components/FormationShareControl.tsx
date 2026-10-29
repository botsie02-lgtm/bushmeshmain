import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {BushMeshOutboxEntry} from '../bushmesh/outbox';
import {queueLocalFormationShare} from '../convoy/formationShareService';
import {bushMeshRadioSession} from '../radio/BushMeshRadioSession';
import {useBushMesh} from '../state/BushMeshContext';
import {useConvoyFormation} from '../state/ConvoyFormationContext';
import {useRadioSession} from '../state/RadioSessionContext';
import {colors} from '../theme/colors';

function deliveryCopy(entry: BushMeshOutboxEntry | null): string | null {
  if (!entry) {
    return null;
  }

  switch (entry.state) {
    case 'queued':
      return entry.attempts > 0
        ? `Queued for retry · ${entry.attempts}/${entry.maxAttempts} radio attempt${entry.attempts === 1 ? '' : 's'}.`
        : 'Queued for radio acceptance.';
    case 'inflight':
      return `Attempting radio handoff · attempt ${entry.attempts}/${entry.maxAttempts}.`;
    case 'accepted':
      return 'RADIO ACCEPTED · peer receipt is not confirmed.';
    case 'failed':
      return `FAILED after ${entry.attempts} radio attempt${entry.attempts === 1 ? '' : 's'}${
        entry.lastError ? ` · ${entry.lastError}` : ''
      }`;
    case 'cancelled':
      return entry.lastError
        ? `CANCELLED · ${entry.lastError}`
        : 'CANCELLED · superseded or expired before transmission.';
  }
}

function deliveryColor(entry: BushMeshOutboxEntry | null): string {
  switch (entry?.state) {
    case 'accepted':
      return colors.success;
    case 'failed':
      return colors.danger;
    case 'cancelled':
      return colors.warning;
    case 'inflight':
      return colors.accent;
    case 'queued':
    default:
      return colors.textSecondary;
  }
}

export function FormationShareControl(): React.JSX.Element {
  const {activeChannelIndex} = useBushMesh();
  const {
    configured,
    members,
    cautionGapMeters,
    criticalGapMeters,
  } = useConvoyFormation();
  const {snapshot: radio} = useRadioSession();
  const [trackedEntryId, setTrackedEntryId] = useState<string | null>(null);
  const [trackedRevision, setTrackedRevision] = useState<number | null>(null);
  const [trackedEntry, setTrackedEntry] = useState<BushMeshOutboxEntry | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (trackedEntryId === null) {
      setTrackedEntry(null);
      return;
    }

    const refresh = () => {
      const entry =
        bushMeshRadioSession
          .listOutbox()
          .find(candidate => candidate.id === trackedEntryId) ?? null;
      setTrackedEntry(entry);
    };

    refresh();
    return bushMeshRadioSession.subscribe(refresh);
  }, [trackedEntryId]);

  const channelIndex =
    activeChannelIndex === null ? null : Number.parseInt(activeChannelIndex, 10);
  const channelReady =
    channelIndex !== null &&
    Number.isInteger(channelIndex) &&
    channelIndex >= 0 &&
    channelIndex <= 7;
  const canShare =
    configured &&
    members.length > 0 &&
    channelReady &&
    radio.transportReady &&
    radio.identityRef !== null;

  const share = () => {
    if (!canShare || channelIndex === null) {
      return;
    }

    try {
      const queued = queueLocalFormationShare({
        channelIndex,
        members,
        cautionGapMeters,
        criticalGapMeters,
      });
      setError(null);
      setTrackedRevision(queued.revision);
      setTrackedEntryId(queued.entry.id);
      setTrackedEntry(queued.entry);
    } catch (shareError) {
      setError(
        shareError instanceof Error
          ? shareError.message
          : 'Bushmesh could not queue the formation share.',
      );
    }
  };

  const readiness = !configured
    ? 'Configure formation first'
    : !channelReady
      ? 'Select a MeshCore channel'
      : radio.identityRef === null
        ? 'Waiting for radio identity'
        : !radio.transportReady
          ? 'Radio transport offline'
          : `Channel ${channelIndex} ready`;

  const statusCopy = useMemo(() => deliveryCopy(trackedEntry), [trackedEntry]);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, !canShare && styles.buttonDisabled]}
        disabled={!canShare}
        onPress={share}>
        <Text style={styles.buttonText}>SHARE ORDER</Text>
      </TouchableOpacity>
      <View style={styles.copy}>
        <Text style={canShare ? styles.readyText : styles.waitingText}>
          {readiness}
        </Text>
        {trackedRevision !== null && statusCopy ? (
          <Text style={[styles.feedback, {color: deliveryColor(trackedEntry)}]}>
            Revision {trackedRevision} · {statusCopy}
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 8,
  },
  button: {
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonDisabled: {opacity: 0.35},
  buttonText: {color: colors.background, fontSize: 8, fontWeight: '900'},
  copy: {flex: 1, minWidth: 0},
  readyText: {color: colors.success, fontSize: 8, fontWeight: '900'},
  waitingText: {color: colors.textMuted, fontSize: 8, fontWeight: '900'},
  feedback: {fontSize: 8, lineHeight: 11, marginTop: 2, fontWeight: '800'},
  error: {color: colors.danger, fontSize: 8, lineHeight: 11, marginTop: 2},
});
