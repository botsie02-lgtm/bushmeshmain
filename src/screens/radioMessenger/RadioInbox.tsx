import React, {useEffect, useState} from 'react';
import {
  FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import {colors} from '../../theme/colors';
import {ChatAvatar} from '../../radio/chatManagement/ChatAvatar';
import type {MessengerConversation, RadioConversationScope} from './messengerModel';
import {conversationKey} from './messengerModel';

type ActionProps = {
  label: string; onPress: () => void; subtle?: boolean;
};
function Action({label, onPress, subtle = false}: ActionProps) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label}
      onPress={onPress} style={[styles.action, subtle && styles.subtle]}>
      <Text style={[styles.actionText, subtle && styles.subtleText]}>{label}</Text>
    </TouchableOpacity>
  );
}

export type RadioInboxProps = {
  conversations: readonly MessengerConversation[];
  managed?: boolean;
  visible?: boolean;
  filter?: 'all' | 'unread' | 'pinned' | 'archived';
  onFilter?: (value: 'all' | 'unread' | 'pinned' | 'archived') => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  online: boolean;
  radioLabel: string | null;
  restoring: boolean;
  historyIssue: string | null;
  unknownHistoryCount: number;
  search: string;
  onSearch: (value: string) => void;
  onOpen: (scope: RadioConversationScope) => void;
  onPin: (scope: RadioConversationScope) => void;
  onNewChat: () => void;
  onSettings: () => void;
  onReviewUnattributed: () => void;
  onOpenRowMenu?: (scope: RadioConversationScope) => void;
  onOpenChatSettings?: (scope: RadioConversationScope) => void;
  onConnection?: () => void;
  connectionStatus?: string;
  onArchive?: (scope: RadioConversationScope) => void;
  onMarkUnread?: (scope: RadioConversationScope) => void;
  onSearchRoom?: (scope: RadioConversationScope) => void;
  onLeave?: (scope: RadioConversationScope) => void;
  canLeave?: (scope: RadioConversationScope) => boolean;
};

function clock(value: number | null) {
  if (value === null) return '';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short',
  });
}

