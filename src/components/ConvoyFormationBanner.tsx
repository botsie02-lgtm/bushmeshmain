import React, {useState} from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {useConvoyFormation} from '../state/ConvoyFormationContext';
import {colors} from '../theme/colors';
import {ConvoyFormationPanel} from './ConvoyFormationPanel';
import {FormationShareControl} from './FormationShareControl';

function stateColor(state: string): string {
  switch (state) {
    case 'good':
      return colors.success;
    case 'caution':
    case 'unknown':
      return colors.warning;
    case 'critical':
    case 'lost':
      return colors.danger;
    default:
      return colors.accent;
  }
}

export function ConvoyFormationBanner(): React.JSX.Element {
  const {configured, snapshot} = useConvoyFormation();
  const [setupVisible, setSetupVisible] = useState(false);
  const status = configured ? snapshot.worstGapState : 'not-set';
  const attention = snapshot.alertCount + snapshot.unknownGapCount;

  return (
    <>
      <View style={[styles.banner, {borderBottomColor: stateColor(status)}]}>
        <View style={styles.copy}>
          <Text style={[styles.eyebrow, {color: stateColor(status)}]}>
            CONVOY FORMATION
          </Text>
          <Text style={styles.title}>
            {configured
              ? `${snapshot.members.length} in order · ${snapshot.worstGapState.toUpperCase()}`
              : 'Lead / tail order not configured'}
          </Text>
          <Text style={styles.detail}>
            {configured
              ? attention > 0
                ? `${attention} adjacent gap${attention === 1 ? '' : 's'} need attention or a fresh position.`
                : 'All known adjacent gaps are inside the configured direct-separation thresholds.'
              : 'Bushmesh will not infer convoy order from GPS. Set the real vehicle order explicitly.'}
          </Text>
        </View>
        <TouchableOpacity style={styles.setupButton} onPress={() => setSetupVisible(true)}>
          <Text style={styles.setupButtonText}>{configured ? 'ORDER' : 'SET UP'}</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={setupVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setSetupVisible(false)}>
        <SafeAreaView style={styles.modalSafeArea} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>BUSHMESH CONVOY</Text>
              <Text style={styles.modalTitle}>Formation order</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setSetupVisible(false)}>
              <Text style={styles.closeText}>DONE</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}>
            <ConvoyFormationPanel />
            <View style={styles.shareCard}>
              <Text style={styles.shareEyebrow}>SHARE WITH CONVOY</Text>
              <Text style={styles.shareHint}>
                Shares the explicit order and gap-alert thresholds over the active
                Bushmesh channel. Receivers must review and accept it; Bushmesh never
                replaces their formation automatically.
              </Text>
              <FormationShareControl />
            </View>
            <Text style={styles.modalHint}>
              Order is explicit configuration, not GPS inference. Gap distances are
              straight-line separation and become unknown when a required position
              is stale or lost.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
  },
  copy: {flex: 1, minWidth: 0},
  eyebrow: {fontSize: 8, fontWeight: '900', letterSpacing: 1},
  title: {color: colors.textPrimary, fontSize: 13, fontWeight: '900', marginTop: 2},
  detail: {color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 3},
  setupButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  setupButtonText: {color: colors.accent, fontSize: 8, fontWeight: '900'},
  modalSafeArea: {flex: 1, backgroundColor: colors.background},
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalEyebrow: {color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1},
  modalTitle: {color: colors.textPrimary, fontSize: 22, fontWeight: '900', marginTop: 2},
  closeButton: {
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  closeText: {color: colors.background, fontSize: 9, fontWeight: '900'},
  modalScroll: {flex: 1},
  modalContent: {paddingBottom: 36},
  shareCard: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  shareEyebrow: {color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1},
  shareHint: {color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 4},
  modalHint: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 15,
    marginHorizontal: 20,
    marginTop: 12,
  },
});
