import React, {useEffect, useMemo, useState} from 'react';
import {AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {
  buildGpsDiagnostics,
  formatGpsAge,
} from '../device/gps/gpsDiagnostics';
import {
  GpsAcquisitionMode,
  GpsPreferencesV1,
  gpsAcquisitionHint,
} from '../device/gps/gpsPreferenceCodec';
import {gpsPreferences} from '../device/gps/gpsPreferences';
import {
  GpsReadinessSnapshot,
  readAndroidGpsReadiness,
} from '../device/gps/gpsReadiness';
import {useLocationSession} from '../state/LocationSessionContext';
import {colors} from '../theme/colors';

const acquisitionOptions: Array<{value: GpsAcquisitionMode; label: string}> = [
  {value: 'responsive', label: 'Responsive'},
  {value: 'balanced', label: 'Balanced'},
  {value: 'battery-saver', label: 'Battery saver'},
];

function GpsRow({label, value, caution}: {
  label: string; value: string; caution?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, caution && styles.warning]}>{value}</Text>
    </View>
  );
}

function Choice<T extends string | number>({
  options, selected, onSelect, disabled,
}: {
  options: Array<{label: string; value: T}>;
  selected: T;
  onSelect: (next: T) => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.options}>
      {options.map(option => (
        <TouchableOpacity
          key={String(option.value)}
          accessibilityRole="button"
          accessibilityState={{selected: option.value === selected, disabled}}
          disabled={disabled}
          style={[styles.choice, option.value === selected && styles.selected,
            disabled && styles.disabled]}
          onPress={() => onSelect(option.value)}>
          <Text style={[styles.choiceText,
            option.value === selected && styles.selectedText]}>
            {option.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Section({title, children}: {
  title: string; children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * Drop-in Device GPS settings module. No permission requests or GPS/radio
 * lifecycle commands are issued by mounting, unmounting, refreshing or editing.
 * Integrator should place it alongside the existing LocationScreen controls.
 */
export function DeviceGpsSettingsPanel(): React.JSX.Element {
  const session = useLocationSession();
  const [preferences, setPreferences] = useState<GpsPreferencesV1>(
    gpsPreferences.snapshot(),
  );
  const [readiness, setReadiness] = useState<GpsReadinessSnapshot | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(Date.now());

  useEffect(() => {
    let active = true;
    const unsub = gpsPreferences.subscribe(() => {
      if (active) setPreferences(gpsPreferences.snapshot());
    });
    gpsPreferences.initialize().catch(() => undefined);
    return () => {active = false; unsub();};
  }, []);

  useEffect(() => {
    let active = true;
    const inspect = () => {
      setLoadingReadiness(true);
      readAndroidGpsReadiness()
        .then(value => {if (active) setReadiness(value);})
        .catch(error => {
          if (active) setStatus(error instanceof Error
            ? error.message : 'GPS diagnostics read failed.');
        })
        .finally(() => {if (active) setLoadingReadiness(false);});
    };
    inspect();
    const listener = AppState.addEventListener('change', next => {
      if (next === 'active') inspect();
    });
    const clock = setInterval(() => setClockMs(Date.now()), 10_000);
    return () => {active = false; listener.remove(); clearInterval(clock);};
  }, []);

  const result = useMemo(() => readiness ? buildGpsDiagnostics({
    readiness,
    session: {
      status: session.status,
      providerLabel: session.providerLabel,
      latestFix: session.latestFix,
      trackPoints: session.trackPoints,
    },
    preferences,
    nowMs: clockMs,
  }) : null, [
    readiness, session.status, session.providerLabel,
    session.latestFix, session.trackPoints, preferences, clockMs,
  ]);

  const save = async (patch: Partial<Omit<GpsPreferencesV1, 'version'>>) => {
    setSaving(true);
    setStatus(null);
    try {
      await gpsPreferences.update(patch);
      setStatus('Saved. GPS acquisition changes apply on your next manual GPS start.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'GPS preferences could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const hint = gpsAcquisitionHint(preferences.acquisitionMode);
  const fix = result?.fix;
  const positionText = fix
    ? fix.latitude.toFixed(5) + ', ' + fix.longitude.toFixed(5)
    : 'No recorded position';
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>DEVICE / LOCATION</Text>
        <Text style={styles.title}>Phone GPS & preferences</Text>
        <Text style={styles.description}>
          Inspect Android GPS permissions, source, freshness and battery policy.
          Reading this screen never requests access or starts tracking.
        </Text>
      </View>

      <Section title="Permission & availability">
        <GpsRow label="Precise GPS permission"
          value={readiness?.precisePermission ?? 'Checking…'}
          caution={readiness?.precisePermission !== 'granted'} />
        <GpsRow label="Approximate permission"
          value={readiness?.approximatePermission ?? 'Checking…'} />
        <GpsRow label="Android GPS switch"
          value={readiness?.gpsEnabled === true ? 'Enabled'
            : readiness?.gpsEnabled === false ? 'Disabled' : 'Unknown'}
          caution={readiness?.gpsEnabled !== true} />
        <GpsRow label="Native provider" value={readiness?.provider ?? 'Unavailable'} />
        <GpsRow label="Location feature"
          value={readiness?.supported ? 'Available' : 'Unavailable'} />
        <GpsRow label="Readiness"
          value={result?.availability.replace(/-/g, ' ').toUpperCase() ?? 'Checking…'}
          caution={result?.availability !== 'ready'} />
        <Text style={styles.description}>
          {result?.availabilityHint ?? 'Checking Android permission and GPS state…'}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={loadingReadiness}
          style={[styles.button, loadingReadiness && styles.disabled]}
          onPress={() => {
            setLoadingReadiness(true);
            readAndroidGpsReadiness().then(setReadiness)
              .catch(error => setStatus(error instanceof Error
                ? error.message : 'Unable to inspect Android GPS.'))
              .finally(() => setLoadingReadiness(false));
          }}>
          <Text style={styles.buttonText}>
            {loadingReadiness ? 'CHECKING…' : 'REFRESH READ-ONLY STATUS'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.note}>
          Permission changes are handled by Android or the existing explicit
          Start GPS control. No new permission prompt is shown here.
        </Text>
      </Section>

      <Section title="Foreground / background readiness">
        <GpsRow label="App visibility"
          value={readiness?.visibility ?? 'Unknown'} />
        <GpsRow label="Foreground GPS start"
          value={result?.foregroundStartReady ? 'Ready' : 'Not ready'}
          caution={!result?.foregroundStartReady} />
        <GpsRow label="Independent background start"
          value={result?.backgroundStartReady ? 'Ready' : 'Not configured'}
          caution />
        <GpsRow label="Native tracking"
          value={readiness?.nativeTracking === true ? 'Active'
            : readiness?.nativeTracking === false ? 'Stopped' : 'Unknown'} />
        <Text style={styles.description}>
          {result?.backgroundHint ??
            'Checking foreground service and background location prerequisites…'}
        </Text>
        <Text style={styles.note}>
          Android foreground location support is present; this build does not
          declare ACCESS_BACKGROUND_LOCATION. A session started visibly may
          continue in a foreground service, but restart from the background is
          not guaranteed. GPS settings never start the native radio service.
        </Text>
      </Section>

      <Section title="GPS acquisition & battery">
        <Text style={styles.description}>
          Controls Android GPS location-update requests, not the LoRa position
          transmission scheduler. Saving never restarts active tracking.
        </Text>
        <Choice options={acquisitionOptions}
          selected={preferences.acquisitionMode} disabled={saving}
          onSelect={value => {save({acquisitionMode: value}).catch(() => undefined);}} />
        <GpsRow label="Requested minimum interval"
          value={hint.minTimeMs / 1_000 + ' s'} />
        <GpsRow label="Requested minimum movement"
          value={hint.minDistanceMeters + ' m'} />
        <Text style={styles.note}>{hint.description}. Actual cadence depends on
          GPS conditions, Android power management and device capabilities.</Text>
      </Section>

      <Section title="Freshness & accuracy warnings">
        <Text style={styles.label}>Warn when last location is older than</Text>
        <Choice
          options={[{label: '45 sec', value: 45 as const},
            {label: '90 sec', value: 90 as const},
            {label: '3 min', value: 180 as const}]}
          selected={preferences.staleAfterSeconds} disabled={saving}
          onSelect={value => {save({staleAfterSeconds: value}).catch(() => undefined);}} />
        <Text style={styles.label}>Flag accuracy worse than</Text>
        <Choice
          options={[{label: '25 m', value: 25 as const},
            {label: '100 m', value: 100 as const},
            {label: '500 m', value: 500 as const}]}
          selected={preferences.accuracyWarningMeters} disabled={saving}
          onSelect={value => {save({accuracyWarningMeters: value}).catch(() => undefined);}} />
        <Text style={styles.note}>
          Display thresholds only. The existing 45-second radio recovery-response
          freshness guard and adaptive LoRa airtime policy stay unchanged.
        </Text>
      </Section>

      <Section title="Privacy">
        <Text style={styles.description}>Hide precise coordinates in Device GPS diagnostics.</Text>
        <Choice options={[{label: 'Hide coordinates', value: 'hide'},
          {label: 'Show coordinates', value: 'show'}]}
          selected={preferences.showCoordinates ? 'show' : 'hide'}
          disabled={saving}
          onSelect={value => {save({showCoordinates: value === 'show'}).catch(() => undefined);}} />
        <Text style={styles.note}>
          Preferences store no coordinates or security material. Existing
          encrypted breadcrumb recording has its own lifecycle.
        </Text>
      </Section>

      <Section title="Read-only position diagnostics">
        <GpsRow label="Location session" value={session.status} />
        <GpsRow label="Reported source"
          value={result?.locationSourceLabel ?? 'Unknown'} />
        <GpsRow label="Last position classification"
          value={result?.fixState.toUpperCase() ?? 'UNKNOWN'}
          caution={result?.fixState === 'stale' ||
            result?.fixState === 'future-dated' ||
            result?.fixState === 'invalid'} />
        <GpsRow label="Last recorded age"
          value={formatGpsAge(result?.fixAgeMs ?? null)} />
        <GpsRow label="Accuracy"
          value={fix?.accuracyMeters == null ? 'Not reported'
            : '±' + fix.accuracyMeters.toFixed(0) + ' m'} />
        <GpsRow label="Accuracy assessment"
          value={result?.accuracyAssessment ?? 'unknown'}
          caution={result?.accuracyAssessment === 'low-accuracy'} />
        <GpsRow label="Altitude"
          value={fix?.altitudeMeters == null ? 'Not reported'
            : fix.altitudeMeters.toFixed(0) + ' m'} />
        <GpsRow label="Heading"
          value={fix?.headingDegrees == null ? 'Not reported'
            : fix.headingDegrees.toFixed(0) + '°'} />
        <GpsRow label="Position"
          value={preferences.showCoordinates ? positionText : 'Hidden by preference'} />
        <GpsRow label="Recorded breadcrumbs" value={String(session.trackPoints.length)} />
        <GpsRow label="Accepted position plans"
          value={String(session.transmittedPlanCount)} />
        <GpsRow label="Rejected fixes"
          value={String(session.rejectedFixCount)} />
        {session.lastPlan?.decision ? (
          <GpsRow label="Existing LoRa airtime policy"
            value={session.lastPlan.decision.reason + ' / ' +
              Math.round(session.lastPlan.decision.intervalMs / 1_000) + ' s'} />
        ) : null}
        <Text style={styles.note}>
          A saved breadcrumb is historical, not proof of a live fix or another
          vehicle receiving a transmission. No new location queries are made.
        </Text>
        {session.lastError ? (
          <Text style={styles.warning}>Location session: {session.lastError}</Text>
        ) : null}
      </Section>
      {readiness?.error ? <Text style={styles.warning}>{readiness.error}</Text> : null}
      {gpsPreferences.getError() ? (
        <Text style={styles.warning}>{gpsPreferences.getError()}</Text>
      ) : null}
      {status ? <Text accessibilityRole="alert" style={styles.message}>{status}</Text> : null}
      <Text style={styles.note}>
        Preferences are local to this phone. Existing GPS start/stop controls
        remain the only way to change the active location session.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {flex: 1, backgroundColor: colors.background},
  content: {padding: 14, paddingBottom: 34, gap: 13},
  hero: {backgroundColor: colors.surfaceSoft, borderRadius: 18, padding: 17, gap: 7},
  eyebrow: {color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1},
  title: {color: colors.textPrimary, fontSize: 21, fontWeight: '900'},
  description: {color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 6},
  card: {backgroundColor: colors.surface, borderColor: colors.border,
    borderWidth: 1, borderRadius: 16, padding: 14, gap: 8},
  heading: {fontSize: 15, fontWeight: '900', color: colors.textPrimary},
  row: {flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    paddingVertical: 7},
  label: {color: colors.textSecondary, fontSize: 11, flex: 1},
  value: {color: colors.textPrimary, fontSize: 11, textAlign: 'right',
    flex: 1, fontWeight: '700'},
  warning: {color: colors.warning, fontSize: 11, lineHeight: 16},
  note: {color: colors.textMuted, fontSize: 10, lineHeight: 16, marginTop: 4},
  options: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginVertical: 3},
  choice: {paddingVertical: 9, paddingHorizontal: 11,
    borderWidth: 1, borderColor: colors.border, borderRadius: 11},
  selected: {backgroundColor: colors.accent, borderColor: colors.accent},
  choiceText: {fontWeight: '800', fontSize: 10, color: colors.textSecondary},
  selectedText: {color: colors.background},
  disabled: {opacity: 0.45},
  button: {padding: 11, borderColor: colors.border, borderWidth: 1,
    borderRadius: 10, alignItems: 'center'},
  buttonText: {color: colors.accent, fontWeight: '900', fontSize: 10},
  message: {color: colors.textPrimary, fontSize: 11, lineHeight: 16},
});
