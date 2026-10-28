import React, {useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {queueLocalFormationShare} from '../convoy/formationShareService';
import {useBushMesh} from '../state/BushMeshContext';
import {useConvoyFormation} from '../state/ConvoyFormationContext';
import {useRadioSession} from '../state/RadioSessionContext';
import {colors} from '../theme/colors';

export function FormationShareControl(): React.JSX.Element {
  const {activeChannelIndex} = useBushMesh();
  const {
    configured,
    members,
    cautionGapMeters,
    criticalGapMeters,
  } = useConvoyFormation();
  const {snapshot: radio} = useRadioSession();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setFeedback(
        `Queued revision ${queued.revision} on channel ${channelIndex}. Radio acceptance is tracked by the Bushmesh outbox.`,
      );
    } catch (shareError) {
      setFeedback(null);
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
        {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
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
  feedback: {color: colors.textSecondary, fontSize: 8, lineHeight: 11, marginTop: 2},
  error: {color: colors.danger, fontSize: 8, lineHeight: 11, marginTop: 2},
});
