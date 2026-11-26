import React, {useMemo, useRef, useState} from 'react';
import {
  FlatList, KeyboardAvoidingView, NativeScrollEvent, NativeSyntheticEvent,
  Platform, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import {colors} from '../../theme/colors';
import {ChatAvatar} from '../../radio/chatManagement/ChatAvatar';
import type {ChatPersonalisation} from '../../radio/chatManagement/chatPreferences';
import type {BushMeshChannelMessage} from '../../state/BushMeshContext';
import {
  deliveryText, type RadioConversationScope, type ScopedMessage,
  validateCarrierText,
} from './messengerModel';

export type RadioChatRoomProps = {
  scope: RadioConversationScope;
  messages: readonly ScopedMessage[];
  connected: boolean;
  canSubmit: boolean;
  reason: string;
  draft: string;
  isSubmitting: boolean;
  notice: string | null;
  onDraft: (text: string) => void;
  onSend: () => void;
  onBack: () => void;
  onOpenSettings?: (scope: RadioConversationScope) => void;
  onOpenMenu?: (scope: RadioConversationScope) => void;
  personalisation?: ChatPersonalisation;
  displayName?: string;
  pinned: boolean;
  onTogglePinned: () => void;
};

function dateLabel(createdAt: string): string {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    }) : 'Time unknown';
}
function timeLabel(createdAt: string): string {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit',
    }) : 'Time unknown';
}

