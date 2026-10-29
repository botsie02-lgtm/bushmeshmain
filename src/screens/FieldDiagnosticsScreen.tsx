import React, {useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {FieldCorrelationCard} from '../components/FieldCorrelationCard';
import {FieldTestMarkersCard} from '../components/FieldTestMarkersCard';
import {FieldTestRunCard} from '../components/FieldTestRunCard';
import {FieldTriageCard} from '../components/FieldTriageCard';
import {assessFieldDiagnostics} from '../diagnostics/diagnosticHealth';
import {serializeFieldDiagnosticsReport} from '../diagnostics/fieldDiagnostics';
import {prepareFieldSupportExport} from '../diagnostics/supportExportCoordinator';
import {nativeFileExport} from '../native/NativeFileExport';
import {useFieldDiagnosticsCapture} from '../state/FieldDiagnosticsCaptureContext';
import {useFieldEventTrace} from '../state/FieldEventTraceContext';
import {colors} from '../theme/colors';

function StatusRow({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={[styles.statusValue, warning && styles.warningText]}>{value}</Text>
    </View>
  );
}

function formatTraceTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function FieldDiagnosticsScreen(): React.JSX.Element {
  const {events: traceEvents, clearTrace} = useFieldEventTrace();
  const {report, capture} = useFieldDiagnosticsCapture();
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [lastSupportCode, setLastSupportCode] = useState<string | null>(null);
  const health = useMemo(() => assessFieldDiagnostics(report), [report]);
  const serialized = useMemo(() => serializeFieldDiagnosticsReport(report), [report]);
  const exportSupported = nativeFileExport.isSupported();

  const captureNewSnapshot = () => {
    capture();
    setExportStatus(null);
    setLastSupportCode(null);
  };

  const exportReport = async () => {
    if (!exportSupported || exporting) {
      return;
    }

    setExporting(true);
    setExportStatus(null);
    try {
      const prepared = await prepareFieldSupportExport({
        report,
        eventTrace: traceEvents,
      });
      const result = await nativeFileExport.saveJson(
        prepared.filename,
        prepared.serialized,
      );
      setLastSupportCode(prepared.supportCode);
      setExportStatus(
        `Saved ${result.displayName} to ${result.location}. Support code ${prepared.supportCode}.`,
      );
    } catch (error) {
      setExportStatus(
        error instanceof Error
          ? `Export failed: ${error.message}`
          : 'Export failed unexpectedly.',
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>FIELD DIAGNOSTICS</Text>
        <Text style={styles.title}>Privacy-safe system snapshot</Text>
        <Text style={styles.body}>
          This report deliberately excludes message text, channel secrets, contact names, full radio identities and exact GPS coordinates. It is intended for troubleshooting Bushmesh hardware and field behavior.
        </Text>
        <View style={styles.heroActions}>
          <TouchableOpacity style={styles.refreshButton} onPress={captureNewSnapshot}>
            <Text style={styles.refreshText}>CAPTURE NEW SNAPSHOT</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.exportButton,
              (!exportSupported || exporting) && styles.exportButtonDisabled,
            ]}
            onPress={() => {
              exportReport().catch(() => undefined);
            }}
            disabled={!exportSupported || exporting}>
            <Text style={styles.exportText}>
              {exporting
                ? 'EXPORTING…'
                : exportSupported
                  ? 'EXPORT SUPPORT JSON'
                  : 'EXPORT ANDROID ONLY'}
            </Text>
          </TouchableOpacity>
        </View>
        {lastSupportCode ? (
          <Text style={styles.supportCode}>LAST EXPORT · {lastSupportCode}</Text>
        ) : null}
        {exportStatus ? <Text style={styles.exportStatus}>{exportStatus}</Text> : null}
      </View>

      <View
        style={[
          styles.healthCard,
          health.severity === 'action'
            ? styles.healthAction
            : health.severity === 'watch'
              ? styles.healthWatch
              : styles.healthOk,
        ]}>
        <Text
          style={[
            styles.healthEyebrow,
            health.severity === 'action'
              ? styles.healthActionText
              : health.severity === 'watch'
                ? styles.healthWatchText
                : styles.healthOkText,
          ]}>
          {health.severity === 'action'
            ? 'ACTION NEEDED'
            : health.severity === 'watch'
              ? 'WATCH'
              : 'FIELD HEALTH OK'}
        </Text>
        <Text style={styles.healthSummary}>{health.summary}</Text>
        {health.issues.map(issue => (
          <View key={issue.code} style={styles.issueRow}>
            <View
              style={[
                styles.issueDot,
                issue.severity === 'action'
                  ? styles.issueDotAction
                  : styles.issueDotWatch,
              ]}
            />
            <View style={styles.issueCopy}>
              <Text style={styles.issueTitle}>{issue.title}</Text>
              <Text style={styles.issueDetail}>{issue.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      <FieldTriageCard />
      <FieldCorrelationCard />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Radio</Text>
        <StatusRow label="App link" value={report.radio.appConnectionStatus} />
        <StatusRow
          label="Transport"
          value={report.radio.transportReady ? 'READY' : 'NOT READY'}
          warning={!report.radio.transportReady}
        />
        <StatusRow label="Identity" value={report.radio.identityHint ?? 'UNKNOWN'} />
        <StatusRow
          label="Android runtime"
          value={`${report.radio.nativeRuntimeRunning ? 'RUNNING' : 'STOPPED'} · ${report.radio.nativeRuntimeOwnership}`}
        />
        <StatusRow
          label="Outbox"
          value={`${report.radio.outbox.queued} queued · ${report.radio.outbox.failed} failed · ${report.radio.outbox.accepted} accepted`}
          warning={report.radio.outbox.failed > 0}
        />
        {report.radio.profile ? (
          <StatusRow
            label="RF profile"
            value={`${report.radio.profile.frequencyMhz ?? '—'} MHz · SF${report.radio.profile.spreadingFactor ?? '—'} · ${report.radio.profile.bandwidthKhz ?? '—'} kHz · CR ${report.radio.profile.codingRate ?? '—'}`}
          />
        ) : (
          <StatusRow label="RF profile" value="UNKNOWN" warning />
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Field state</Text>
        <StatusRow
          label="Channels"
          value={`${report.data.channelCount} known · active ${report.data.activeChannelIndex ?? 'none'}`}
        />
        <StatusRow label="Stored messages" value={String(report.data.messageCount)} />
        <StatusRow label="Contacts" value={String(report.data.contactCount)} />
        <StatusRow
          label="Battery"
          value={report.data.batteryMv === null ? 'UNKNOWN' : `${report.data.batteryMv} mV`}
        />
        <StatusRow
          label="GPS"
          value={
            report.location.coarse
              ? `AVAILABLE · coarse ${report.location.coarse.latitude.toFixed(2)}, ${report.location.coarse.longitude.toFixed(2)}`
              : 'UNAVAILABLE'
          }
          warning={!report.location.available}
        />
        <StatusRow
          label="Convoy"
          value={`${report.convoy.vehicleCount} vehicles · ${report.convoy.staleVehicleCount} stale · ${report.convoy.lostVehicleCount} lost`}
          warning={report.convoy.staleVehicleCount + report.convoy.lostVehicleCount > 0}
        />
        <StatusRow
          label="Recovery"
          value={`${report.convoy.activeRecoveryIncidentCount} active · ${report.convoy.recoveredIncidentCount} recovered`}
        />
        <StatusRow
          label="Offline maps"
          value={`${report.maps.readyPackCount} verified packs · ${report.maps.coveredPointCount}/${report.maps.totalPointCount} trip points`}
          warning={report.maps.totalPointCount > 0 && !report.maps.tripCoverageComplete}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Durability</Text>
        <StatusRow label="Contacts" value={report.persistence.contacts.toUpperCase()} />
        <StatusRow label="Messages" value={report.persistence.messages.toUpperCase()} />
        <StatusRow label="Outbox" value={report.persistence.outbox.toUpperCase()} />
        <StatusRow label="Maps" value={report.persistence.maps.toUpperCase()} />
      </View>

      <FieldTestRunCard />
      <FieldTestMarkersCard />

      <View style={styles.card}>
        <View style={styles.traceHeader}>
          <View style={styles.traceHeaderCopy}>
            <Text style={styles.cardTitle}>Recent field events</Text>
            <Text style={styles.traceHint}>
              State changes only. No message contents or channel secrets are logged.
            </Text>
          </View>
          {traceEvents.length > 0 ? (
            <TouchableOpacity style={styles.clearTraceButton} onPress={clearTrace}>
              <Text style={styles.clearTraceText}>CLEAR</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {traceEvents.length === 0 ? (
          <Text style={styles.traceEmpty}>No state transitions recorded yet.</Text>
        ) : (
          traceEvents.slice(0, 12).map(event => (
            <View key={event.id} style={styles.traceRow}>
              <View
                style={[
                  styles.traceDot,
                  event.severity === 'action'
                    ? styles.traceDotAction
                    : event.severity === 'watch'
                      ? styles.traceDotWatch
                      : styles.traceDotInfo,
                ]}
              />
              <View style={styles.traceCopy}>
                <Text style={styles.traceMeta}>
                  {formatTraceTime(event.occurredAtMs)} · {event.category.toUpperCase()} · {event.code}
                </Text>
                <Text style={styles.traceDetail}>{event.detail}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Redacted report preview</Text>
        <Text style={styles.preview} selectable>
          {serialized}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 14, paddingBottom: 30, gap: 12},
  hero: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    backgroundColor: colors.surface,
  },
  eyebrow: {color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1},
  title: {color: colors.textPrimary, fontSize: 21, fontWeight: '900', marginTop: 4},
  body: {color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 8},
  heroActions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12},
  refreshButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshText: {color: colors.accent, fontSize: 8, fontWeight: '900'},
  exportButton: {
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  exportButtonDisabled: {opacity: 0.45},
  exportText: {color: colors.background, fontSize: 8, fontWeight: '900'},
  supportCode: {color: colors.accent, fontSize: 9, fontWeight: '900', marginTop: 9},
  exportStatus: {color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 6},
  healthCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    backgroundColor: colors.surface,
  },
  healthAction: {borderColor: colors.danger},
  healthWatch: {borderColor: colors.warning},
  healthOk: {borderColor: colors.success},
  healthEyebrow: {fontSize: 9, fontWeight: '900', letterSpacing: 1},
  healthActionText: {color: colors.danger},
  healthWatchText: {color: colors.warning},
  healthOkText: {color: colors.success},
  healthSummary: {color: colors.textPrimary, fontSize: 12, fontWeight: '800', lineHeight: 17, marginTop: 4},
  issueRow: {flexDirection: 'row', gap: 8, marginTop: 10},
  issueDot: {width: 7, height: 7, borderRadius: 4, marginTop: 4},
  issueDotAction: {backgroundColor: colors.danger},
  issueDotWatch: {backgroundColor: colors.warning},
  issueCopy: {flex: 1, minWidth: 0},
  issueTitle: {color: colors.textPrimary, fontSize: 10, fontWeight: '900'},
  issueDetail: {color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 2},
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    backgroundColor: colors.surface,
  },
  cardTitle: {color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginBottom: 7},
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  statusLabel: {color: colors.textMuted, fontSize: 9, fontWeight: '800'},
  statusValue: {flex: 1, color: colors.textSecondary, fontSize: 9, fontWeight: '800', textAlign: 'right'},
  warningText: {color: colors.warning},
  traceHeader: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  traceHeaderCopy: {flex: 1, minWidth: 0},
  traceHint: {color: colors.textMuted, fontSize: 8, lineHeight: 12, marginTop: -3},
  clearTraceButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  clearTraceText: {color: colors.textMuted, fontSize: 8, fontWeight: '900'},
  traceEmpty: {color: colors.textMuted, fontSize: 9, marginTop: 8},
  traceRow: {flexDirection: 'row', gap: 8, marginTop: 10},
  traceDot: {width: 7, height: 7, borderRadius: 4, marginTop: 3},
  traceDotAction: {backgroundColor: colors.danger},
  traceDotWatch: {backgroundColor: colors.warning},
  traceDotInfo: {backgroundColor: colors.accent},
  traceCopy: {flex: 1, minWidth: 0},
  traceMeta: {color: colors.textMuted, fontSize: 7, fontWeight: '800'},
  traceDetail: {color: colors.textSecondary, fontSize: 9, lineHeight: 13, marginTop: 2},
  preview: {
    color: colors.textMuted,
    fontSize: 8,
    lineHeight: 12,
    fontFamily: 'monospace',
  },
});
