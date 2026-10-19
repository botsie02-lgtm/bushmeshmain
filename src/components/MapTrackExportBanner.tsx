import React, {useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {formatDistance} from '../convoy/convoy';
import {useLocationSession} from '../state/LocationSessionContext';
import {colors} from '../theme/colors';

export function MapTrackExportBanner(): React.JSX.Element | null {
  const {
    trackPoints,
    trackDistanceMeters,
    trackExportSupported,
    exportTrackGpx,
  } = useLocationSession();
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (trackPoints.length === 0) {
    return null;
  }

  const runExport = async () => {
    if (!trackExportSupported || exporting) {
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

  return (
    <View style={styles.wrap}>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>RECORDED TRAIL</Text>
        <Text style={styles.summary}>
          {trackPoints.length} points · {formatDistance(trackDistanceMeters)}
        </Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  copy: {flex: 1},
  eyebrow: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  summary: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 2,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 3,
  },
  button: {
    minWidth: 104,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  buttonDisabled: {opacity: 0.45},
  buttonText: {
    color: colors.background,
    fontSize: 9,
    fontWeight: '900',
  },
});