function Bubble({entry}: {entry: ScopedMessage}) {
  const message: BushMeshChannelMessage = entry.message;
  const outgoing = message.direction === 'sent';
  return (
    <View style={[styles.bubbleWrap, outgoing && styles.outgoingWrap]}>
      <View style={[styles.bubble, outgoing ? styles.outgoingBubble : styles.incomingBubble]}>
        {!outgoing ? <Text style={styles.sender}>
          Channel message · sender unavailable
        </Text> : null}
        <Text style={[styles.message, outgoing && styles.outgoingMessage]}>
          {message.text}
        </Text>
        <View style={styles.bubbleFooter}>
          <Text style={[styles.time, outgoing && styles.outgoingTime]}>
            {timeLabel(message.createdAt)}
          </Text>
        </View>
        {outgoing ? <Text style={[
          styles.delivery,
          message.status === 'failed' && styles.failed,
        ]}>{deliveryText(message)}</Text> : null}
        {message.submissionFailure ? (
          <Text style={[styles.delivery, styles.failed]}>
            {message.submissionFailure.reason === 'timeout'
              ? 'Acceptance unknown. Do not retry without checking radio history.'
              : 'Submission failed; peer delivery is not verified.'}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Chat is a UI projection only. It never changes the transport carrier,
 * the operational convoy, secure membership, or Bluetooth owner. */
export function RadioChatRoom({
  scope, messages, connected, canSubmit, reason, draft, isSubmitting,
  notice, onDraft, onSend, onBack, onOpenSettings, onOpenMenu, pinned,
  onTogglePinned, personalisation, displayName,
}: RadioChatRoomProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const listRef = useRef<FlatList<ScopedMessage>>(null);
  const nearBottom = useRef(true);
  const descending = useMemo(() => [...messages].reverse(), [messages]);
  const validation = validateCarrierText(draft);
  const sendEnabled = canSubmit && validation.valid && !isSubmitting;

  const onListScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // In an inverted FlatList, offset 0 is the newest (bottom) position.
    nearBottom.current = event.nativeEvent.contentOffset.y < 70;
  };

  return (
    <KeyboardAvoidingView style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button"
          accessibilityLabel="Back to chats"
          onPress={onBack} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        {personalisation ? <ChatAvatar name={displayName || scope.channelName} {...personalisation}/> :
          <View style={styles.avatar}><Text style={styles.avatarText}>#</Text></View>}
        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={1}>{displayName || scope.channelName}</Text>
          <Text style={[styles.subtitle, !connected && styles.offline]}>
            {connected ? (canSubmit ? 'Carrier ready · delivery unconfirmed' : 'Radio linked · unavailable')
              : 'Offline · read-only'}
          </Text>
        </View>
        <TouchableOpacity accessibilityRole="button"
          accessibilityLabel="Chat room options"
          accessibilityState={{expanded: menuOpen}}
          onPress={() => {setMenuOpen(v => !v); if (onOpenMenu) onOpenMenu(scope);}}
          style={styles.more}>
          <Text style={styles.moreText}>⋮</Text>
        </TouchableOpacity>
      </View>
      {menuOpen ? (
        <View style={styles.menu}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Chat settings"
            onPress={() => {
              setMenuOpen(false);
              if (onOpenSettings) onOpenSettings(scope);
              else setDetailsOpen(true);
            }} style={styles.menuButton}>
            <Text style={styles.menuText}>Chat details / settings</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button"
            accessibilityLabel={pinned ? 'Unpin chat' : 'Pin chat'}
            onPress={() => {onTogglePinned(); setMenuOpen(false);}}
            style={styles.menuButton}>
            <Text style={styles.menuText}>{pinned ? 'Unpin' : 'Pin'} for this session</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close room options"
            onPress={() => setMenuOpen(false)} style={styles.menuButton}>
            <Text style={styles.menuText}>Close</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {detailsOpen ? <TouchableOpacity accessibilityRole="button"
        accessibilityLabel="Close chat details"
        onPress={() => setDetailsOpen(false)} style={styles.details}>
        <Text style={styles.detailsText}>
          MeshCore channel #{scope.channelIndex}. No authenticated member list or
          channel settings editor is connected. Use the existing carrier tools
          to manage channels; this screen never exposes a channel PSK.
        </Text>
      </TouchableOpacity> : null}
      {!connected || !canSubmit ? (
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>{reason}</Text>
        </View>
      ) : null}
      <FlatList
        ref={listRef}
        accessibilityLabel="Chat message history"
        style={styles.messages}
        contentContainerStyle={styles.messageContent}
        keyboardShouldPersistTaps="handled"
        inverted
        data={descending}
        keyExtractor={entry => entry.message.id}
        onScroll={onListScroll}
        scrollEventThrottle={120}
        maintainVisibleContentPosition={{minIndexForVisible: 0}}
        onContentSizeChange={() => {
          if (nearBottom.current) {
            listRef.current?.scrollToOffset({offset: 0, animated: false});
          }
        }}
        renderItem={({item, index}) => {
          const older = descending[index + 1];
          const firstInDay = !older ||
            dateLabel(older.message.createdAt) !== dateLabel(item.message.createdAt);
          return (
            <View>
              <Bubble entry={item} />
              {firstInDay ? (
                <View style={styles.dateWrap}>
                  <Text style={styles.dateText}>{dateLabel(item.message.createdAt)}</Text>
                </View>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>◌</Text>
            <Text style={styles.emptyTitle}>No attributed messages yet</Text>
            <Text style={styles.emptyBody}>
              Only messages with a proven radio/channel scope, or messages
              observed in this mounted session, appear here. Older unscoped
              messages remain protected in Radio History.
            </Text>
          </View>
        }
      />
      <View style={styles.composerArea}>
        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
        <View style={styles.composerRow}>
          <TextInput
            accessibilityLabel="Carrier message draft"
            multiline
            placeholder={connected ? 'Message…' : 'Connect radio to send'}
            placeholderTextColor={colors.textSecondary}
            value={draft}
            onChangeText={onDraft}
            editable={!isSubmitting}
            maxLength={512}
            style={styles.input}
            textAlignVertical="center"
          />
          <TouchableOpacity accessibilityRole="button"
            accessibilityLabel="Submit channel text to radio"
            accessibilityState={{disabled: !sendEnabled}}
            disabled={!sendEnabled}
            onPress={onSend}
            style={[styles.sendButton, !sendEnabled && styles.sendDisabled]}>
            <Text style={styles.sendIcon}>{isSubmitting ? '…' : '➤'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.byteCounter, !validation.valid && draft.trim() &&
          styles.overLimit]}>
          {validation.bytes}/133 UTF-8 bytes
          {draft.trim() && !validation.valid ? ' · Too long to send' : ''}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  header: {minHeight: 67, flexDirection: 'row', alignItems: 'center',
    paddingLeft: 6, paddingRight: 10, backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border},
  backButton: {width: 48, minHeight: 56, justifyContent: 'center', alignItems: 'center'},
  backIcon: {color: colors.accent, fontSize: 39, lineHeight: 48},
  avatar: {width: 42, height: 42, borderRadius: 16, backgroundColor: '#29382E',
    justifyContent: 'center', alignItems: 'center'},
  avatarText: {color: colors.accent, fontSize: 23, fontWeight: '900'},
  headerCopy: {flex: 1, marginLeft: 10},
  title: {color: colors.textPrimary, fontSize: 18, fontWeight: '900'},
  subtitle: {color: colors.success, fontSize: 11, marginTop: 2},
  offline: {color: colors.warning},
  more: {width: 48, minHeight: 56, alignItems: 'center', justifyContent: 'center'},
  moreText: {color: colors.textPrimary, fontSize: 29},
  menu: {padding: 9, backgroundColor: colors.surfaceSoft, gap: 5},
  menuButton: {minHeight: 48, paddingHorizontal: 13, justifyContent: 'center'},
  menuText: {color: colors.textPrimary, fontSize: 14},
  details: {padding: 12, backgroundColor: colors.surfaceSoft},
  detailsText: {fontSize: 13, lineHeight: 19, color: colors.textSecondary},
  statusBar: {backgroundColor: colors.surfaceSoft, paddingHorizontal: 16,
    paddingVertical: 7},
  statusText: {color: colors.warning, fontSize: 12, lineHeight: 18},
  messages: {flex: 1},
  messageContent: {flexGrow: 1, paddingHorizontal: 11, paddingVertical: 12},
  bubbleWrap: {flexDirection: 'row', justifyContent: 'flex-start', marginVertical: 4,
    paddingRight: 40},
  outgoingWrap: {justifyContent: 'flex-end', paddingRight: 0, paddingLeft: 40},
  bubble: {maxWidth: '96%', minWidth: 100, paddingVertical: 9, paddingHorizontal: 12,
    borderRadius: 17},
  incomingBubble: {backgroundColor: colors.surfaceSoft, borderTopLeftRadius: 5},
  outgoingBubble: {backgroundColor: '#304820', borderTopRightRadius: 5},
  sender: {fontSize: 11, color: colors.accent, fontWeight: '800', marginBottom: 4},
  message: {color: colors.textPrimary, fontSize: 16, lineHeight: 23},
  outgoingMessage: {color: colors.textPrimary},
  bubbleFooter: {flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4},
  time: {color: colors.textSecondary, fontSize: 11},
  outgoingTime: {color: '#C0D6B7'},
  delivery: {color: '#C0D6B7', fontSize: 11, marginTop: 3, textAlign: 'right'},
  failed: {color: colors.warning},
  dateWrap: {alignItems: 'center', paddingVertical: 11},
  dateText: {color: colors.textSecondary, fontSize: 11,
    backgroundColor: colors.surface, paddingHorizontal: 13, paddingVertical: 6,
    borderRadius: 13, overflow: 'hidden'},
  empty: {padding: 26, alignItems: 'center'},
  emptyIcon: {color: colors.accent, fontSize: 34},
  emptyTitle: {color: colors.textPrimary, fontSize: 16, fontWeight: '900', marginTop: 9},
  emptyBody: {color: colors.textSecondary, fontSize: 13, lineHeight: 19,
    textAlign: 'center', marginTop: 7},
  composerArea: {paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6,
    borderTopColor: colors.border, borderTopWidth: 1,
    backgroundColor: colors.surface},
  composerRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 8},
  input: {flex: 1, minHeight: 50, maxHeight: 126, borderRadius: 22,
    paddingHorizontal: 15, paddingVertical: 8, color: colors.textPrimary,
    backgroundColor: colors.surfaceSoft, fontSize: 16},
  sendButton: {width: 54, height: 54, borderRadius: 20,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center'},
  sendDisabled: {opacity: 0.35},
  sendIcon: {fontSize: 21, color: colors.background, fontWeight: '900'},
  byteCounter: {color: colors.textSecondary, fontSize: 11,
    alignSelf: 'flex-end', marginRight: 67, marginTop: 4},
  overLimit: {color: colors.warning},
  notice: {color: colors.warning, fontSize: 12, lineHeight: 19, marginBottom: 8},
});
