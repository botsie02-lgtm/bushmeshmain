import React, {useState} from 'react';
import {StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {colors} from '../../theme/colors';
import {ChatConfiguration, ChatSort, defaultChatPreferences, selectChats} from './chatPreferences';
import {ChatAvatar} from './ChatAvatar';
import {ChatManagementSelection} from './ChatManagementDialog';
import {ChatManagementController} from './useChatManagement';

/** Optional inbox controls. Both the inbox and chat room use the same dialog. */
export function ChatInboxControls({controller, onManage, onOpen}: {
  controller: ChatManagementController;
  onManage: (selection: ChatManagementSelection) => void;
  onOpen: (chat: ChatConfiguration) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const sort = controller.sort;
  const visible = selectChats(controller.chats, controller.preferences, query, archived, sort);
  const sortLabels: Record<ChatSort, string> = {name: 'Name', unread: 'Unread first', slot: 'Radio slot'};
  const radio = controller.radio;
  const disabled = !radio || controller.busy || controller.radioBusy;
  return (
    <View style={styles.content}>
      <View style={styles.row}>
        <TouchableOpacity accessibilityRole="button" disabled={disabled}
          onPress={() => controller.refresh().catch(() => undefined)}>
          <Text style={styles.link}>{controller.busy ? 'Working…' : 'Refresh chats'}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={disabled}
          onPress={() => {if (radio) onManage({kind: 'create', radio});}}>
          <Text style={styles.link}>New chat</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={disabled}
          onPress={() => {if (radio) onManage({kind: 'join', radio});}}>
          <Text style={styles.link}>Join chat</Text>
        </TouchableOpacity>
      </View>
      <TextInput accessibilityLabel="Search chat names" style={styles.input}
        placeholder="Search chats" placeholderTextColor={colors.textMuted}
        value={query} onChangeText={setQuery} autoCorrect={false}/>
      <TouchableOpacity accessibilityRole="button" onPress={() => setArchived(!archived)}>
        <Text style={styles.link}>{archived ? 'Show active chats' : 'Show archived chats'}</Text>
      </TouchableOpacity>
      <View style={styles.row}>
        {(['name', 'unread', 'slot'] as const).map(option => (
          <TouchableOpacity key={option} accessibilityRole="button"
            accessibilityState={{selected: option === sort, disabled: disabled || !controller.ready || controller.chats.length === 0}}
            disabled={disabled || !controller.ready || controller.chats.length === 0}
            onPress={() => controller.changeSort(option).catch(() => undefined)} style={[styles.sort, option === sort && styles.selected]}>
            <Text style={styles.body}>{sortLabels[option]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {controller.capacity && <Text style={styles.body}>{controller.capacity.used} of {controller.capacity.total} slots used</Text>}
      {!controller.ready && <Text style={styles.body}>Connect and sync your radio, then refresh chats.</Text>}
      {!!controller.error && <Text style={styles.body}>{controller.error}</Text>}
      {controller.ready && visible.length === 0 && <Text style={styles.body}>No matching chats.</Text>}
      {visible.map(chat => {
        const p = controller.preferences[chat.id] ?? defaultChatPreferences;
        return (
          <View key={chat.id} style={styles.chat}>
            <TouchableOpacity style={styles.grow} accessibilityRole="button"
              onPress={() => onOpen(chat)}>
              <View style={styles.identity}>
                <ChatAvatar name={p.displayName || chat.name} {...p}/>
                <View style={styles.grow}>
                  <Text style={styles.name}>{p.displayName || chat.name}</Text>
                  <Text style={styles.body}>{p.pinned ? 'Pinned · ' : ''}{p.unread ? 'Unread · ' : ''}Slot {chat.slot}</Text>
                  {!!p.description && <Text numberOfLines={1} style={styles.body}>{p.description}</Text>}
                </View>
              </View>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={'Settings for ' + (p.displayName || chat.name)}
              style={styles.moreTarget} onPress={() => onManage({kind: 'settings', chat})}>
              <Text style={styles.more}>⋯</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {gap: 12},
  row: {flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8},
  link: {color: colors.accent, fontWeight: '700', paddingVertical: 14},
  input: {color: colors.textPrimary, borderWidth: 1, borderColor: colors.border,
    padding: 12, borderRadius: 12, backgroundColor: colors.surface},
  chat: {flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: 14, padding: 12, gap: 12},
  grow: {flex: 1},
  identity: {flexDirection: 'row', alignItems: 'center', gap: 12},
  sort: {minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border},
  selected: {borderColor: colors.accent},
  moreTarget: {minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center'},
  name: {color: colors.textPrimary, fontSize: 16, fontWeight: '700'},
  more: {color: colors.accent, fontSize: 26, paddingHorizontal: 10},
  body: {color: colors.textSecondary, fontSize: 13},
});
