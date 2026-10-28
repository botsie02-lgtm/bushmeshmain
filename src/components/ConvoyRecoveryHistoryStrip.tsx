import React, {useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {formatDistance} from '../convoy/convoy';
import {buildConvoyRecoveryReport} from '../convoy/recoveryReport';
import {useConvoyRecovery} from '../state/ConvoyRecoveryContext';
import {colors} from '../theme/colors';

function formatDuration(durationMs: number | null, startedAtMs: number): string {
  const elapsedMs = durationMs ?? Math.max(0, Date.now() - startedAtMs);
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3_600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  return `${Math.floor(seconds / 3_600)}h`;
}

function formatCoordinate(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function linkSummary(
  snrDb: number | null,
  pathLength: number | null,
): string {
  return `SNR ${snrDb === null ? '—' : `${snrDb.toFixed(1)} dB`} · path ${
    pathLength ?? '—'
  }`;
}

export function ConvoyRecoveryHistoryStrip(): React.JSX.Element | null {
  const {incidents, clearRecoveryHistory} = useConvoyRecovery();
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const recent = incidents.slice(0, 3);
  const selectedIncident =
    incidents.find(incident => incident.id === selectedIncidentId) ?? null;

  if (recent.length === 0) {
    return null;
  }

  const activeCount = incidents.filter(incident => incident.status === 'active').length;
  const recoveredCount = incidents.length - activeCount;
  const selectedReport = selectedIncident
    ? buildConvoyRecoveryReport(selectedIncident)
    : null;

  const clearHistory = () => {
    setSelectedIncidentId(null);
    clearRecoveryHistory();
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>RECOVERY INCIDENTS</Text>
          <Text style={styles.summary}>
            {incidents.length} incident{incidents.length === 1 ? '' : 's'} this session
            {activeCount > 0 ? ` · ${activeCount} active` : ''}
            {recoveredCount > 0 ? ` · ${recoveredCount} recovered` : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.clearButton} onPress={clearHistory}>
          <Text style={styles.clearText}>CLEAR</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.eventsRow}>
        {recent.map(incident => {
          const active = incident.status === 'active';
          const recoveredOffset = incident.reacquisitionOffsetMeters;
          const recoveredSnr = incident.reacquired?.snrDb ?? null;
          const recoveredPath = incident.reacquired?.pathLength ?? null;
          const selected = incident.id === selectedIncidentId;

          return (
            <TouchableOpacity
              key={incident.id}
              style={[styles.eventChip, selected && styles.eventChipSelected]}
              onPress={() =>
                setSelectedIncidentId(current =>
                  current === incident.id ? null : incident.id,
                )
              }>
              <Text
                style={[
                  styles.eventType,
                  active
                    ? incident.worstState === 'lost'
                      ? styles.lostText
                      : styles.staleText
                    : styles.recoveredText,
                ]}>
                {active
                  ? incident.worstState === 'lost'
                    ? 'LOST · ACTIVE'
                    : 'STALE · ACTIVE'
                  : incident.worstState === 'lost'
                    ? 'LOST · RECOVERED'
                    : 'STALE · RECOVERED'}
              </Text>
              <Text style={styles.eventName} numberOfLines={1}>
                {incident.vehicleName}
              </Text>
              <Text style={styles.eventAge}>
                {formatDuration(incident.durationMs, incident.startedAtMs)}
                {incident.escalatedToLostAtMs !== null ? ' · escalated' : ''}
              </Text>
              {!active && recoveredOffset !== null ? (
                <Text style={styles.recoveryEvidence}>
                  Reacquired {formatDistance(recoveredOffset)} from last known
                </Text>
              ) : null}
              {!active && incident.reacquiredViaRequest ? (
                <Text style={styles.requestEvidence}>REQUEST FIX RESPONSE</Text>
              ) : null}
              {!active && (recoveredSnr !== null || recoveredPath !== null) ? (
                <Text style={styles.linkEvidence}>
                  Link {recoveredSnr === null ? '—' : `${recoveredSnr.toFixed(1)} dB`}
                  {' · '}path {recoveredPath ?? '—'}
                </Text>
              ) : null}
              <Text style={styles.inspectText}>{selected ? 'HIDE' : 'INSPECT'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {selectedIncident && selectedReport ? (
        <View style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <View style={styles.detailHeaderCopy}>
              <Text style={styles.detailEyebrow}>RECOVERY EVIDENCE</Text>
              <Text style={styles.detailTitle}>{selectedIncident.vehicleName}</Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedIncidentId(null)}>
              <Text style={styles.closeText}>×</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.reportSummary}>{selectedReport.summary}</Text>
          {selectedIncident.reacquiredViaRequest ? (
            <Text style={styles.requestReportNote}>
              Reacquisition provenance: peer flagged this fresh position as a response to an explicit Bushmesh position request.
            </Text>
          ) : null}

          <View style={styles.evidenceRow}>
            <View style={styles.evidenceBlock}>
              <Text style={styles.evidenceLabel}>LAST KNOWN</Text>
              <Text style={styles.evidenceValue}>
                {formatCoordinate(
                  selectedIncident.lastKnown.latitude,
                  selectedIncident.lastKnown.longitude,
                )}
              </Text>
              <Text style={styles.evidenceMeta}>
                GPS ±{selectedIncident.lastKnown.accuracyMeters ?? '—'} m ·{' '}
                {linkSummary(
                  selectedIncident.lastKnown.snrDb,
                  selectedIncident.lastKnown.pathLength,
                )}
              </Text>
            </View>

            <View style={styles.evidenceBlock}>
              <Text style={styles.evidenceLabel}>REACQUIRED</Text>
              {selectedIncident.reacquired ? (
                <>
                  <Text style={styles.evidenceValue}>
                    {formatCoordinate(
                      selectedIncident.reacquired.latitude,
                      selectedIncident.reacquired.longitude,
                    )}
                  </Text>
                  <Text style={styles.evidenceMeta}>
                    {selectedIncident.reacquisitionOffsetMeters === null
                      ? 'Offset unavailable'
                      : `${formatDistance(
                          selectedIncident.reacquisitionOffsetMeters,
                        )} from last known`}
                    {' · '}GPS ±{selectedIncident.reacquired.accuracyMeters ?? '—'} m
                  </Text>
                </>
              ) : (
                <Text style={styles.evidencePending}>WAITING FOR FRESH FIX</Text>
              )}
            </View>
          </View>

          <Text style={styles.detailFooter}>
            {selectedIncident.eventIds.length} recovery event
            {selectedIncident.eventIds.length === 1 ? '' : 's'} recorded · worst state{' '}
            {selectedIncident.worstState.toUpperCase()}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surfaceSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  summary: {
    color: colors.textSecondary,
    fontSize: 9,
    marginTop: 2,
  },
  clearButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  clearText: {color: colors.textSecondary, fontSize: 8, fontWeight: '900'},
  eventsRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 8,
  },
  eventChip: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 7,
    backgroundColor: colors.surface,
  },
  eventChipSelected: {borderColor: colors.accent},
  eventType: {fontSize: 8, fontWeight: '900'},
  staleText: {color: colors.warning},
  lostText: {color: colors.danger},
  recoveredText: {color: colors.success},
  eventName: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
  },
  eventAge: {
    color: colors.textMuted,
    fontSize: 8,
    marginTop: 2,
  },
  recoveryEvidence: {
    color: colors.success,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 4,
  },
  requestEvidence: {
    color: colors.accent,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginTop: 3,
  },
  linkEvidence: {
    color: colors.textSecondary,
    fontSize: 8,
    marginTop: 2,
  },
  inspectText: {
    color: colors.accent,
    fontSize: 7,
    fontWeight: '900',
    marginTop: 5,
  },
  detailCard: {
    marginTop: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 11,
    backgroundColor: colors.surface,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailHeaderCopy: {flex: 1, minWidth: 0},
  detailEyebrow: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  detailTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 2,
  },
  closeText: {
    color: colors.textSecondary,
    fontSize: 20,
    fontWeight: '700',
  },
  reportSummary: {
    color: colors.textSecondary,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 6,
  },
  requestReportNote: {
    color: colors.accent,
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '800',
    marginTop: 5,
  },
  evidenceRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 9,
  },
  evidenceBlock: {
    flex: 1,
    minWidth: 0,
    padding: 8,
    borderRadius: 10,
    backgroundColor: colors.surfaceSoft,
  },
  evidenceLabel: {
    color: colors.textMuted,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  evidenceValue: {
    color: colors.textPrimary,
    fontSize: 8,
    fontWeight: '800',
    marginTop: 3,
  },
  evidenceMeta: {
    color: colors.textSecondary,
    fontSize: 7,
    lineHeight: 11,
    marginTop: 3,
  },
  evidencePending: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '900',
    marginTop: 5,
  },
  detailFooter: {
    color: colors.textMuted,
    fontSize: 8,
    marginTop: 8,
  },
});
