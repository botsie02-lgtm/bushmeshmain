import React, {useMemo, useState} from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {distanceMeters, formatDistance, getConvoyFreshness} from '../convoy/convoy';
import {useBushMesh} from '../state/BushMeshContext';
import {useConvoy} from '../state/ConvoyContext';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {colors} from '../theme/colors';

function ageLabel(timestampSeconds: number | null, nowMs: number): string {
  if (timestampSeconds === null || timestampSeconds <= 0) return 'Never heard';
  const ageSeconds = Math.max(0, Math.floor(nowMs / 1000) - timestampSeconds);
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  if (ageSeconds < 3_600) return `${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86_400) return `${Math.floor(ageSeconds / 3_600)}h ago`;
  return `${Math.floor(ageSeconds / 86_400)}d ago`;
}

function shortKey(prefix: string): string {
  const normalized = prefix.toUpperCase();
  return normalized.length <= 12
    ? normalized
    : `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export function ContactsScreen(): React.JSX.Element {
  const {contacts, connectionStatus, connectedDeviceName} = useBushMesh();
  const {
    snapshot,
    syncContacts,
    lookupContact,
    addOrUpdateContact,
    removeContact,
    exportContact,
    importContact,
  } = useRadioConnection();
  const {
    vehicles,
    localPosition,
    navigationTargetVehicleId,
    setNavigationTarget,
    clearNavigationTarget,
  } = useConvoy();
  const [query, setQuery] = useState('');
  const [lookupKey, setLookupKey] = useState('');
  const [addKey, setAddKey] = useState('');
  const [addName, setAddName] = useState('');
  const [importValue, setImportValue] = useState('');
  const [exportValue, setExportValue] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState(
    'Contacts are stored on the MeshCore node. Local filtering does not discover nearby radios.',
  );
  const nowMs = Date.now();
  const canManage = connectionStatus === 'Connected' && !snapshot.isWriting;

  const filteredContacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...contacts].sort((a, b) => {
      const aAdvert = a.lastAdvert ?? 0;
      const bAdvert = b.lastAdvert ?? 0;
      if (aAdvert !== bAdvert) return bAdvert - aAdvert;
      return a.name.localeCompare(b.name);
    });
    if (!needle) return sorted;
    return sorted.filter(contact =>
      `${contact.name} ${contact.publicKeyPrefix} ${contact.publicKey}`
        .toLowerCase()
        .includes(needle),
    );
  }, [contacts, query]);

  const liveMatches = useMemo(() => {
    const byId = new Map<string, (typeof vehicles)[number]>();
    vehicles.forEach(vehicle => byId.set(vehicle.id.toUpperCase(), vehicle));
    return byId;
  }, [vehicles]);

  const runSync = async () => {
    const synced = await syncContacts();
    setActionStatus(`Synced ${synced.length} contact(s) from the connected node.`);
  };

  const runLookup = async () => {
    try {
      const contact = await lookupContact(lookupKey);
      setActionStatus(`Refreshed ${contact.name || shortKey(contact.publicKeyPrefix)} from the node.`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Contact lookup failed.');
    }
  };

  const runAdd = async () => {
    try {
      const contact = await addOrUpdateContact({publicKey: addKey, name: addName});
      setActionStatus(`Contact ${contact.name || shortKey(contact.publicKeyPrefix)} written and verified.`);
      setAddKey('');
      setAddName('');
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Contact write failed.');
    }
  };

  const runImport = async () => {
    try {
      const updated = await importContact(importValue);
      setActionStatus(`Contact import accepted. Node now reports ${updated.length} contact(s).`);
      setImportValue('');
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Contact import failed.');
    }
  };

  const confirmRemove = (publicKey: string, name: string) => {
    Alert.alert(
      'Remove contact?',
      `Remove ${name || shortKey(publicKey)} from the connected MeshCore node?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeContact(publicKey)
              .then(() => setActionStatus('Contact removed and node list refreshed.'))
              .catch(error =>
                setActionStatus(
                  error instanceof Error ? error.message : 'Contact removal failed.',
                ),
              );
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.eyebrow}>RADIO CONTACTS</Text>
        <Text style={styles.title}>People and nodes</Text>
        <Text style={styles.body}>
          MeshCore does not provide an arbitrary “search everyone nearby” command.
          BushMesh syncs the node's stored contact table and can perform an exact
          firmware lookup by a full 32-byte public key. A short prefix is resolved
          locally only when it uniquely matches a synced contact.
        </Text>
        <Text style={styles.meta}>
          {connectedDeviceName ? `Node: ${connectedDeviceName}` : 'No node connected'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Node contact actions</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.primaryButton, !canManage && styles.disabled]} disabled={!canManage} onPress={() => runSync().catch(() => undefined)}>
            <Text style={styles.primaryText}>Sync Contacts from Node</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryButton, !canManage && styles.disabled]} disabled={!canManage} onPress={() => runSync().catch(() => undefined)}>
            <Text style={styles.secondaryText}>Refresh contacts</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>LOOK UP CONTACT</Text>
        <TextInput style={styles.input} value={lookupKey} onChangeText={setLookupKey} placeholder="Full public key or unique synced prefix" placeholderTextColor={colors.textMuted} autoCapitalize="characters" autoCorrect={false} />
        <TouchableOpacity style={[styles.secondaryButton, !canManage && styles.disabled]} disabled={!canManage} onPress={runLookup}>
          <Text style={styles.secondaryText}>Look up on node</Text>
        </TouchableOpacity>

        <Text style={styles.label}>ADD / UPDATE DIRECT CONTACT</Text>
        <Text style={styles.help}>
          Requires the contact's full public key. This writes a direct/zero-hop contact record and verifies it with CMD_GET_CONTACT_BY_KEY. Import an exported contact to preserve richer routing metadata.
        </Text>
        <TextInput style={styles.input} value={addName} onChangeText={setAddName} placeholder="Contact name" placeholderTextColor={colors.textMuted} />
        <TextInput style={styles.input} value={addKey} onChangeText={setAddKey} placeholder="64-character public key hex" placeholderTextColor={colors.textMuted} autoCapitalize="characters" autoCorrect={false} />
        <TouchableOpacity style={[styles.secondaryButton, !canManage && styles.disabled]} disabled={!canManage} onPress={runAdd}>
          <Text style={styles.secondaryText}>Write and verify contact</Text>
        </TouchableOpacity>

        <Text style={styles.label}>IMPORT EXPORTED CONTACT</Text>
        <TextInput style={[styles.input, styles.multiline]} value={importValue} onChangeText={setImportValue} placeholder="Paste BushMesh/MeshCore contact export" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} multiline />
        <TouchableOpacity style={[styles.secondaryButton, !canManage && styles.disabled]} disabled={!canManage} onPress={runImport}>
          <Text style={styles.secondaryText}>Import contact to node</Text>
        </TouchableOpacity>

        <View style={styles.statusBox}><Text style={styles.statusText}>{actionStatus}</Text></View>
        {exportValue ? (
          <View style={styles.exportBox}>
            <Text style={styles.label}>EXPORTED CONTACT · SELECT / COPY</Text>
            <Text selectable style={styles.exportText}>{exportValue}</Text>
            <TouchableOpacity onPress={() => setExportValue(null)}><Text style={styles.linkText}>Hide export</Text></TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Local contact filter</Text>
        <Text style={styles.help}>
          This only filters contacts already loaded into BushMesh. It does not send a radio discovery request.
        </Text>
        <TextInput value={query} onChangeText={setQuery} placeholder="Filter loaded contacts by name or key" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.input} />
        <Text style={styles.meta}>{filteredContacts.length} of {contacts.length} loaded contact(s) shown</Text>
      </View>

      {filteredContacts.length === 0 ? (
        <View style={styles.card}><Text style={styles.body}>{contacts.length === 0 ? 'No contacts synced yet.' : 'No locally loaded contacts match this filter.'}</Text></View>
      ) : (
        filteredContacts.map(contact => {
          const liveVehicle = liveMatches.get(contact.publicKeyPrefix.toUpperCase()) ?? null;
          const freshness = liveVehicle ? getConvoyFreshness(liveVehicle.receivedAtMs, nowMs) : null;
          const following = liveVehicle !== null && navigationTargetVehicleId === liveVehicle.id;
          const rangeMeters = liveVehicle && localPosition ? distanceMeters(localPosition, liveVehicle) : null;
          return (
            <View key={contact.publicKey} style={styles.contactCard}>
              <View style={styles.contactTop}>
                <View style={styles.flex}>
                  <Text style={styles.contactName}>{contact.name || 'Unnamed contact'}</Text>
                  <Text selectable style={styles.keyText}>{shortKey(contact.publicKeyPrefix)} · {ageLabel(contact.lastAdvert, nowMs)}</Text>
                </View>
                {freshness ? <Text style={styles.liveText}>{freshness.toUpperCase()}</Text> : null}
              </View>
              <Text style={styles.help}>
                Type {contact.type} · path {contact.outPathLength < 0 ? 'unknown' : `${contact.outPathLength} hop(s)`}
              </Text>
              {liveVehicle ? (
                <View style={styles.liveBox}>
                  <Text style={styles.liveText}>LIVE BUSHMESH POSITION</Text>
                  <Text style={styles.body}>{liveVehicle.latitude.toFixed(5)}, {liveVehicle.longitude.toFixed(5)}{rangeMeters === null ? '' : ` · ${formatDistance(rangeMeters)} away`}</Text>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => following ? clearNavigationTarget() : setNavigationTarget(liveVehicle.id)}>
                    <Text style={styles.secondaryText}>{following ? 'Stop following' : 'Follow live position'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <View style={styles.contactActions}>
                <TouchableOpacity onPress={() => exportContact(contact.publicKey).then(value => {setExportValue(value); setActionStatus('Contact export ready. This contains public contact/routing data, not a node private key.');}).catch(error => setActionStatus(error instanceof Error ? error.message : 'Contact export failed.'))} disabled={!canManage}>
                  <Text style={styles.linkText}>Export</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmRemove(contact.publicKey, contact.name)} disabled={!canManage}>
                  <Text style={styles.dangerText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 40, gap: 12},
  card: {backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 16},
  eyebrow: {color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.1},
  title: {color: colors.textPrimary, fontSize: 24, fontWeight: '900', marginTop: 4},
  sectionTitle: {color: colors.textPrimary, fontSize: 17, fontWeight: '900', marginBottom: 8},
  body: {color: colors.textSecondary, fontSize: 13, lineHeight: 20},
  meta: {color: colors.textMuted, fontSize: 11, marginTop: 8},
  label: {color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginTop: 16},
  help: {color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 5},
  input: {backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 11, marginTop: 9},
  multiline: {minHeight: 80, textAlignVertical: 'top'},
  buttonRow: {gap: 8},
  primaryButton: {backgroundColor: colors.accent, borderRadius: 13, alignItems: 'center', paddingVertical: 12, marginTop: 9},
  primaryText: {color: colors.background, fontWeight: '900'},
  secondaryButton: {borderWidth: 1, borderColor: colors.accent, borderRadius: 13, alignItems: 'center', paddingVertical: 10, marginTop: 9},
  secondaryText: {color: colors.accent, fontWeight: '900'},
  disabled: {opacity: 0.45},
  statusBox: {backgroundColor: colors.surfaceSoft, borderRadius: 12, padding: 11, marginTop: 14},
  statusText: {color: colors.textSecondary, fontSize: 11, lineHeight: 17},
  exportBox: {borderWidth: 1, borderColor: colors.warning, borderRadius: 12, padding: 11, marginTop: 10},
  exportText: {color: colors.textPrimary, fontSize: 10, marginTop: 7},
  contactCard: {backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 15},
  contactTop: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  flex: {flex: 1},
  contactName: {color: colors.textPrimary, fontSize: 16, fontWeight: '900'},
  keyText: {color: colors.textMuted, fontSize: 10, marginTop: 4},
  liveText: {color: colors.success, fontSize: 10, fontWeight: '900'},
  liveBox: {backgroundColor: colors.surfaceSoft, borderRadius: 12, padding: 10, marginTop: 10},
  contactActions: {flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 12},
  linkText: {color: colors.accent, fontSize: 11, fontWeight: '900', marginTop: 8},
  dangerText: {color: colors.danger, fontSize: 11, fontWeight: '900', marginTop: 8},
});
