import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {formatDistance} from '../convoy/convoy';
import {useLocationSession} from '../state/LocationSessionContext';
import {useOfflineMaps} from '../state/OfflineMapContext';
import {colors} from '../theme/colors';
import {MapPackCatalogPanel} from './MapPackCatalogPanel';

export function MapTrackExportBanner(): React.JSX.Element {
  const {
    trackPoints,
    trackDistanceMeters,
    trackExportSupported,
    trackPersistenceStatus,
    trackPersistenceError,
    exportTrackGpx,
  } = useLocationSession();
  const {packCatalog, packs, mapPersistenceStatus} = useOfflineMaps();
  const [exporting, setExporting] = useState(false);
  const [packsOpen, setPacksOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const runExport = async () => {
    if (!trackExportSupported || exporting || trackPoints.length === 0) {
      return;
    }

    try {
      setExporting(true);
      setMessage(null);
      const result = await exportTrackGpx();
      setMessage(`${result.displayName} saved to ${result.location}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'GPX export failed unexpectedly.',
      );
    } finally {
      setExporting(false);
    }
  };

  const durabilityLabel =
    trackPersistenceStatus === 'ready'
      ? 'TRAIL DURABLE'
      : trackPersistenceStatus === 'restoring'
        ? 'RESTORING TRAIL'
        : trackPersistenceStatus === 'unsupported'
          ? 'TRAIL MEMORY ONLY'
          : 'TRAIL STORAGE ERROR';
  const packStorageLabel =
    mapPersistenceStatus === 'ready'
      ? 'PACKS DURABLE'
      : mapPersistenceStatus === 'restoring'
        ? 'RESTORING PACKS'
        : mapPersistenceStatus === 'unsupported'
          ? 'PACKS MEMORY ONLY'
          : 'PACK STORAGE ERROR';
  const verifiedPackCount = packs.filter(
    pack => !pack.simulated && pack.state === 'ready' && pack.checksumVerified,
  ).length;

  return (
    <View style={styles.container}>
      <View style={styles.wrap}>
        <View style={styles.copy}>
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>MAP TOOLS</Text>
            <Text
              style={
                trackPersistenceStatus === 'ready'
                  ? styles.persistenceReady
                  : styles.persistenceWarning
              }>
              {durabilityLabel}
            </Text>
            <Text
              style={
                mapPersistenceStatus === 'ready'
                  ? styles.persistenceReady
                  : styles.persistenceWarning
              }>
              {packStorageLabel}
            </Text>
          </View>
          <Text style={styles.summary}>
            {trackPoints.length > 0
              ? `${trackPoints.length} trail points · ${formatDistance(trackDistanceMeters)}`
              : 'No trail recorded'}
            {' · '}
            {verifiedPackCount}/{packCatalog.length} real packs verified
          </Text>
          {trackPersistenceError ? (
            <Text style={styles.warningMessage}>{trackPersistenceError}</Text>
          ) : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              packsOpen && styles.secondaryButtonActive,
            ]}
            onPress={() => setPacksOpen(current => !current)}>
            <Text
              style={[
                styles.secondaryButtonText,
                packsOpen && styles.secondaryButtonTextActive,
              ]}>
              {packsOpen ? 'CLOSE PACKS' : 'PACKS'}
            </Text>
          </TouchableOpacity>

          {trackPoints.length > 0 ? (
            <TouchableOpacity
              style={[
                styles.button,
                (!trackExportSupported || exporting) && styles.buttonDisabled,
              ]}
              disabled={!trackExportSupported || exporting}
              onPress={() => {
                runExport().catch(() => undefined);
              }}>
              <Text style={styles.buttonText}>
                {exporting
                  ? 'EXPORTING…'
                  : trackExportSupported
                    ? 'EXPORT GPX'
                    : 'GPX UNAVAILABLE'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {packsOpen ? (
        <ScrollView
          style={styles.packDrawer}
          contentContainerStyle={styles.packDrawerContent}
          nestedScrollEnabled>
          <MapPackCatalogPanel />
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  copy: {flex: 1},
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap',
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  persistenceReady: {
    color: colors.success,
    fontSize: 7,
    fontWeight: '900',
  },
  persistenceWarning: {
    color: colors.warning,
    fontSize: 7,
    fontWeight: '900',
  },
  summary: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 2,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 3,
  },
  warningMessage: {
    color: colors.warning,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 3,
  },
  actions: {
    alignItems: 'stretch',
    gap: 6,
  },
  button: {
    minWidth: 92,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  buttonDisabled: {opacity: 0.45},
  buttonText: {
    color: colors.background,
    fontSize: 8,
    fontWeight: '900',
  },
  secondaryButton: {
    minWidth: 92,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSoft,
  },
  secondaryButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: 8,
    fontWeight: '900',
  },
  secondaryButtonTextActive: {
    color: colors.background,
  },
  packDrawer: {
    maxHeight: 420,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  packDrawerContent: {
    padding: 12,
    paddingBottom: 0,
  },
});
