import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {BushMeshMapPackCatalogEntry} from '../maps/mapPackCatalog';
import {useOfflineMaps} from '../state/OfflineMapContext';
import {colors} from '../theme/colors';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

function installLabel(entry: BushMeshMapPackCatalogEntry): string {
  switch (entry.installState) {
    case 'ready':
      return 'VERIFIED';
    case 'installing':
      return 'INSTALLING';
    case 'invalid':
      return 'INVALID';
    case 'not-installed':
    default:
      return 'NOT INSTALLED';
  }
}

export function MapPackCatalogPanel(): React.JSX.Element {
  const {
    packCatalog,
    mapPersistenceStatus,
    mapPersistenceError,
    mapPackInstallSupported,
    installMapPack,
    verifyMapPack,
    removePack,
  } = useOfflineMaps();
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const readyCount = useMemo(
    () => packCatalog.filter(entry => entry.installState === 'ready').length,
    [packCatalog],
  );

  const runInstall = async (packId: string) => {
    setBusyPackId(packId);
    setPendingRemovalId(null);
    setMessage(null);
    try {
      await installMapPack(packId);
      setMessage('Map pack downloaded and SHA-256 verified.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Map-pack installation failed.');
    } finally {
      setBusyPackId(null);
    }
  };

  const runVerify = async (packId: string) => {
    setBusyPackId(packId);
    setPendingRemovalId(null);
    setMessage(null);
    try {
      const verified = await verifyMapPack(packId);
      setMessage(
        verified
          ? 'Installed map pack matches its manifest.'
          : 'Installed map pack is missing or no longer matches its manifest.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Map-pack verification failed.');
    } finally {
      setBusyPackId(null);
    }
  };

  const runRemove = async (packId: string) => {
    if (pendingRemovalId !== packId) {
      setPendingRemovalId(packId);
      setMessage('Tap REMOVE again to delete this pack from app-private storage.');
      return;
    }

    setBusyPackId(packId);
    setMessage(null);
    try {
      await removePack(packId);
      setPendingRemovalId(null);
      setMessage('Map pack removed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Map-pack removal failed.');
    } finally {
      setBusyPackId(null);
    }
  };

  const persistenceLabel =
    mapPersistenceStatus === 'ready'
      ? 'ENCRYPTED CATALOG'
      : mapPersistenceStatus === 'restoring'
        ? 'RESTORING'
        : mapPersistenceStatus === 'unsupported'
          ? 'MEMORY ONLY'
          : 'STORAGE ERROR';

  return (
    <View style={styles.panel}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>OFFLINE MAP PACKS</Text>
          <Text style={styles.title}>Verified pack catalog</Text>
          <Text style={styles.meta}>
            {readyCount}/{packCatalog.length} verified · {persistenceLabel}
          </Text>
        </View>
        <View
          style={[
            styles.nativePill,
            mapPackInstallSupported ? styles.nativeReady : styles.nativeUnavailable,
          ]}>
          <Text style={styles.nativePillText}>
            {mapPackInstallSupported ? 'NATIVE INSTALLER' : 'INSTALLER UNAVAILABLE'}
          </Text>
        </View>
      </View>

      <Text style={styles.explainer}>
        Real packs become ready only after the exact manifest byte length and
        SHA-256 match an app-private PMTiles or MBTiles artifact.
      </Text>

      {mapPersistenceError ? (
        <Text style={styles.warning}>{mapPersistenceError}</Text>
      ) : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {packCatalog.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No real pack manifests registered</Text>
          <Text style={styles.emptyText}>
            The demo coverage pack is intentionally excluded from this catalog.
            A trusted manifest/catalog source will feed verified regional packs here.
          </Text>
        </View>
      ) : (
        packCatalog.map(entry => {
          const manifest = entry.manifest;
          const busy = busyPackId === manifest.id || entry.installState === 'installing';
          const remote = manifest.source.kind === 'remote';
          const canInstall =
            remote && mapPackInstallSupported && entry.installState !== 'ready';
          const removing = pendingRemovalId === manifest.id;

          return (
            <View key={manifest.id} style={styles.packCard}>
              <View style={styles.packTopRow}>
                <View style={styles.packCopy}>
                  <Text style={styles.packName}>{manifest.name}</Text>
                  <Text style={styles.packDetail}>
                    {manifest.format.toUpperCase()} · z{manifest.minZoom}–{manifest.maxZoom} ·{' '}
                    {formatBytes(manifest.expectedBytes)}
                  </Text>
                  <Text style={styles.packDetail}>
                    v{manifest.version} · {manifest.source.kind === 'remote' ? 'HTTPS' : 'LOCAL IMPORT'}
                  </Text>
                </View>
                <Text
                  style={
                    entry.installState === 'ready'
                      ? styles.statusReady
                      : entry.installState === 'invalid'
                        ? styles.statusInvalid
                        : styles.statusPending
                  }>
                  {installLabel(entry)}
                </Text>
              </View>

              {entry.lastError ? (
                <Text style={styles.packError}>{entry.lastError}</Text>
              ) : null}

              <View style={styles.actions}>
                {canInstall ? (
                  <TouchableOpacity
                    style={[styles.actionPrimary, busy && styles.disabled]}
                    disabled={busy}
                    onPress={() => {
                      runInstall(manifest.id).catch(() => undefined);
                    }}>
                    <Text style={styles.actionPrimaryText}>
                      {busy ? 'WORKING…' : entry.installState === 'invalid' ? 'RETRY' : 'DOWNLOAD'}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {entry.installState === 'ready' ? (
                  <TouchableOpacity
                    style={[styles.actionSecondary, busy && styles.disabled]}
                    disabled={busy}
                    onPress={() => {
                      runVerify(manifest.id).catch(() => undefined);
                    }}>
                    <Text style={styles.actionSecondaryText}>VERIFY</Text>
                  </TouchableOpacity>
                ) : null}

                {entry.artifact !== null || entry.installState === 'ready' ? (
                  <TouchableOpacity
                    style={[styles.actionDanger, busy && styles.disabled]}
                    disabled={busy}
                    onPress={() => {
                      runRemove(manifest.id).catch(() => undefined);
                    }}>
                    <Text style={styles.actionDangerText}>
                      {removing ? 'CONFIRM REMOVE' : 'REMOVE'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 14,
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  headerCopy: {flex: 1},
  eyebrow: {color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1},
  title: {color: colors.textPrimary, fontSize: 17, fontWeight: '900', marginTop: 3},
  meta: {color: colors.textMuted, fontSize: 9, fontWeight: '800', marginTop: 4},
  nativePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  nativeReady: {borderColor: colors.success},
  nativeUnavailable: {borderColor: colors.warning},
  nativePillText: {color: colors.textSecondary, fontSize: 7, fontWeight: '900'},
  explainer: {color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 10},
  warning: {color: colors.warning, fontSize: 10, lineHeight: 15, marginTop: 8},
  message: {color: colors.accent, fontSize: 10, lineHeight: 15, marginTop: 8},
  emptyBox: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  emptyTitle: {color: colors.textPrimary, fontSize: 12, fontWeight: '900'},
  emptyText: {color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 4},
  packCard: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
  },
  packTopRow: {flexDirection: 'row', gap: 10, alignItems: 'flex-start'},
  packCopy: {flex: 1},
  packName: {color: colors.textPrimary, fontSize: 13, fontWeight: '900'},
  packDetail: {color: colors.textMuted, fontSize: 9, marginTop: 3},
  statusReady: {color: colors.success, fontSize: 8, fontWeight: '900'},
  statusPending: {color: colors.warning, fontSize: 8, fontWeight: '900'},
  statusInvalid: {color: colors.danger, fontSize: 8, fontWeight: '900'},
  packError: {color: colors.danger, fontSize: 9, lineHeight: 14, marginTop: 7},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10},
  actionPrimary: {
    borderRadius: 10,
    backgroundColor: colors.accent,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  actionPrimaryText: {color: colors.background, fontSize: 8, fontWeight: '900'},
  actionSecondary: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  actionSecondaryText: {color: colors.textPrimary, fontSize: 8, fontWeight: '900'},
  actionDanger: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  actionDangerText: {color: colors.danger, fontSize: 8, fontWeight: '900'},
  disabled: {opacity: 0.45},
});
