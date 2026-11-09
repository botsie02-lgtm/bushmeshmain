import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {decodeMapPackManifest} from '../maps/mapPackManifest';
import {decodeOperatorReviewedMapManifest} from '../maps/trustedMapPackProvisioning';
import {useOfflineMaps} from '../state/OfflineMapContext';
import {colors} from '../theme/colors';

/**
 * Explicit, opt-in field-test provisioning; no unpinned auto-discovery.
 * Operator-reviewed manifests are NOT treated as signed catalogs.
 */
export function TrustedMapPackProvisioner(): React.JSX.Element {
  const {registerMapPackManifest, mapPersistenceStatus} = useOfflineMaps();
  const [expanded, setExpanded] = useState(false);
  const [raw, setRaw] = useState('');
  const [reviewedSha, setReviewedSha] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const preview = useMemo(() => {
    try {
      return raw.length <= 12_000 && raw.length > 0 ? decodeMapPackManifest(raw) : null;
    } catch {
      return null;
    }
  }, [raw]);

  const register = () => {
    try {
      if (mapPersistenceStatus !== 'ready') {
        throw new Error('Encrypted map catalog is not ready; registration is disabled.');
      }
      const manifest = decodeOperatorReviewedMapManifest(raw, reviewedSha, confirmed);
      registerMapPackManifest(manifest);
      setNotice(\`Reviewed manifest registered: \${manifest.name}. This does not install any archive.\`);
      setConfirmed(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not register reviewed map manifest.');
    }
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => setExpanded(value => !value)}
        style={styles.headingButton}>
        <Text style={styles.heading}>ADD REVIEWED MAP PACK {expanded ? '−' : '+'}</Text>
      </TouchableOpacity>
      {expanded ? (
        <View>
          <Text style={styles.copy}>
            For field testing only: paste a JSON BushMeshMapPackManifestV1 generated
            from a licensed raster archive. Review its source and separately
            confirmed SHA-256. This is operator trust, not a signed publisher catalog.
            Nothing is downloaded or installed by registration alone.
          </Text>
          <Text style={styles.label}>REVIEWED MANIFEST JSON</Text>
          <TextInput
            accessibilityLabel="Reviewed map manifest JSON"
            style={styles.input}
            multiline
            value={raw}
            onChangeText={value => {
              setRaw(value);
              setConfirmed(false);
              setNotice(null);
            }}
            placeholder="Paste reviewed JSON manifest"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {preview ? (
            <View style={styles.preview}>
              <Text style={styles.label}>{preview.name}</Text>
              <Text style={styles.copy}>
                {preview.id} · {preview.format.toUpperCase()} · z{preview.minZoom}–{preview.maxZoom}
              </Text>
              <Text style={styles.copy}>
                Coverage {preview.bounds.south}, {preview.bounds.west} to {preview.bounds.north}, {preview.bounds.east}
              </Text>
              <Text style={styles.copy}>
                {preview.expectedBytes} bytes · {preview.source.kind === 'remote'
                  ? preview.source.url
                  : \`LOCAL FILE PICKER (\${preview.source.displayName})\`}
              </Text>
              <Text style={styles.copy}>Attribution: {preview.attribution}</Text>
              <Text selectable style={styles.digest}>SHA-256: {preview.sha256}</Text>
            </View>
          ) : raw.length ? <Text style={styles.error}>Manifest JSON invalid or unsupported.</Text> : null}
          <Text style={styles.label}>INDEPENDENTLY REVIEWED ARCHIVE SHA-256</Text>
          <TextInput
            accessibilityLabel="Independent archive SHA-256"
            style={styles.digestInput}
            value={reviewedSha}
            onChangeText={value => {
              setReviewedSha(value);
              setConfirmed(false);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={64}
            placeholder="Paste SHA-256 from separate checksum output"
            placeholderTextColor={colors.textMuted}
          />
          <TouchableOpacity
            accessibilityRole="checkbox"
            accessibilityState={{checked: confirmed}}
            onPress={() => setConfirmed(value => !value)}>
            <Text style={styles.copy}>
              {confirmed ? '☑' : '☐'} I reviewed the source licence, attribution,
              region and independent archive fingerprint.
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={mapPersistenceStatus !== 'ready'}
            style={[styles.action, mapPersistenceStatus !== 'ready' && styles.disabled]}
            onPress={register}>
            <Text style={styles.actionText}>REGISTER REVIEWED MANIFEST</Text>
          </TouchableOpacity>
          {notice ? <Text style={styles.copy}>{notice}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {marginTop: 12, marginBottom: 8},
  headingButton: {borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10},
  heading: {color: colors.accent, fontWeight: '900', fontSize: 11},
  copy: {color: colors.textSecondary, fontSize: 11, marginTop: 8, lineHeight: 17},
  label: {color: colors.textPrimary, fontWeight: '800', fontSize: 10, marginTop: 12},
  input: {color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, borderRadius: 9,
    padding: 10, fontSize: 12, minHeight: 110, maxHeight: 200, textAlignVertical: 'top', marginTop: 7},
  digestInput: {color: colors.textPrimary, borderWidth: 1, borderColor: colors.border,
    borderRadius: 9, padding: 8, fontSize: 10, marginTop: 7},
  preview: {backgroundColor: colors.surfaceSoft, borderRadius: 9, padding: 10, marginTop: 8},
  digest: {color: colors.textSecondary, fontSize: 9, marginTop: 8},
  error: {color: colors.danger, fontSize: 10, marginTop: 6},
  action: {backgroundColor: colors.accent, padding: 11, borderRadius: 9, marginTop: 12},
  actionText: {color: colors.background, fontSize: 10, fontWeight: '900', textAlign: 'center'},
  disabled: {opacity: 0.45},
});
