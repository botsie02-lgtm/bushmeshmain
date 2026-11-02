import React, {useEffect, useMemo, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {buddyTailDistanceMeters} from '../convoy/buddyTails';
import {distanceMeters, formatDistance} from '../convoy/convoy';
import {getFieldTargetGuidance} from '../convoy/fieldTarget';
import {getMovingTargetGuidance} from '../convoy/movingTarget';
import {RecoveryTrailAssessment} from '../convoy/recoveryTrail';
import {useConvoy} from '../state/ConvoyContext';
import {useRouteSession} from '../state/RouteSessionContext';
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

function fixedTargetEyebrow(
  type: string,
  expired: boolean,
  arrived: boolean,
): string {
  if (expired) {
    return 'TARGET EXPIRED · HOLD';
  }
  if (arrived) {
    return 'ARRIVED';
  }

  switch (type) {
    case 'regroup':
      return 'NAVIGATE TO REGROUP';
    case 'help':
      return 'NAVIGATE TO HELP';
    case 'hazard':
      return 'HAZARD LOCATION';
    case 'stop':
      return 'STOP LOCATION';
    default:
      return 'FIXED FIELD TARGET';
  }
}

function recoveryTrailLabel(
  assessment: RecoveryTrailAssessment | null,
): string | null {
  if (!assessment || assessment.pointCount < 2) {
    return null;
  }

  switch (assessment.state) {
    case 'usable':
      return `RECOVERY TRAIL · ${assessment.pointCount} fixes · ${formatDistance(
        assessment.retainedDistanceMeters,
      )}`;
    case 'aging':
      return `AGING TRAIL · ${formatAge(assessment.lastPointAgeSeconds)} old · ${formatDistance(
        assessment.retainedDistanceMeters,
      )}`;
    case 'stale':
      return `STALE TRAIL · ${formatAge(assessment.lastPointAgeSeconds)} old · REFERENCE ONLY`;
    case 'broken':
      return 'TRAIL GAP DETECTED · DO NOT TREAT AS CONTINUOUS';
  }
}

export function DriveNavigationBanner(): React.JSX.Element | null {
  const {
    localPosition,
    navigationTargetVehicleId,
    navigationTargetVehicle,
    navigationFieldTarget,
    getBuddyTail,
    getRecoveryTrailAssessment,
    getRecoverySearchArea,
    clearNavigationTarget,
  } = useConvoy();
  const {
    engineInfo,
    status: routeStatus,
    activePlan,
    planTo,
    clearRoute,
  } = useRouteSession();
  const [nowMs, setNowMs] = useState(Date.now());
  const previousTargetKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const movingGuidance = useMemo(
    () => getMovingTargetGuidance(localPosition, navigationTargetVehicle, nowMs),
    [localPosition, navigationTargetVehicle, nowMs],
  );
  const fixedGuidance = useMemo(
    () => getFieldTargetGuidance(localPosition, navigationFieldTarget, nowMs),
    [localPosition, navigationFieldTarget, nowMs],
  );
  const buddyTail = useMemo(
    () =>
      navigationTargetVehicleId
        ? getBuddyTail(navigationTargetVehicleId)
        : null,
    [getBuddyTail, navigationTargetVehicleId],
  );
  const recoveryTrail = useMemo(
    () =>
      navigationTargetVehicleId
        ? getRecoveryTrailAssessment(navigationTargetVehicleId, nowMs)
        : null,
    [getRecoveryTrailAssessment, navigationTargetVehicleId, nowMs],
  );
  const recoverySearchArea = useMemo(
    () =>
      navigationTargetVehicleId
        ? getRecoverySearchArea(navigationTargetVehicleId, nowMs)
        : null,
    [getRecoverySearchArea, navigationTargetVehicleId, nowMs],
  );
  const recoveryTrailText = recoveryTrailLabel(recoveryTrail);
  const tailDistanceMeters = buddyTail ? buddyTailDistanceMeters(buddyTail) : 0;

  const targetKey = navigationFieldTarget
    ? `field:${navigationFieldTarget.id}`
    : navigationTargetVehicleId
      ? `vehicle:${navigationTargetVehicleId}`
      : null;

  useEffect(() => {
    const previous = previousTargetKeyRef.current;
    previousTargetKeyRef.current = targetKey;
    if (
      previous !== null &&
      targetKey !== previous &&
      activePlan !== null
    ) {
      clearRoute().catch(() => undefined);
    }
  }, [activePlan, clearRoute, targetKey]);

  const currentDestination = navigationFieldTarget
    ? {
        latitude: navigationFieldTarget.latitude,
        longitude: navigationFieldTarget.longitude,
      }
    : navigationTargetVehicle
      ? {
          latitude: navigationTargetVehicle.latitude,
          longitude: navigationTargetVehicle.longitude,
        }
      : null;

  const routedDestination = activePlan
    ? activePlan.geometry[activePlan.geometry.length - 1] ?? null
    : null;
  const routeTargetDeltaMeters =
    currentDestination && routedDestination
      ? distanceMeters(currentDestination, routedDestination)
      : null;
  const routeMatchesTarget =
    routeTargetDeltaMeters !== null && routeTargetDeltaMeters <= 100;
  const routePlanning = routeStatus === 'planning';

  const stopNavigation = () => {
    clearNavigationTarget();
    clearRoute().catch(() => undefined);
  };

  const requestRoute = () => {
    if (!currentDestination || routePlanning) {
      return;
    }
    planTo(currentDestination).catch(() => undefined);
  };

  const routeButton = (enabled: boolean) => {
    if (engineInfo === null) {
      return null;
    }

    const label = routePlanning
      ? 'ROUTING…'
      : activePlan === null
        ? 'ROUTE'
        : routeMatchesTarget
          ? 'ROUTED'
          : 'REPLAN';
    const actionable = enabled && !routePlanning && !routeMatchesTarget;

    return (
      <TouchableOpacity
        style={[
          styles.routeButton,
          routeMatchesTarget && styles.routeButtonActive,
          !actionable && !routeMatchesTarget && styles.routeButtonDisabled,
        ]}
        onPress={requestRoute}
        disabled={!actionable}>
        <Text
          style={[
            styles.routeButtonText,
            routeMatchesTarget && styles.routeButtonTextActive,
          ]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const hasVehicleTarget = navigationTargetVehicleId !== null;
  const hasFieldTarget = navigationFieldTarget !== null;
  if (!hasVehicleTarget && !hasFieldTarget) {
    return null;
  }

  if (hasFieldTarget && navigationFieldTarget) {
    const expired =
      fixedGuidance?.expired ??
      (navigationFieldTarget.expiresAtMs !== null &&
        navigationFieldTarget.expiresAtMs <= nowMs);
    const arrived = fixedGuidance?.arrived ?? false;
    const routeEnabled = fixedGuidance !== null && !expired && !arrived;

    return (
      <View
        style={[
          styles.banner,
          expired
            ? styles.bannerHold
            : arrived
              ? styles.bannerArrived
              : styles.bannerFixed,
        ]}>
        <View style={styles.targetCopy}>
          <Text style={styles.eyebrow}>
            {fixedTargetEyebrow(navigationFieldTarget.type, expired, arrived)}
          </Text>
          <Text style={styles.targetName} numberOfLines={1}>
            {navigationFieldTarget.label}
          </Text>
          <Text
            style={
              expired
                ? styles.tailText
                : arrived
                  ? styles.arrivedText
                  : styles.fixedText
            }>
            {arrived
              ? `WITHIN ${fixedGuidance?.arrivalRadiusMeters ?? 0} M · sender ${navigationFieldTarget.senderId.slice(-6)}`
              : `FIXED POINT · sender ${navigationFieldTarget.senderId.slice(-6)}`}
          </Text>
        </View>

        {fixedGuidance ? (
          <View style={styles.guidance}>
            <Text style={arrived ? styles.arrivedBearing : styles.bearing}>
              {arrived
                ? 'ON SCENE'
                : `${fixedGuidance.compassDirection} ${Math.round(
                    fixedGuidance.bearingDegrees,
                  )}°`}
            </Text>
            <Text style={styles.distance}>
              {formatDistance(fixedGuidance.distanceMeters)}
            </Text>
            <Text
              style={
                expired
                  ? styles.freshnessHold
                  : arrived
                    ? styles.freshnessArrived
                    : styles.freshnessFixed
              }>
              {expired
                ? 'EXPIRED · DO NOT RELY'
                : arrived
                  ? 'ARRIVAL RADIUS'
                  : 'FIXED LOCATION'}
            </Text>
          </View>
        ) : (
          <View style={styles.guidance}>
            <Text style={styles.waiting}>WAITING FOR GPS</Text>
          </View>
        )}

        <View style={styles.actions}>
          {routeButton(routeEnabled)}
          <TouchableOpacity style={styles.stopButton} onPress={stopNavigation}>
            <Text style={styles.stopText}>×</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const safeToFollow = movingGuidance?.safeToFollow ?? false;
  const hasUsefulTail = (buddyTail?.points.length ?? 0) > 1;

  return (
    <View
      style={[
        styles.banner,
        safeToFollow ? styles.bannerLive : styles.bannerHold,
      ]}>
      <View style={styles.targetCopy}>
        <Text style={styles.eyebrow}>
          {safeToFollow ? 'NAVIGATE TO MATE' : 'LAST KNOWN · HOLD'}
        </Text>
        <Text style={styles.targetName} numberOfLines={1}>
          {navigationTargetVehicle?.name ?? 'Target unavailable'}
        </Text>
        {!safeToFollow && recoveryTrailText ? (
          <Text
            style={
              recoveryTrail?.state === 'usable'
                ? styles.recoveryTrailUsable
                : recoveryTrail?.state === 'aging'
                  ? styles.recoveryTrailAging
                  : styles.tailText
            }>
            {recoveryTrailText}
          </Text>
        ) : !safeToFollow && hasUsefulTail ? (
          <Text style={styles.tailText}>
            BUDDY TAIL · {buddyTail?.points.length ?? 0} fixes ·{' '}
            {formatDistance(tailDistanceMeters)} retained path
          </Text>
        ) : null}
        {!safeToFollow && recoverySearchArea ? (
          <Text style={styles.searchAreaText}>
            UNCERTAINTY AREA · radius {formatDistance(recoverySearchArea.radiusMeters)} ·{' '}
            {recoverySearchArea.confidenceLabel.toUpperCase()}
          </Text>
        ) : null}
      </View>

      {movingGuidance ? (
        <View style={styles.guidance}>
          <Text style={styles.bearing}>
            {movingGuidance.compassDirection}{' '}
            {Math.round(movingGuidance.bearingDegrees)}°
          </Text>
          <Text style={styles.distance}>
            {formatDistance(movingGuidance.distanceMeters)}
          </Text>
          <Text
            style={safeToFollow ? styles.freshnessLive : styles.freshnessHold}>
            {movingGuidance.freshness.toUpperCase()} ·{' '}
            {formatAge(movingGuidance.ageSeconds)}
          </Text>
        </View>
      ) : (
        <View style={styles.guidance}>
          <Text style={styles.waiting}>WAITING FOR GPS</Text>
        </View>
      )}

      <View style={styles.actions}>
        {routeButton(safeToFollow && movingGuidance !== null)}
        <TouchableOpacity style={styles.stopButton} onPress={stopNavigation}>
          <Text style={styles.stopText}>×</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    backgroundColor: colors.surface,
  },
  bannerLive: {borderBottomColor: colors.success},
  bannerFixed: {borderBottomColor: colors.accent},
  bannerArrived: {borderBottomColor: colors.success},
  bannerHold: {borderBottomColor: colors.warning},
  targetCopy: {flex: 1, minWidth: 0},
  eyebrow: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  targetName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 3,
  },
  tailText: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 3,
  },
  recoveryTrailUsable: {
    color: colors.success,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 3,
  },
  recoveryTrailAging: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 3,
  },
  searchAreaText: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 3,
  },
  fixedText: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 3,
  },
  arrivedText: {
    color: colors.success,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 3,
  },
  guidance: {alignItems: 'flex-end', marginLeft: 10},
  bearing: {color: colors.accent, fontSize: 18, fontWeight: '900'},
  arrivedBearing: {color: colors.success, fontSize: 15, fontWeight: '900'},
  distance: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 1,
  },
  freshnessLive: {
    color: colors.success,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 2,
  },
  freshnessFixed: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 2,
  },
  freshnessArrived: {
    color: colors.success,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 2,
  },
  freshnessHold: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 2,
  },
  waiting: {color: colors.warning, fontSize: 10, fontWeight: '900'},
  actions: {
    alignItems: 'center',
    gap: 6,
    marginLeft: 10,
  },
  routeButton: {
    minWidth: 58,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  routeButtonActive: {backgroundColor: colors.accent},
  routeButtonDisabled: {opacity: 0.4},
  routeButtonText: {color: colors.accent, fontSize: 7, fontWeight: '900'},
  routeButtonTextActive: {color: colors.background},
  stopButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopText: {
    color: colors.textSecondary,
    fontSize: 22,
    lineHeight: 23,
    fontWeight: '700',
  },
});
