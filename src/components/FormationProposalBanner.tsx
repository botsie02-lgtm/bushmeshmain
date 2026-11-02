import React, {useMemo, useState} from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {useConvoy} from '../state/ConvoyContext';
import {useFormationProposals} from '../state/FormationProposalContext';
import {useRadioSession} from '../state/RadioSessionContext';
import {colors} from '../theme/colors';

export function FormationProposalBanner(): React.JSX.Element | null {
  const {vehicles} = useConvoy();
  const {snapshot: radioSession} = useRadioSession();
  const {
    proposals,
    latestProposal,
    acceptProposal,
    dismissProposal,
    dismissAll,
  } = useFormationProposals();
  const [reviewVisible, setReviewVisible] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const names = useMemo(
    () => new Map(vehicles.map(vehicle => [vehicle.id.toUpperCase(), vehicle.name])),
    [vehicles],
  );

  if (!latestProposal) {
    return null;
  }

  const localIdentity = radioSession.identityRef?.toUpperCase() ?? null;
  const localIncluded =
    localIdentity !== null &&
    latestProposal.share.memberIds.some(
      memberId => memberId.toUpperCase() === localIdentity,
    );
  const canAccept = localIdentity !== null && localIncluded;

  const memberLabel = (memberId: string): string => {
    const normalized = memberId.toUpperCase();
    if (localIdentity !== null && normalized === localIdentity) {
      return 'You';
    }
    return names.get(normalized) ?? `Vehicle ${normalized.slice(-4)}`;
  };

  const accept = () => {
    try {
      acceptProposal(latestProposal.id);
      setActionError(null);
      setReviewVisible(false);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Bushmesh could not accept the formation proposal.',
      );
    }
  };

  return (
    <>
      <View
        style={[
          styles.banner,
          latestProposal.trust === 'caution-review'
            ? styles.bannerCaution
            : styles.bannerNormal,
        ]}>
        <View style={styles.copy}>
          <Text
            style={[
              styles.eyebrow,
              latestProposal.trust === 'caution-review'
                ? styles.cautionText
                : styles.accentText,
            ]}>
            FORMATION PROPOSAL · REVIEW REQUIRED
          </Text>
          <Text style={styles.title}>
            {latestProposal.share.memberIds.length} members · revision{' '}
            {latestProposal.share.revision}
          </Text>
          <Text style={styles.detail}>
            claimed sender {latestProposal.share.senderId.slice(-6)} ·{' '}
            {proposals.length} pending proposal{proposals.length === 1 ? '' : 's'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.reviewButton}
          onPress={() => {
            setActionError(null);
            setReviewVisible(true);
          }}>
          <Text style={styles.reviewButtonText}>REVIEW</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={reviewVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setReviewVisible(false)}>
        <SafeAreaView style={styles.modal} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>REMOTE FORMATION</Text>
              <Text style={styles.modalTitle}>Review before applying</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setReviewVisible(false)}>
              <Text style={styles.closeText}>CLOSE</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            <View style={styles.warningCard}>
              <Text style={styles.warningTitle}>NOT AUTOMATICALLY TRUSTED</Text>
              <Text style={styles.warningBody}>
                Bushmesh formation sender references are not signed formation
                authority. Compare the proposed order with the convoy and accept it
                only if you expect this change.
              </Text>
            </View>

            <View style={styles.summaryCard}>
              <Text style={styles.sectionEyebrow}>PROPOSAL</Text>
              <Text style={styles.summaryText}>
                Sender {latestProposal.share.senderId} · revision{' '}
                {latestProposal.share.revision}
              </Text>
              <Text style={styles.summaryText}>
                Gap alerts: caution {latestProposal.share.cautionGapMeters} m · critical{' '}
                {latestProposal.share.criticalGapMeters} m
              </Text>
              <Text style={styles.summaryText}>
                Received packet age {latestProposal.packetAgeSeconds}s
              </Text>
            </View>

            {latestProposal.warnings.length > 0 ? (
              <View style={styles.cautionCard}>
                <Text style={styles.cautionTitle}>REVIEW WARNINGS</Text>
                {latestProposal.warnings.map(warning => (
                  <Text key={warning} style={styles.cautionBody}>
                    • {warning}
                  </Text>
                ))}
              </View>
            ) : null}

            <Text style={styles.sectionEyebrow}>ORDER</Text>
            <View style={styles.memberList}>
              {latestProposal.share.memberIds.map((memberId, index) => (
                <View key={memberId} style={styles.memberRow}>
                  <View style={styles.orderBadge}>
                    <Text style={styles.orderNumber}>{index + 1}</Text>
                    <Text style={styles.roleText}>
                      {index === 0
                        ? 'LEAD'
                        : index === latestProposal.share.memberIds.length - 1
                          ? 'TAIL'
                          : 'MEMBER'}
                    </Text>
                  </View>
                  <View style={styles.memberCopy}>
                    <Text style={styles.memberName}>{memberLabel(memberId)}</Text>
                    <Text style={styles.memberId}>{memberId}</Text>
                  </View>
                </View>
              ))}
            </View>

            {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
            {!canAccept ? (
              <Text style={styles.cannotAccept}>
                {localIdentity === null
                  ? 'Connect a radio with a known Bushmesh identity before accepting.'
                  : 'This vehicle is not included in the proposal, so Bushmesh will not apply it.'}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.acceptButton, !canAccept && styles.disabledButton]}
                disabled={!canAccept}
                onPress={accept}>
                <Text style={styles.acceptText}>ACCEPT FORMATION</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dismissButton}
                onPress={() => {
                  dismissProposal(latestProposal.id);
                  setReviewVisible(false);
                }}>
                <Text style={styles.dismissText}>DISMISS</Text>
              </TouchableOpacity>
            </View>

            {proposals.length > 1 ? (
              <TouchableOpacity style={styles.dismissAllButton} onPress={dismissAll}>
                <Text style={styles.dismissAllText}>DISMISS ALL PENDING PROPOSALS</Text>
              </TouchableOpacity>
            ) : null}
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
  bannerNormal: {borderBottomColor: colors.accent},
  bannerCaution: {borderBottomColor: colors.warning},
  copy: {flex: 1, minWidth: 0},
  eyebrow: {fontSize: 8, fontWeight: '900', letterSpacing: 1},
  accentText: {color: colors.accent},
  cautionText: {color: colors.warning},
  title: {color: colors.textPrimary, fontSize: 13, fontWeight: '900', marginTop: 2},
  detail: {color: colors.textSecondary, fontSize: 9, marginTop: 3},
  reviewButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reviewButtonText: {color: colors.accent, fontSize: 8, fontWeight: '900'},
  modal: {flex: 1, backgroundColor: colors.background},
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalEyebrow: {color: colors.warning, fontSize: 9, fontWeight: '900', letterSpacing: 1},
  modalTitle: {color: colors.textPrimary, fontSize: 22, fontWeight: '900', marginTop: 2},
  closeButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeText: {color: colors.textSecondary, fontSize: 8, fontWeight: '900'},
  modalContent: {padding: 18, paddingBottom: 40},
  warningCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.surface,
    padding: 12,
  },
  warningTitle: {color: colors.warning, fontSize: 9, fontWeight: '900'},
  warningBody: {color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 4},
  summaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    marginTop: 10,
  },
  sectionEyebrow: {color: colors.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 14},
  summaryText: {color: colors.textSecondary, fontSize: 10, marginTop: 4},
  cautionCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: 12,
    marginTop: 10,
  },
  cautionTitle: {color: colors.warning, fontSize: 9, fontWeight: '900'},
  cautionBody: {color: colors.textSecondary, fontSize: 9, lineHeight: 14, marginTop: 4},
  memberList: {gap: 7, marginTop: 8},
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 9,
    backgroundColor: colors.surface,
  },
  orderBadge: {width: 45, alignItems: 'center'},
  orderNumber: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  roleText: {color: colors.textMuted, fontSize: 6, fontWeight: '900'},
  memberCopy: {flex: 1},
  memberName: {color: colors.textPrimary, fontSize: 11, fontWeight: '900'},
  memberId: {color: colors.textMuted, fontSize: 8, marginTop: 2},
  actionError: {color: colors.danger, fontSize: 10, lineHeight: 14, marginTop: 12},
  cannotAccept: {color: colors.warning, fontSize: 10, lineHeight: 15, marginTop: 12},
  actions: {flexDirection: 'row', gap: 8, marginTop: 16},
  acceptButton: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    paddingVertical: 12,
  },
  disabledButton: {opacity: 0.35},
  acceptText: {color: colors.background, fontSize: 9, fontWeight: '900'},
  dismissButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {color: colors.textSecondary, fontSize: 9, fontWeight: '900'},
  dismissAllButton: {alignItems: 'center', paddingVertical: 12, marginTop: 8},
  dismissAllText: {color: colors.textMuted, fontSize: 8, fontWeight: '900'},
});