export function RadioInbox({
  conversations, online, radioLabel, restoring, historyIssue,
  unknownHistoryCount, search, onSearch, onOpen, onPin, onNewChat,
  onSettings, onReviewUnattributed, onOpenRowMenu, onOpenChatSettings, managed,
  visible = true, filter = 'all', onFilter, onRefresh, refreshing = false,
  onConnection, connectionStatus, onArchive, onMarkUnread, onSearchRoom, onLeave, canLeave,
}: RadioInboxProps): React.JSX.Element {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const selected = conversations.find(item => conversationKey(item.scope) === menuFor);
  useEffect(() => {
    if (!visible || (menuFor && !selected)) setMenuFor(null);
  }, [visible, menuFor, selected]);
  const closeMenu = () => setMenuFor(null);
  const action = (callback: (scope: RadioConversationScope) => void) => {
    if (!selected) return;
    const scope = selected.scope;
    closeMenu();
    callback(scope);
  };
  const openMenu = (scope: RadioConversationScope) => {
    onOpenRowMenu?.(scope);
    setMenuFor(conversationKey(scope));
  };
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>BUSHMESH · OFF GRID</Text>
          <Text style={styles.title}>Chats</Text>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity accessibilityRole="button"
            accessibilityLabel="Messaging settings"
            onPress={onSettings} style={styles.headerIcon}>
            <Text style={styles.iconText}>⚙</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
            accessibilityLabel="New chat"
            onPress={onNewChat} style={styles.newChat}>
            <Text style={styles.newChatText}>＋</Text>
          </TouchableOpacity>
        </View>
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={onConnection ? (online ? "Manage radio connection" : "Connect radio") : "Explain radio status"}
        onPress={onConnection ?? (() => setShowInfo(v => !v))} style={styles.connectionStrip}>
        <View style={[styles.dot, {backgroundColor: online ? colors.success : colors.warning}]} />
        <Text style={styles.connectionLabel}>
          {online ? 'Companion connected' : connectionStatus && /scan|connect|request/i.test(connectionStatus) && connectionStatus !== 'Disconnected' ? connectionStatus : 'Radio disconnected'}
        </Text>
        <Text style={styles.connectionDetail} numberOfLines={1}>
          {online ? radioLabel ?? 'MeshCore' : 'Saved conversations only'}
        </Text>
        <Text style={styles.chevron}>{onConnection ? (online ? "Manage ›" : "Connect ›") : "ⓘ"}</Text>
      </TouchableOpacity>
      {showInfo ? <Text style={styles.notice}>
        A connected companion is not proof of peer availability or message
        delivery. Channel chats are not Security-verified convoy memberships.
      </Text> : null}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel="Search conversations"
          placeholder="Search chats"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          value={search}
          onChangeText={onSearch}
          style={styles.search}
          returnKeyType="search"
        />
        {search ? <TouchableOpacity accessibilityRole="button"
          accessibilityLabel="Clear conversation search"
          onPress={() => onSearch('')} style={styles.clear}>
          <Text style={styles.clearText}>×</Text>
        </TouchableOpacity> : null}
      </View>
      {managed && onFilter ? <View style={styles.filters}>{(['all', 'unread', 'pinned', 'archived'] as const).map(value => <TouchableOpacity key={value}
        accessibilityRole="button" accessibilityLabel={value === 'archived' ? 'Show archived chats' : 'Filter ' + value}
        accessibilityState={{selected: filter === value}} onPress={() => onFilter(value)} style={[styles.filter, filter === value && styles.selectedFilter]}>
        <Text style={styles.filterText}>{value[0].toUpperCase() + value.slice(1)}</Text>
      </TouchableOpacity>)}</View> : null}
      {restoring ? <Text style={styles.notice}>Restoring encrypted Radio History…</Text> : null}
      {historyIssue ? <Text style={styles.warning}>
        History storage needs attention. {historyIssue}
      </Text> : null}
      {unknownHistoryCount > 0 ? <TouchableOpacity accessibilityRole="button"
        accessibilityLabel="Review unattributed Radio History" onPress={onReviewUnattributed} style={styles.reviewButton}>
        <Text style={styles.reviewText}>{unknownHistoryCount} historical message{unknownHistoryCount === 1 ? '' : 's'} held separately</Text>
      </TouchableOpacity> : null}
      <FlatList
        accessibilityLabel="Conversation inbox"
        data={conversations}
        keyExtractor={item => conversationKey(item.scope)}
        keyboardShouldPersistTaps="always"
        onRefresh={onRefresh} refreshing={refreshing}
        contentContainerStyle={styles.list}
        renderItem={({item}) => {
          const id = conversationKey(item.scope);
          const open = menuFor === id;
          const repeatedSlot = conversations.filter(other =>
            other.channel.channelIndex === item.channel.channelIndex &&
            other.channel.channelName === item.channel.channelName).length > 1;
          const distinction = repeatedSlot ? ' · ' + (managed ? (item.verifiedNow ? 'current ' : 'saved ') + item.scope.channelGeneration.slice(-6) + ' #' + (item.scope.channelGeneration.split(':')[1] ?? '1') : item.scope.channelGeneration) : '';
          return (
            <View style={styles.rowWrap}>
              <View style={styles.rowLine}>
              <TouchableOpacity accessibilityRole="button"
                accessibilityLabel={'Open chat ' + item.channel.channelName + distinction}
                onPress={() => {setMenuFor(null); onOpen(item.scope);}}
                onLongPress={() => openMenu(item.scope)}
                style={styles.row} activeOpacity={0.75}>
                {item.personalisation ? <ChatAvatar name={item.displayName || item.channel.channelName}
                  {...item.personalisation}/> : <View style={styles.avatar}><Text style={styles.avatarText}>#</Text></View>}
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {item.displayName || item.channel.channelName}{managed && repeatedSlot ? ' · ' + (item.verifiedNow ? 'current' : 'saved') : ''}{item.pinned ? '  ★' : ''}
                    </Text>
                    <Text style={styles.when}>{clock(item.activityMs)}</Text>
                  </View>
                  <Text style={styles.preview} numberOfLines={2}>{item.preview}</Text>
                  {managed ? (!item.verifiedNow && <Text style={styles.subline}>Saved · read-only</Text>) : <Text style={styles.subline}>Channel {item.channel.channelIndex} · {item.scope.channelGeneration.startsWith('session-') ? 'This-session identity' : 'Saved conversation'}{item.unreadCount === null ? '' : ' · Read state available'}</Text>}
                </View>
                {item.manualUnread && !item.unreadCount ? <View style={styles.unread}
                  accessibilityLabel="Manually marked unread"><Text style={styles.unreadText}>•</Text></View> : null}
                {item.unreadCount !== null && item.unreadCount > 0 ? (
                  <View style={styles.unread}
                    accessibilityLabel={item.unreadCount + ' unread messages'}>
                    <Text style={styles.unreadText}>{item.unreadCount}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button"
                accessibilityLabel={'Chat options ' + item.channel.channelName + distinction}
                accessibilityState={{expanded: open}}
                onPress={() => openMenu(item.scope)}
                style={styles.rowMore}>
                <Text style={styles.moreText}>⋮</Text>
              </TouchableOpacity>
              </View>

            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptySymbol}>◎</Text>
            <Text style={styles.emptyTitle}>
              {search ? 'No chats match your search'
                : online ? 'No configured channel chats' : 'No chats available offline'}
            </Text>
            <Text style={styles.emptyBody}>
              {search ? 'Try a channel name or a safely attributed message preview.'
                : managed ? 'Refresh the connected radio or use + to create or join. Unattributed history stays separate.'
                  : 'Create or join a MeshCore channel through your existing carrier tools. Radio History without ownership proof stays quarantined.'}
            </Text>
          </View>
        }
      />
      {visible && selected ? <Modal transparent animationType="none" visible onRequestClose={closeMenu}>
        <View style={styles.overlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss conversation options" style={StyleSheet.absoluteFill} onPress={closeMenu}/>
          <View accessibilityViewIsModal style={styles.sheet}>
            <Text style={styles.rowName}>{selected.displayName || selected.channel.channelName}</Text>
            <ScrollView keyboardShouldPersistTaps="always" style={styles.sheetScroll}>
              <Action subtle label={selected.pinned ? 'Unpin chat' : 'Pin chat'} onPress={() => action(onPin)}/>
              {onArchive && <Action subtle label={filter === 'archived' ? 'Unarchive chat' : 'Archive chat'} onPress={() => action(onArchive)}/>}
              {onMarkUnread && <Action subtle label="Mark unread" onPress={() => action(onMarkUnread)}/>}
              {onSearchRoom && <Action subtle label="Search conversation" onPress={() => action(onSearchRoom)}/>}
              <Action subtle label="Chat details" onPress={() => action(onOpenChatSettings ?? onOpen)}/>
              {onLeave && canLeave?.(selected.scope) && <Action subtle label="Leave chat" onPress={() => action(onLeave)}/>}
              <Action subtle label="Close chat options" onPress={closeMenu}/>
            </ScrollView>
          </View>
        </View>
      </Modal> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  header: {minHeight: 64, paddingHorizontal: 18, paddingTop: 9,
    paddingBottom: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  headerCopy: {flex: 1},
  eyebrow: {color: colors.textSecondary, letterSpacing: 1.1,
    fontWeight: '800', fontSize: 10},
  title: {color: colors.textPrimary, fontSize: 29, fontWeight: '900'},
  headerButtons: {flexDirection: 'row', gap: 8},
  headerIcon: {minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center'},
  iconText: {color: colors.textPrimary, fontSize: 22},
  newChat: {width: 52, height: 52, backgroundColor: colors.accent, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center'},
  newChatText: {fontSize: 29, fontWeight: '600', color: colors.background},
  connectionStrip: {minHeight: 46, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 18, gap: 9, borderBottomWidth: 1, borderBottomColor: colors.border},
  dot: {width: 8, height: 8, borderRadius: 4},
  connectionLabel: {color: colors.textPrimary, fontSize: 12, fontWeight: '700'},
  connectionDetail: {flex: 1, textAlign: 'right', color: colors.textSecondary, fontSize: 12},
  chevron: {color: colors.textSecondary, fontSize: 15},
  searchWrap: {height: 48, flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginVertical: 11, paddingHorizontal: 11, gap: 8,
    backgroundColor: colors.surfaceSoft, borderRadius: 13},
  searchIcon: {color: colors.textSecondary, fontSize: 24},
  search: {flex: 1, padding: 0, color: colors.textPrimary, fontSize: 15},
  clear: {minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center'},
  clearText: {fontSize: 24, color: colors.textPrimary},
  filters: {flexDirection: 'row', paddingHorizontal: 12, gap: 5},
  filter: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center'},
  selectedFilter: {borderBottomWidth: 2, borderBottomColor: colors.accent},
  filterText: {color: colors.textPrimary, fontSize: 13, fontWeight: '700'},
  list: {flexGrow: 1, paddingBottom: 22},
  rowWrap: {borderBottomWidth: 1, borderBottomColor: colors.border},
  rowLine: {flexDirection: 'row', alignItems: 'center'},
  row: {flex: 1, flexDirection: 'row', minHeight: 86, paddingLeft: 16, paddingRight: 4,
    alignItems: 'center', gap: 11},
  avatar: {width: 49, height: 49, borderRadius: 17, backgroundColor: '#29382E',
    alignItems: 'center', justifyContent: 'center'},
  avatarText: {fontSize: 27, fontWeight: '900', color: colors.accent},
  rowBody: {flex: 1, paddingVertical: 9},
  rowTop: {flexDirection: 'row', alignItems: 'center', gap: 8},
  rowName: {flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '800'},
  when: {color: colors.textSecondary, fontSize: 11},
  preview: {fontSize: 13, lineHeight: 18, color: colors.textSecondary, marginTop: 3},
  subline: {fontSize: 11, color: colors.textSecondary, marginTop: 4},
  rowMore: {width: 52, height: 58, alignItems: 'center', justifyContent: 'center'},
  moreText: {color: colors.textPrimary, fontSize: 25},
  unread: {minWidth: 25, minHeight: 25, borderRadius: 13, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center', marginRight: 4},
  unreadText: {fontSize: 12, fontWeight: '900', color: colors.background},
  overlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end'},
  sheet: {backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: '85%', gap: 12},
  sheetScroll: {flexGrow: 0},
  action: {minHeight: 48, paddingHorizontal: 14, borderRadius: 11,
    backgroundColor: colors.accent, justifyContent: 'center'},
  subtle: {backgroundColor: colors.surfaceSoft},
  actionText: {color: colors.background, fontSize: 13, fontWeight: '800'},
  subtleText: {color: colors.textPrimary},
  notice: {color: colors.textSecondary, fontSize: 12, lineHeight: 18,
    marginHorizontal: 17, marginBottom: 9},
  warning: {color: colors.warning, fontSize: 13, lineHeight: 20,
    marginHorizontal: 17, marginBottom: 9},
  quarantine: {backgroundColor: colors.surfaceSoft, marginHorizontal: 16,
    padding: 11, borderRadius: 11, marginBottom: 6},
  quarantineTitle: {fontSize: 12, fontWeight: '800', color: colors.warning},
  reviewButton: {minHeight: 48, marginTop: 7, justifyContent: 'center',
    alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.border},
  reviewText: {fontSize: 13, color: colors.accent, fontWeight: '800'},
  quarantineText: {fontSize: 12, color: colors.textSecondary, lineHeight: 18, marginTop: 3},
  empty: {paddingHorizontal: 26, paddingTop: 45, alignItems: 'center'},
  emptySymbol: {color: colors.accent, fontSize: 44},
  emptyTitle: {color: colors.textPrimary, fontSize: 18, fontWeight: '800', textAlign: 'center'},
  emptyBody: {color: colors.textSecondary, fontSize: 13, lineHeight: 20,
    textAlign: 'center', marginTop: 8},
});
