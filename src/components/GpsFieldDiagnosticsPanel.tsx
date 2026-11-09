import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  GpsFieldMonitor,
  GpsFieldInput,
  gpsFieldExportSummary,
} from '../device/gps/gpsFieldDiagnostics';
import {GpsPreferencesV1} from '../device/gps/gpsPreferenceCodec';
import {gpsPreferences} from '../device/gps/gpsPreferences';
import {
  GpsReadinessSnapshot,
  readAndroidGpsReadiness,
} from '../device/gps/gpsReadiness';
import {nativeFileExport} from '../native/NativeFileExport';
import {useLocationSession} from '../state/LocationSessionContext';
import {colors} from '../theme/colors';

function Duration({ms}: {ms: number | null}): React.JSX.Element {
  if (ms === null) return <Text style={styles.value}>Not observed</Text>;
  const text = ms < 1_000 ? Math.round(ms) + ' ms'
    : (ms / 1_000).toFixed(1) + ' s';
  return <Text style={styles.value}>{text}</Text>;
}

function Reading({name, value, caution = false}: {
  name: string;
  value: string;
  caution?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.reading}>
      <Text style={styles.label}>{name}</Text>
      <Text style={[styles.value, caution && styles.warning]}>{value}</Text>
    </View>
  );
}

/**
 * A read-only child of the existing DeviceGpsSettingsPanel.
 * Polls existing status/permission-check APIs (not GPS fixes) while mounted;
 * accepted live fixes come exclusively from LocationSessionProvider state.
 * No NativeEventEmitter, GPS start/stop, radio commands or permission requests.
 */
