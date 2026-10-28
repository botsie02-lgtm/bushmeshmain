import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {formatDistance} from '../convoy/convoy';
import {
  RecoveryPositionRequestSnapshot,
  getLatestRecoveryPositionRequest,
  queueRecoveryPositionRequest,
  recordRecoveryPositionRequestDrainResult,
} from '../convoy/recoveryPositionRequest';
import {getRecoveryRecommendation} from '../convoy/recoveryRecommendation';
import {useBushMesh} from '../state/BushMeshContext';
import {useConvoy} from '../state/ConvoyContext';
import {useConvoyRecovery} from '../state/ConvoyRecoveryContext';
import {useRadioSession} from '../state/RadioSessionContext';
import {colors} from '../theme/colors';

function formatAge(ageSeconds: number): string {
  if (ageSeconds < 60) {
    return `${ageSeconds}s`;
  }
  if (ageSeconds < 3_600) {
    return `${Math.floor(ageSeconds / 60)}m`;
  }
  return `${Math.floor(ageSeconds / 3_600)}h`;
}

function normalizedIdentity(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(normalized) ? normalized : null;
}

function requestLifecycleText(
  request: RecoveryPositionRequestSnapshot | null,
  nowMs: number,
): string | null {
  if (!request) {
    return null;
  }

  switch (request.state) {
    case 'queued':
      return 'Fresh-position request queued. Peer receipt is not confirmed.';
    case 'accepted':
      return `MeshCore accepted the request for transmission. Waiting up to ${Math.max(
        0,
        Math.ceil((request.expiresAtMs - nowMs) / 1000),
      )}s for a fresh response; peer receipt is not confirmed.`;
    case 'retrying':
      return 'Fresh-position request is waiting for another radio attempt while its TTL remains valid.';
    case 'failed':
      return 'The radio could not accept the fresh-position request after retries.';
    case 'responded':
      return 'A request-driven fresh POSITION response was observed from this vehicle.';
    case 'expired':
      return 'The position-request window expired without a request-driven response being observed.';
  }
}

