import React, {useState} from 'react';
import {FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {colors} from '../../theme/colors';
import type {BushMeshChannelMessage} from '../../state/BushMeshContext';
import {deliveryText} from './messengerModel';

/** Read-only access to the original encrypted Radio History with no
 * unsupported attribution to a current radio, slot incarnation or sender.
 * This view NEVER exposes send, reply, join, unread or membership operations.
 */
export function RadioQuarantineReview({
  messages, onBack,
}: {messages: readonly BushMeshChannelMessage[]; onBack: () => void}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const ordered = [...messages].filter(m => [m.channelName, m.text].some(value => value.toLowerCase().includes(search.toLowerCase()))).sort((a, b) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <TouchableOpacity accessibilityRole="button"
          accessibilityLabel="Back to chats"
          style={styles.back} onPress={onBack}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Unattributed history</Text>
      </View>
      <View style={styles.warning}>
        <Text style={styles.warningTitle}>ENCRYPTED · OWNERSHIP UNPROVEN</Text>
        <Text style={styles.warningText}>
          These saved messages have no proven original channel generation. Slot numbers and recorded names may have been reused.
          They are preserved as separate read-only records, not merged into chats.
        </Text>
      </View>
      <TextInput accessibilityLabel="Search saved records" value={search} onChangeText={setSearch} placeholder="Search saved records" placeholderTextColor={colors.textSecondary} style={styles.search}/>
      <FlatList
        accessibilityLabel="Unattributed saved radio messages"
        data={ordered}
        keyExtractor={message => message.id}
        contentContainerStyle={styles.list}
        renderItem={({item}) => (
          <View style={styles.card}>
            <Text style={styles.meta}>
              Recorded slot {item.channelIndex} · {item.channelName || 'Name unknown'}
            </Text>
            <Text style={styles.direction}>
              {item.direction === 'received'
                ? 'Incoming · sender not recorded' : 'Outgoing · local record'}
            </Text>
            {item.observation && <Text style={styles.direction}>Observed via {item.observation.source === 'native-session' ? 'Android radio' : 'Bluetooth session'}{item.observation.configurationName ? ' · locally configured ' + item.observation.configurationName : ''} · original queue key unknown{item.observation.snr !== null ? ' · SNR ' + item.observation.snr : ''}{item.observation.pathLength !== null ? ' · path ' + item.observation.pathLength : ''}</Text>}
            <Text style={styles.message}>{item.text}</Text>
            <Text style={styles.time}>
              {new Date(item.createdAt).toLocaleString()} · {deliveryText(item)}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No unattributed historical records.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  heading: {height: 64, flexDirection: 'row', alignItems: 'center',
    paddingRight: 14, gap: 6},
  back: {height: 56, width: 52, alignItems: 'center', justifyContent: 'center'},
  backText: {color: colors.accent, fontSize: 36},
  title: {color: colors.textPrimary, fontSize: 20, fontWeight: '900'},
  warning: {marginHorizontal: 12, marginTop: 8, padding: 13,
    backgroundColor: colors.surfaceSoft, borderRadius: 12, gap: 6},
  warningTitle: {color: colors.warning, fontSize: 12, fontWeight: '900'},
  warningText: {color: colors.textSecondary, fontSize: 13, lineHeight: 20},
  search: {minHeight: 48, margin: 12, paddingHorizontal: 12, color: colors.textPrimary, backgroundColor: colors.surfaceSoft, borderRadius: 10},
  list: {padding: 12, gap: 8, paddingBottom: 25},
  card: {padding: 13, borderRadius: 14, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, gap: 6},
  meta: {color: colors.warning, fontSize: 12, fontWeight: '800'},
  direction: {color: colors.textSecondary, fontSize: 11},
  message: {color: colors.textPrimary, fontSize: 16, lineHeight: 24},
  time: {color: colors.textSecondary, fontSize: 11, lineHeight: 16},
  empty: {color: colors.textSecondary, fontSize: 14, padding: 25},
});
