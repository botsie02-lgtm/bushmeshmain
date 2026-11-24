import React, {useEffect, useRef, useState} from 'react';
import {AppState, StyleSheet, Text, View} from 'react-native';

import {gpsPreferences} from '../../device/gps/gpsPreferences';
import {
  GpsReadinessSnapshot,
  readAndroidGpsReadiness,
} from '../../device/gps/gpsReadiness';
import {useLocationSession} from '../../state/LocationSessionContext';
import {colors} from '../../theme/colors';
import {
  DriveMotionStabilizer,
  driveGpsDisplay,
} from './driveGpsMotion';

export function DriveGpsStatusBanner({radioStatus}: {
  radioStatus: 'ready' | 'connected' | 'offline';
}): React.JSX.Element {
  const {latestFix, providerLabel, status} = useLocationSession();
  const [readiness, setReadiness] = useState<GpsReadinessSnapshot | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [prefs, setPrefs] = useState(gpsPreferences.snapshot());
  const [, refreshRender] = useState(0);
  const stabilizer = useRef(new DriveMotionStabilizer()).current;
  const sourceRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = gpsPreferences.subscribe(() => setPrefs(gpsPreferences.snapshot()));
    gpsPreferences.initialize().catch(() => undefined);
    return unsub;
  }, []);

  useEffect(() => {
    let mounted = true;
    let request = 0;
    const check = () => {
      const sequence = ++request;
      readAndroidGpsReadiness().then(result => {
        if (mounted && sequence === request) setReadiness(result);
      }).catch(() => {
        if (mounted && sequence === request) setReadiness(null);
      });
    };
    check();
    const timer = setInterval(() => {
      setNowMs(Date.now());
      if (AppState.currentState === 'active') check();
    }, 5_000);
    const app = AppState.addEventListener('change', () => {
      setNowMs(Date.now());
      check();
    });
    return () => {mounted = false; request += 1; clearInterval(timer); app.remove();};
  }, []);

  useEffect(() => {
    if (providerLabel !== sourceRef.current ||
        (status !== 'tracking' && status !== 'tracking-no-link')) {
      stabilizer.clear();
      sourceRef.current = providerLabel;
    }
    if (providerLabel === 'Android GPS' &&
        (status === 'tracking' || status === 'tracking-no-link')) {
      stabilizer.observe(latestFix, Date.now());
    }
    refreshRender(value => value + 1);
  }, [latestFix, providerLabel, status, stabilizer]);

  // Render revision ensures the in-memory smoothing updates after every accepted fix.
  // No service command or side effect is part of this projection.
  const display = driveGpsDisplay({
    fix: latestFix,
    status,
    providerLabel,
    readiness,
    prefs,
    nowMs,
    radioStatus,
    stabilizer,
  });

  return (
    <View accessible accessibilityLabel={'Drive GPS: ' + display.statusLabel +
      '. Radio: ' + display.radioLabel} style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>FIELD GPS / RADIO</Text>
        <Text style={[styles.status, display.navigationReliable
          ? styles.good : styles.warning]}>{display.statusLabel}</Text>
      </View>
      <Text style={styles.radio}>{display.radioLabel}</Text>
      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.label}>SPEED</Text>
          <Text style={styles.value}>{display.speedLabel}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.label}>COURSE</Text>
          <Text style={styles.value}>{display.headingLabel}</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.label}>FIX AGE</Text>
          <Text style={styles.value}>{display.positionAgeLabel}</Text>
        </View>
      </View>
      <Text style={styles.secondary}>Reported accuracy: {display.accuracyLabel}
        {' · '}Source: {display.sourceLabel}</Text>
      <Text style={[styles.notice, !display.navigationReliable && styles.warning]}>
        {display.warning}
      </Text>
      <Text style={styles.note}>
        Display-only readings. No GPS starts, permission prompts or position transmissions.
        Heading/speed are suppressed when source, freshness or accuracy is untrusted.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {backgroundColor: colors.surface, borderColor: colors.border,
    borderWidth: 1, borderRadius: 16, padding: 15, gap: 9},
  header: {flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', flexWrap: 'wrap', gap: 8},
  eyebrow: {fontSize: 11, fontWeight: '900', letterSpacing: 0.8,
    color: colors.textPrimary},
  status: {fontWeight: '900', fontSize: 14},
  good: {color: colors.success},
  warning: {color: colors.warning},
  radio: {fontSize: 12, fontWeight: '800', color: colors.textSecondary},
  metrics: {flexDirection: 'row', flexWrap: 'wrap', gap: 9},
  metric: {flexGrow: 1, minWidth: 85, gap: 3},
  label: {color: colors.textMuted, fontWeight: '800', fontSize: 10},
  value: {color: colors.textPrimary, fontWeight: '900', fontSize: 16},
  secondary: {color: colors.textSecondary, fontSize: 11},
  notice: {color: colors.textPrimary, fontSize: 12, fontWeight: '700',
    lineHeight: 18},
  note: {color: colors.textMuted, fontSize: 10, lineHeight: 14},
});