export function ConvoyRecoveryBanner(): React.JSX.Element | null {
  const {activeChannel} = useBushMesh();
  const {
    navigationTargetVehicleId,
    setNavigationTarget,
    clearNavigationTarget,
  } = useConvoy();
  const {activeCases: recoveryCases} = useConvoyRecovery();
  const {snapshot: radioSession, drainOnce} = useRadioSession();
  const [caseIndex, setCaseIndex] = useState(0);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const requestSequenceRef = useRef(1);

  useEffect(() => {
    if (recoveryCases.length === 0) {
      setCaseIndex(0);
      return;
    }
    setCaseIndex(current => Math.min(current, recoveryCases.length - 1));
  }, [recoveryCases.length]);

  const candidate = recoveryCases[caseIndex] ?? recoveryCases[0] ?? null;

  useEffect(() => {
    setRequestError(null);
    setRequesting(false);
  }, [candidate?.vehicle.id]);

  if (!candidate) {
    return null;
  }

  const {
    vehicle,
    freshness,
    ageSeconds,
    trail,
    checkpoints,
    observedMotion,
    searchArea,
    level,
    reason,
  } = candidate;
  const recommendation = getRecoveryRecommendation(candidate);
  const targeted = navigationTargetVehicleId === vehicle.id;
  const nowMs = Date.now();

  const trailText = trail
    ? trail.pointCount >= 2
      ? `${trail.state.toUpperCase()} TRAIL · ${trail.pointCount} fixes · ${formatDistance(
          trail.retainedDistanceMeters,
        )}`
      : 'NO USEFUL RETAINED TRAIL'
    : 'NO RETAINED TRAIL';

  const uncertaintyText = searchArea
    ? `${formatDistance(searchArea.radiusMeters)} UNCERTAINTY RADIUS`
    : 'LAST FIX STILL WITHIN CURRENT-POSITION WINDOW';

  const checkpoint = checkpoints?.lastContinuousBeforeBreak ?? null;
  const latestBreak = checkpoints?.latestBreak ?? null;
  const checkpointAgeSeconds = checkpoint
    ? Math.max(0, Math.floor((nowMs - checkpoint.receivedAtMs) / 1000))
    : null;

  const showNext = recoveryCases.length > 1;
  const nextCase = () => {
    setCaseIndex(current => (current + 1) % recoveryCases.length);
  };

  const channelIndex = Number(activeChannel?.channelIndex);
  const validChannel =
    Number.isInteger(channelIndex) && channelIndex >= 0 && channelIndex <= 7;
  const ownIdentity = normalizedIdentity(radioSession.identityRef);
  const targetIdentity = normalizedIdentity(vehicle.id);
  const latestRequest = targetIdentity
    ? getLatestRecoveryPositionRequest(targetIdentity, nowMs)
    : null;
  const requestPending =
    latestRequest?.state === 'queued' ||
    latestRequest?.state === 'accepted' ||
    latestRequest?.state === 'retrying';
  const requestCooldownActive =
    latestRequest !== null && nowMs < latestRequest.nextAllowedAtMs;
  const canRequestFix =
    !vehicle.simulated &&
    validChannel &&
    radioSession.transportReady &&
    ownIdentity !== null &&
    targetIdentity !== null &&
    ownIdentity !== targetIdentity &&
    !requestPending &&
    !requestCooldownActive;
  const requestLifecycle = requestLifecycleText(latestRequest, nowMs);

  const nextRequestSequence = (): number => {
    const sequence = requestSequenceRef.current;
    requestSequenceRef.current = sequence >= 0xffff ? 1 : sequence + 1;
    return sequence;
  };

  const requestFix = async () => {
    if (!canRequestFix || !targetIdentity || requesting) {
      return;
    }

    setRequesting(true);
    setRequestError(null);
    try {
      const queued = queueRecoveryPositionRequest({
        channelIndex,
        targetId: targetIdentity,
        sequence: nextRequestSequence(),
      });
      const result = await drainOnce();
      recordRecoveryPositionRequestDrainResult(queued.request.id, result);
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : 'Fresh-position request could not be queued.',
      );
    } finally {
      setRequesting(false);
    }
  };

  return (
    <View
      style={[
        styles.banner,
        level === 'critical'
          ? styles.bannerCritical
          : level === 'high'
            ? styles.bannerHigh
            : styles.bannerWatch,
      ]}>
      <View style={styles.copy}>
        <Text
          style={[
            styles.eyebrow,
            level === 'critical'
              ? styles.criticalText
              : level === 'high'
                ? styles.highText
                : styles.watchText,
          ]}>
          {freshness === 'lost' ? 'LOST VEHICLE' : 'VEHICLE STALE'}
          {showNext ? ` · ${caseIndex + 1} OF ${recoveryCases.length}` : ''}
        </Text>
        <Text style={styles.name} numberOfLines={1}>
          {vehicle.name}
        </Text>
        <Text style={styles.detail}>
          Last heard {formatAge(ageSeconds)} ago · {uncertaintyText}
        </Text>
        <Text style={styles.reason}>{reason}</Text>
        <Text
          style={[
            styles.trail,
            trail?.state === 'usable' && styles.trailGood,
            trail?.state === 'broken' && styles.trailBad,
          ]}>
          {trailText}
        </Text>
        {checkpoint && latestBreak && checkpointAgeSeconds !== null ? (
          <View style={styles.checkpointBox}>
            <Text style={styles.checkpointLabel}>LAST CONTINUOUS CHECKPOINT</Text>
            <Text style={styles.checkpointText}>
              {formatAge(checkpointAgeSeconds)} old · break after this fix ·{' '}
              {formatDistance(latestBreak.distanceJumpMeters)} jump ·{' '}
              {formatAge(Math.round(latestBreak.timeGapSeconds))} gap
            </Text>
            <Text style={styles.checkpointWarning}>
              Newer fixes after the break are kept as evidence, not treated as a continuous trail.
            </Text>
          </View>
        ) : null}
        {observedMotion?.quality === 'usable' ? (
          <Text style={styles.motionText}>
            LAST OBSERVED COURSE · {observedMotion.compassDirection}{' '}
            {Math.round(observedMotion.bearingDegrees)}° ·{' '}
            {Math.round(observedMotion.speedKmh)} km/h ·{' '}
            {formatAge(observedMotion.ageSeconds)} old
          </Text>
        ) : null}
        <Text style={styles.recommendationLabel}>{recommendation.label}</Text>
        <Text style={styles.recommendationDetail}>{recommendation.detail}</Text>
        {requestError ? (
          <Text style={styles.requestError}>{requestError}</Text>
        ) : requestLifecycle ? (
          <Text
            style={[
              styles.requestStatus,
              latestRequest?.state === 'expired' && styles.requestExpired,
              latestRequest?.state === 'failed' && styles.requestFailed,
              latestRequest?.state === 'responded' && styles.requestResponded,
            ]}>
            {requestLifecycle}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[
            styles.button,
            level === 'watch' ? styles.buttonWatch : styles.buttonUrgent,
            targeted && styles.buttonActive,
          ]}
          onPress={() =>
            targeted ? clearNavigationTarget() : setNavigationTarget(vehicle.id)
          }>
          <Text
            style={[
              styles.buttonText,
              level === 'watch' ? styles.buttonWatchText : styles.buttonUrgentText,
              targeted && styles.buttonTextActive,
            ]}>
            {targeted ? 'FOCUSED' : 'RECOVER'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.requestButton,
            !canRequestFix && styles.buttonDisabled,
          ]}
          disabled={!canRequestFix || requesting}
          onPress={() => requestFix().catch(() => undefined)}>
          <Text
            style={[
              styles.requestButtonText,
              !canRequestFix && styles.buttonDisabledText,
            ]}>
            {requesting
              ? 'REQUESTING…'
              : requestPending
                ? 'AWAITING FIX'
                : 'REQUEST FIX'}
          </Text>
        </TouchableOpacity>

        {showNext ? (
          <TouchableOpacity style={styles.nextButton} onPress={nextCase}>
            <Text style={styles.nextButtonText}>NEXT</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
  },
  bannerCritical: {borderBottomColor: colors.danger},
  bannerHigh: {borderBottomColor: colors.warning},
  bannerWatch: {borderBottomColor: colors.accent},
  copy: {flex: 1, minWidth: 0},
  eyebrow: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  criticalText: {color: colors.danger},
  highText: {color: colors.warning},
  watchText: {color: colors.accent},
  name: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 3,
  },
  reason: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 3,
  },
  trail: {
    color: colors.warning,
    fontSize: 9,
    fontWeight: '900',
    marginTop: 3,
  },
  trailGood: {color: colors.success},
  trailBad: {color: colors.danger},
  checkpointBox: {
    marginTop: 6,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 10,
    backgroundColor: colors.surfaceSoft,
  },
  checkpointLabel: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  checkpointText: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
  },
  checkpointWarning: {
    color: colors.textMuted,
    fontSize: 8,
    lineHeight: 12,
    marginTop: 3,
  },
  motionText: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 4,
  },
  recommendationLabel: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '900',
    marginTop: 6,
    letterSpacing: 0.5,
  },
  recommendationDetail: {
    color: colors.textSecondary,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 2,
  },
  requestStatus: {
    color: colors.accent,
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '700',
    marginTop: 5,
  },
  requestExpired: {color: colors.warning},
  requestFailed: {color: colors.danger},
  requestResponded: {color: colors.success},
  requestError: {
    color: colors.danger,
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '700',
    marginTop: 5,
  },
  actions: {alignItems: 'stretch', gap: 6},
  button: {
    minWidth: 82,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  buttonUrgent: {borderColor: colors.danger},
  buttonWatch: {borderColor: colors.accent},
  buttonActive: {backgroundColor: colors.danger},
  buttonText: {fontSize: 9, fontWeight: '900'},
  buttonUrgentText: {color: colors.danger},
  buttonWatchText: {color: colors.accent},
  buttonTextActive: {color: colors.background},
  requestButton: {
    minWidth: 82,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  requestButtonText: {color: colors.accent, fontSize: 8, fontWeight: '900'},
  buttonDisabled: {borderColor: colors.border, opacity: 0.45},
  buttonDisabledText: {color: colors.textMuted},
  nextButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
  },
  nextButtonText: {color: colors.textSecondary, fontSize: 8, fontWeight: '900'},
});