export function GpsFieldDiagnosticsPanel(): React.JSX.Element {
  const session = useLocationSession();
  const monitorRef = useRef<GpsFieldMonitor | null>(null);
  if (monitorRef.current === null) monitorRef.current = new GpsFieldMonitor();
  const monitor = monitorRef.current;
  const [preferences, setPreferences] = useState<GpsPreferencesV1>(
    gpsPreferences.snapshot(),
  );
  const [readiness, setReadiness] = useState<GpsReadinessSnapshot | null>(null);
  const [checkedError, setCheckedError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [generation, setGeneration] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [includeCoordinates, setIncludeCoordinates] = useState(false);
  const exportSupported = nativeFileExport.isSupported();

  useEffect(() => {
    const unsub = gpsPreferences.subscribe(() => {
      setPreferences(gpsPreferences.snapshot());
    });
    gpsPreferences.initialize().catch(() => undefined);
    return unsub;
  }, []);

  useEffect(() => {
    let mounted = true;
    let requestNumber = 0;
    const refresh = () => {
      const request = ++requestNumber;
      readAndroidGpsReadiness().then(result => {
        if (!mounted || request !== requestNumber) return;
        setReadiness(result);
        setCheckedError(null);
      }).catch(error => {
        if (!mounted || request !== requestNumber) return;
        setCheckedError(error instanceof Error ? error.message : 'GPS status read failed.');
      });
    };
    refresh();
    const timer = setInterval(() => {
      setNowMs(Date.now());
      // Avoid starting background work. Status refresh resumes on foreground.
      if (AppState.currentState === 'active') refresh();
    }, 10_000);
    const listener = AppState.addEventListener('change', () => {
      setNowMs(Date.now());
      refresh();
    });
    return () => {
      mounted = false;
      requestNumber += 1;
      clearInterval(timer);
      listener.remove();
    };
  }, []);

  const input = useMemo<GpsFieldInput>(() => ({
    readiness,
    preferences,
    nowMs,
    session: {
      status: session.status,
      providerLabel: session.providerLabel,
      latestFix: session.latestFix,
      trackPoints: session.trackPoints,
    },
  }), [
    readiness, preferences, nowMs, session.status, session.providerLabel,
    session.latestFix, session.trackPoints,
  ]);

  useEffect(() => {
    monitor.observe(input);
    setGeneration(value => value + 1);
  }, [monitor, input]);

  // The revision is incremented by observation, never by report computation.
  const report = useMemo(
    () => monitor.report(input),
    [monitor, input, generation],
  );

  const reset = () => {
    monitor.reset(input);
    setIncludeCoordinates(false);
    setExportMessage('Diagnostic counters reset. GPS session and saved tracks were not touched.');
    setGeneration(value => value + 1);
  };

  const exportReport = async () => {
    if (exporting || !exportSupported) return;
    setExporting(true);
    setExportMessage(null);
    try {
      const summary = gpsFieldExportSummary({
        report, preferences, nowMs: Date.now(),
        includePreciseCoordinates: includeCoordinates,
      });
      const filename = 'bushmesh-gps-field-' +
        new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      const file = await nativeFileExport.saveJson(
        filename, JSON.stringify(summary, null, 2),
      );
      setExportMessage('Saved GPS technical report: ' + file.displayName +
        ' (' + file.location + ')');
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'GPS report export failed.');
    } finally {
      setExporting(false);
    }
  };

  const diag = report.diagnostics;
  const s = report.statistics;
  const ongoing = session.status === 'tracking' ||
    session.status === 'tracking-no-link';
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>GPS FIELD VALIDATION · READ ONLY</Text>
      <Text style={styles.heading}>Acquisition quality</Text>
      <Text style={styles.body}>
        Live counters use fixes already accepted by BushMesh while this panel is
        mounted. No GPS session is started and no extra permission is requested.
      </Text>

      <Reading name="Location quality" value={report.quality.toUpperCase()}
        caution={report.quality !== 'usable'} />
      <Reading name="Observed source" value={report.observedSource} />
      <Reading name="Android provider state"
        value={readiness?.gpsEnabled === true ? 'GPS enabled'
          : readiness?.gpsEnabled === false ? 'GPS disabled'
            : 'Unavailable / not checked'}
        caution={readiness?.gpsEnabled !== true} />
      <Reading name="Precise permission"
        value={readiness?.precisePermission ?? 'Unknown'}
        caution={readiness?.precisePermission !== 'granted'} />
      <Reading name="Live session" value={session.status} caution={!ongoing} />
      <Reading name="Fix state"
        value={diag?.fixState ?? 'Unavailable'}
        caution={diag?.fixState !== 'fresh'} />
      <Reading name="Fix age"
        value={diag?.fixAgeMs == null
          ? 'No fix'
          : (diag.fixAgeMs / 1_000).toFixed(1) + ' s'}
        caution={diag?.fixState === 'stale' || diag?.fixState === 'future-dated'} />
      <Reading name="Reported accuracy"
        value={diag?.fix?.accuracyMeters == null
          ? 'Not reported' : '±' + diag.fix.accuracyMeters.toFixed(0) + ' m'}
        caution={diag?.accuracyAssessment === 'low-accuracy'} />
      <Reading name="Heading quality"
        value={report.headingQuality.replace(/-/g, ' ')}
        caution={report.headingQuality !== 'course-only'} />
      <Text style={styles.note}>
        Heading is GPS course-over-ground only; no bearing uncertainty API is
        available. Low speed, missing speed, or poor accuracy reduces confidence.
      </Text>

      <View style={styles.subsection}>
        <Text style={styles.subheading}>Requested vs observed updates</Text>
        <Reading name="Current saved preference" value={report.acquisitionMode} />
        <Reading name="Android minimum time request"
          value={(report.requestHintMs / 1_000).toFixed(0) + ' s (hint)'} />
        <Reading name="Android minimum distance request"
          value={report.requestHintMeters + ' m (hint)'} />
        <Reading name="Fixes observed here" value={String(s.observedFixes)} />
        <Reading name="Measured intervals" value={String(s.intervalCount)} />
        <View style={styles.reading}>
          <Text style={styles.label}>Observed average arrival gap</Text>
          <Duration ms={s.averageMs} />
        </View>
        <View style={styles.reading}>
          <Text style={styles.label}>Observed median / p95</Text>
          <Text style={styles.value}>
            {s.medianMs == null ? 'Not observed'
              : (s.medianMs / 1000).toFixed(1) + ' / ' +
                ((s.p95Ms ?? 0) / 1000).toFixed(1) + ' s'}
          </Text>
        </View>
        <View style={styles.reading}>
          <Text style={styles.label}>Longest observed gap</Text>
          <Duration ms={s.maximumMs} />
        </View>
        <Reading name="Estimated observed rate"
          value={s.observedHz === null ? 'Insufficient fixes'
            : s.observedHz.toFixed(1) + ' fixes/s'} />
        <View style={styles.reading}>
          <Text style={styles.label}>Time since last observed fix</Text>
          <Duration ms={s.currentSilenceMs} />
        </View>
        <Reading name="Long gaps"
          value={s.longGaps + ' (over ' +
            Math.round(s.longGapThresholdMs / 1000) + ' s)'} />
        <Reading name="Ignored invalid observations"
          value={String(s.rejectedObservations)} />
        <Text style={styles.note}>
          These are measured React Native UI arrival gaps, not raw GNSS callback
          timing or promises that Android met the requested rate. Background
          suspension, unmounts and missed renders are not counted reliably.
          Changing profiles takes effect on the next explicit GPS start.
        </Text>
      </View>

      <View style={styles.subsection}>
        <Text style={styles.subheading}>Resilience and battery trade-offs</Text>
        <Reading name="Observed loss / recovery"
          value={report.lossEvents + ' / ' + report.recoveryEvents} />
        <Reading name="GPS-disabled transitions"
          value={String(report.providerDisabledEvents)} />
        <Reading name="Precise-permission denials"
          value={String(report.permissionDeniedEvents)} />
        <Reading name="App background transitions observed"
          value={String(report.backgroundTransitions)} />
        <Reading name="New foreground start"
          value={diag?.foregroundStartReady ? 'Ready now' : 'Not ready'} />
        <Reading name="Independent background start" value="Not configured" caution />
        <Reading name="Process-restart GPS recovery" value="Not established" caution />
        <Text style={styles.body}>{report.batteryPolicy}</Text>
        <Text style={styles.note}>
          This panel cannot measure GPS battery current, verify screen-lock
          continuity, or recover tracking after app process death. A GPS session
          started in the foreground may continue, subject to Android lifecycle.
        </Text>
      </View>

      <View style={styles.subsection}>
        <Text style={styles.subheading}>Warnings and limitations</Text>
        {report.notes.map((warning, index) => (
          <Text key={index} style={styles.note}>• {warning}</Text>
        ))}
        {checkedError ? <Text style={styles.warning}>{checkedError}</Text> : null}
      </View>

      <View style={styles.subsection}>
        <Text style={styles.subheading}>Technical report</Text>
        <Text style={styles.body}>
          JSON export excludes precise coordinates, raw tracks, radio identity
          and key material by default. Export is user-initiated only.
        </Text>
        <TouchableOpacity
          accessibilityRole="checkbox"
          accessibilityState={{checked: includeCoordinates}}
          onPress={() => setIncludeCoordinates(value => !value)}
          style={styles.toggle}>
          <Text style={[styles.note, includeCoordinates && styles.warning]}>
            {includeCoordinates ? '☑' : '☐'} Explicitly include last precise coordinates
          </Text>
        </TouchableOpacity>
        <View style={styles.actions}>
          <TouchableOpacity accessibilityRole="button" style={styles.action}
            onPress={reset}>
            <Text style={styles.actionText}>RESET COUNTERS ONLY</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
            disabled={!exportSupported || exporting}
            style={[styles.action, (!exportSupported || exporting) && styles.disabled]}
            onPress={() => {exportReport().catch(() => undefined);}}>
            <Text style={styles.actionText}>
              {!exportSupported ? 'EXPORT UNAVAILABLE'
                : exporting ? 'EXPORTING…' : 'EXPORT JSON REPORT'}
            </Text>
          </TouchableOpacity>
        </View>
        {exportMessage ? (
          <Text accessibilityRole="alert" style={styles.body}>{exportMessage}</Text>
        ) : null}
        <Text style={styles.note}>
          Reset does not stop GPS, clear breadcrumbs, change preferences,
          reconnect the radio, or revoke any permissions.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {backgroundColor: colors.surface, borderColor: colors.border,
    borderWidth: 1, borderRadius: 16, padding: 14, gap: 9},
  eyebrow: {fontSize: 10, fontWeight: '900', color: colors.accent,
    letterSpacing: 0.7},
  heading: {fontSize: 18, fontWeight: '900', color: colors.textPrimary},
  subheading: {fontSize: 13, fontWeight: '900', color: colors.textPrimary},
  subsection: {borderTopWidth: 1, borderTopColor: colors.border,
    marginTop: 8, paddingTop: 12, gap: 6},
  reading: {flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', gap: 9, paddingVertical: 3},
  label: {fontSize: 11, flex: 1, color: colors.textSecondary},
  value: {fontSize: 11, flex: 1, textAlign: 'right',
    fontWeight: '700', color: colors.textPrimary},
  warning: {color: colors.warning, fontSize: 11, lineHeight: 17},
  note: {fontSize: 10, lineHeight: 15, color: colors.textMuted},
  body: {fontSize: 11, lineHeight: 17, color: colors.textSecondary},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 7},
  action: {padding: 10, borderRadius: 9, borderColor: colors.border,
    borderWidth: 1, minHeight: 42, justifyContent: 'center'},
  actionText: {color: colors.accent, fontSize: 10, fontWeight: '900'},
  disabled: {opacity: 0.45},
  toggle: {minHeight: 44, justifyContent: 'center', paddingVertical: 8},
});
