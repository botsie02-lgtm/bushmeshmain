import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, BackHandler, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ChatManagementDialog, type ChatManagementSelection} from '../radio/chatManagement/ChatManagementDialog';
import {useChatManagement, type ChatManagementController} from '../radio/chatManagement/useChatManagement';
import {defaultChatPreferences, type ChatConfiguration} from '../radio/chatManagement/chatPreferences';
import {ChatOperationError} from '../radio/chatManagement/chatInvitations';
import {meshCoreInboundInbox} from '../meshcore/meshcoreInboundInbox';
import {meshCoreInboundMessageId} from '../meshcore/meshcoreInboundIdentity';
import {
  classifyChannelSubmissionFailure, formatChannelSubmissionFailure,
} from '../meshcore/channelSendDiagnostics';
import {useViewedConversation} from '../app/activeContext/ViewedConversationContext';
import {
  type BushMeshChannel, useBushMesh,
} from '../state/BushMeshContext';
import {useRadioConnection} from '../state/RadioConnectionContext';
import {useRadioSession} from '../state/RadioSessionContext';
import {colors} from '../theme/colors';
import {deriveRadioPresentation} from './radioPresentation';
import {
  buildMessengerConversations, conversationKey, equalScope,
  quarantineCount, scopedMessages, validateCarrierText, validChannelIndex,
  type MessageOwnershipProof, type RadioConversationScope,
} from './radioMessenger/messengerModel';
import {RadioInbox} from './radioMessenger/RadioInbox';
import {RadioChatRoom} from './radioMessenger/RadioChatRoom';
import {RadioTechnicalDrawer} from './radioMessenger/RadioTechnicalDrawer';
import {RadioQuarantineReview} from './radioMessenger/RadioQuarantineReview';

export type RadioScreenProps = {
  enableChatManagement?: boolean;
  settingsVisible?: boolean;
  tabVisible?: boolean;
  /** Existing carrier/legacy channel tools; no provisioning is performed here. */
  onOpenCarrierDetails?: () => void;
  /** Owned by the channel-management worker. If absent, fall back to carrier tools. */
  onCreateChat?: () => void;
  onJoinChat?: () => void;
  onOpenChatSettings?: (scope: RadioConversationScope) => void;
  onOpenConversationMenu?: (scope: RadioConversationScope) => void;
  onOpenMessagingSettings?: () => void;
  /**
   * Durable, non-secret radio ID and channel configuration generation from the
   * radio/history worker. Must be verified before use, not inferred from a
   * slot, channel name or PSK. Optional: default fails closed for old history.
   */
  trustedScopes?: readonly RadioConversationScope[];
  /** Individual message ID -> independently proven stable channel owner. */
  verifiedMessageOwnership?: Readonly<Record<string, MessageOwnershipProof>>;
  /** Optional genuine persisted unread counts, keyed by conversationKey. */
  unreadCounts?: Readonly<Record<string, number>>;
  onConversationRead?: (scope: RadioConversationScope, messageId: string) => void;
};

type ChannelLabel = Pick<BushMeshChannel, 'channelIndex' | 'channelName'>;

const NO_PROOF: Readonly<Record<string, MessageOwnershipProof>> = {};
const NO_UNREAD: Readonly<Record<string, number>> = {};

function eligible(channel: ChannelLabel): boolean {
  return validChannelIndex(channel.channelIndex) &&
    !!channel.channelName.trim() && channel.channelName !== 'Empty';
}

export function RadioScreen(props: RadioScreenProps = {}): React.JSX.Element {
  return props.enableChatManagement
    ? <ManagedRadioScreen {...props} />
    : <RadioMessenger {...props} />;
}

function ManagedRadioScreen(props: RadioScreenProps): React.JSX.Element {
  const management = useChatManagement();
  const attempted = useRef<string | null>(null);
  const {radio, sessionEpoch, radioBusy, busy, refresh} = management;
  useEffect(() => {
    if (!radio) {
      attempted.current = null;
      return;
    }
    const key = JSON.stringify([radio, sessionEpoch]);
    if (busy || radioBusy || attempted.current === key) return;
    attempted.current = key;
    refresh().catch(() => undefined);
  }, [radio, sessionEpoch, radioBusy, busy, refresh]);
  return <RadioMessenger {...props} management={management} />;
}

function RadioMessenger({
  onOpenCarrierDetails, onCreateChat, onJoinChat,
  onOpenChatSettings, onOpenConversationMenu, onOpenMessagingSettings,
  trustedScopes = [], verifiedMessageOwnership = NO_PROOF,
  unreadCounts = NO_UNREAD, onConversationRead, management, settingsVisible, tabVisible = true,
}: RadioScreenProps & {management?: ChatManagementController}): React.JSX.Element {
  const {
    connectionStatus, connectedDeviceName, channels, channelMessages,
    messagePersistenceStatus, messagePersistenceError,
    canSendChannelMessage, sendChannelMessage, addLocalChannelMessage, addDurableChannelMessage, finishDurableSubmission,
  } = useBushMesh();
  const {snapshot: radioSession} = useRadioSession();
  const radioConnection = useRadioConnection();
  const {snapshot: connection} = radioConnection;
  const {viewedConversation, setViewedConversation} = useViewedConversation();

  const connected = connectionStatus === 'Connected';
  const radioId = management ? (connected ? management.radio : null)
    : connected && connection.connectedDeviceAddress?.trim()
      ? connection.connectedDeviceAddress.trim() : null;
  const configurationKey = management?.ready
    ? JSON.stringify(management.chats.map(chat => [chat.id, management.preferences[chat.id]?.incarnation ?? 1]).sort()) : null;
  const [managementSelection, setManagementSelection] = useState<ChatManagementSelection | null>(null);
  const [archived, setArchived] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread' | 'pinned'>('all');
  useEffect(() => {if (!tabVisible) {setManagementSelection(null); setShowNew(false);}}, [tabVisible]);
  const [pendingChat, setPendingChat] = useState<ChatConfiguration | null>(null);
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());

  const [observedLabels, setObservedLabels] = useState<ChannelLabel[]>([]);
  const [sessionScopes, setSessionScopes] = useState<RadioConversationScope[]>([]);
  const [sessionOwnership, setSessionOwnership] = useState<
    Record<string, RadioConversationScope>
  >({});
  const generation = useRef(0);
  const lastBinding = useRef<{
    radioId: string | null; channels: readonly BushMeshChannel[] | null;
    connected: boolean; configurationKey: string | null; sessionEpoch: number | null;
  }>({radioId: null, channels: null, connected: false, configurationKey: null, sessionEpoch: null});
  const [search, setSearch] = useState('');
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [selectedScope, setSelectedScope] = useState<RadioConversationScope | null>(null);
  const lastNavigation = useRef<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [uncertain, setUncertain] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [showNew, setShowNew] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showUnattributed, setShowUnattributed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const baseline = useRef<Set<string> | null>(null);
  const historyReady = useRef(false);

  // A new radio connection or channel enumeration is a new ephemeral generation.
  // Do not store keys, derive a stable channel identity from names or slots,
  // or mutate the carrier selected for background location sharing.
  useEffect(() => {
    // A redacted snapshot cannot detect same-name key replacement. Only a
    // verified configuration set may bind integrated live rooms.
    if (management && connected && configurationKey === null) return;
    const previous = lastBinding.current;
    const epoch = management?.sessionEpoch ?? null;
    const changed = previous.radioId !== radioId || previous.sessionEpoch !== epoch ||
      (management ? previous.configurationKey !== configurationKey :
        lastBinding.current.channels !== channels) ||
      lastBinding.current.connected !== connected;
    if (!changed) return;
    lastBinding.current = {radioId, channels, connected, configurationKey, sessionEpoch: epoch};
    if (!radioId || !connected) return; // Retain this-session read-only rooms offline.
    generation.current += 1;
    const revision = 'session-' + generation.current;
    const labels = management
      ? management.chats.map(chat => ({channelIndex: String(chat.slot), channelName: chat.name}))
      : channels.filter(eligible).map(channel => ({
        channelIndex: channel.channelIndex, channelName: channel.channelName,
      }));
    setObservedLabels(labels);
    setSessionScopes(existing => labels.map(channel => {
      const chat = management?.chats.find(c => String(c.slot) === channel.channelIndex);
      // A write in another slot need not discard an unaffected draft/history.
      const retained = chat && previous.radioId === radioId && previous.connected &&
        previous.sessionEpoch === epoch && existing.find(s =>
          s.radioId === radioId && s.channelIndex === channel.channelIndex &&
          s.channelName === channel.channelName && s.channelGeneration === 'config:' + (management?.preferences[chat.id]?.incarnation ?? 1) + ':' + chat.id);
      return retained || {...channel, radioId, channelGeneration: chat ? 'config:' + (management?.preferences[chat.id]?.incarnation ?? 1) + ':' + chat.id : revision};
    }));
  }, [radioId, connected, channels, configurationKey, management]);

  // The legacy encrypted snapshot has no durable radio/channel incarnation.
  // Baseline loaded IDs are always quarantined. Only later arrivals that
  // appeared while this radio was connected and matching the known channel
  // can be displayed as explicitly ephemeral, "this-session" observations.
  useEffect(() => {
    const ids = new Set(channelMessages.map(message => message.id));
    const ready = messagePersistenceStatus === 'ready' ||
      messagePersistenceStatus === 'unsupported';
    if (!ready) {
      baseline.current = ids;
      historyReady.current = false;
      return;
    }
    if (!historyReady.current || !baseline.current) {
      baseline.current = ids;
      historyReady.current = true;
      return;
    }
    const old = baseline.current;
    baseline.current = ids;
    if (!connected || !radioId) return;
    // Integrated attribution comes from an actual inbox event, not the
    // arrival of a delayed or replayed row in the encrypted history snapshot.
    if (management) return;
    const observed: Record<string, RadioConversationScope> = {};
    for (const message of channelMessages) {
      if (old.has(message.id)) continue;
      const scope = sessionScopes.find(s =>
        s.radioId === radioId &&
        s.channelIndex === message.channelIndex &&
        s.channelName === message.channelName);
      if (!scope) continue;
      const age = Date.now() - Date.parse(message.createdAt);
      if (!Number.isFinite(age) || age < -10_000 || age > 120_000) continue;
      observed[message.id] = scope;
    }
    if (Object.keys(observed).length > 0) {
      setSessionOwnership(existing => ({...existing, ...observed}));
    }
  }, [channelMessages, connected, radioId, messagePersistenceStatus, sessionScopes, management]);

  const liveScopes = useMemo(() =>
    connected && radioId && (!management || (management.ready &&
      configurationKey === lastBinding.current.configurationKey &&
      management.sessionEpoch === lastBinding.current.sessionEpoch))
      ? sessionScopes.filter(s => s.radioId === radioId && (!management ||
        management.chats.some(chat => chat.radio === s.radioId &&
          s.channelGeneration === 'config:' + (management.preferences[chat.id]?.incarnation ?? 1) + ':' + chat.id))) : [],
  [connected, radioId, sessionScopes, management, configurationKey]);
  useEffect(() => {
    if (!management?.ready || !radioId || !connected) return;
    const epoch = management.sessionEpoch;
    return meshCoreInboundInbox.subscribeObserved(envelope => {
      // Real firmware queue events carry an explicit ambiguity marker. Never
      // attach them to a currently configured chat as if original generation were known.
      if (envelope.observation?.origin === 'queued-generation-unknown') return;
      if (!historyReady.current || !radioConnection.isChatObservationCurrent(radioId, epoch)) return;
      const id = meshCoreInboundMessageId(envelope.message);
      if (baseline.current?.has(id)) return; // Never reassign a persisted duplicate.
      const scope = liveScopes.find(s => s.channelIndex === envelope.message.channelIndex);
      if (!scope) return;
      setSessionOwnership(existing => existing[id] ? existing : {...existing, [id]: scope});
    });
  }, [management, radioId, connected, radioConnection, liveScopes]);
  const chatFor = (scope: RadioConversationScope) => management?.chats.find(chat =>
    liveScopes.some(live => equalScope(live, scope)) && chat.radio === scope.radioId &&
    String(chat.slot) === scope.channelIndex && chat.name === scope.channelName &&
    scope.channelGeneration.endsWith(':' + chat.id));
  const preferencesFor = (scope: RadioConversationScope) => {
    const id = scope.channelGeneration.startsWith('config:') ? scope.channelGeneration.split(':').pop() : chatFor(scope)?.id;
    const prefs = id ? management?.preferences[id] : undefined;
    // Earlier incarnations must not inherit current draft/read state.
    if (prefs && scope.channelGeneration.startsWith('config:') && scope.channelGeneration !== 'config:' + (prefs.incarnation ?? 1) + ':' + id) return undefined;
    return id ? prefs ?? defaultChatPreferences : undefined;
  };
  useEffect(() => {
    if (!pendingChat) return;
    const scope = liveScopes.find(s => s.radioId === pendingChat.radio &&
      s.channelGeneration.endsWith(':' + pendingChat.id));
    if (!scope) return;
    setPendingChat(null);
    setSelectedScope(scope);
    lastNavigation.current = scope.channelIndex;
    setViewedConversation({kind: 'meshcore-channel', channelIndex: scope.channelIndex});
  }, [pendingChat, liveScopes, setViewedConversation]);
  const durableScopes = management ? channelMessages.flatMap(m => m.conversation ? [m.conversation] : []) : [];
  const persistedOwnership = useMemo(() => ({...verifiedMessageOwnership,
    ...Object.fromEntries(channelMessages.flatMap(m => m.conversation ? [[m.id, m.conversation]] : [])),
  }), [verifiedMessageOwnership, channelMessages]);
  const knownScopes = [...liveScopes];
  for (const pref of Object.values(management?.preferences ?? {})) {
    const c = pref.configuration;
    if (!c) continue;
    const scope = {radioId: c.radio, channelGeneration: 'config:' + (pref.incarnation ?? 1) + ':' + c.id,
      channelIndex: String(c.slot), channelName: c.name};
    if (!knownScopes.some(s => equalScope(scope, s))) knownScopes.push(scope);
  }
  for (const scope of durableScopes) {
    if (!knownScopes.some(s => equalScope(scope, s))) knownScopes.push(scope);
  }
  for (const scope of trustedScopes) {
    if (!knownScopes.some(s => equalScope(scope, s))) knownScopes.push(scope);
  }
  // In this mounted session, offline previously-seen rooms are read-only.
  if (!connected || (management && !management.ready)) {
    for (const scope of sessionScopes) {
      if (!knownScopes.some(s => equalScope(scope, s))) knownScopes.push(scope);
    }
  }
  // Inbox metadata is only slot/name; never copy channel secrets into UI
  // presentation state. Trusted archived rooms stay visible while connected
  // even when their earlier radio used the same slot with another name.
  const availableLabels: ChannelLabel[] = connected && radioId && (!management || management.ready)
    ? channels.map(c => ({channelIndex: c.channelIndex, channelName: c.channelName}))
    : [...observedLabels];
  for (const scope of knownScopes) {
    if (!availableLabels.some(c => c.channelIndex === scope.channelIndex &&
      c.channelName === scope.channelName)) {
      availableLabels.push({channelIndex: scope.channelIndex, channelName: scope.channelName});
    }
  }
  const inboxChannels: BushMeshChannel[] = availableLabels.map(c => ({
    ...c, secret: '',
  }));

  const allConversations = buildMessengerConversations({
    channels: inboxChannels, scopes: knownScopes, messages: channelMessages,
    verifiedOwnership: persistedOwnership,
    sessionOwnership, pinned, unread: unreadCounts,
  });
  const needle = search.trim().toLocaleLowerCase();
  const conversations = allConversations.map(c => {
    const prefs = preferencesFor(c.scope);
    return {...c, verifiedNow: liveScopes.some(scope => equalScope(scope, c.scope)), pinned: prefs?.pinned ?? c.pinned,
      displayName: prefs?.displayName || c.channel.channelName,
      personalisation: prefs, manualUnread: prefs?.unread,
      unreadCount: management ? (c.messages.length ? c.messages.filter(m =>
        m.message.direction === 'received' && !readIds.has(m.message.id) && !prefs?.readIds?.includes(m.message.id)).length : null) : c.unreadCount};
  }).filter(c => (!management || !!preferencesFor(c.scope)?.archived === archived) &&
    (filter === 'all' || (filter === 'pinned' ? c.pinned : !!c.manualUnread || !!c.unreadCount)) &&
    (!needle || c.displayName.toLocaleLowerCase().includes(needle) ||
      c.channel.channelName.toLocaleLowerCase().includes(needle) ||
      c.messages.some(m => m.message.text.toLocaleLowerCase().includes(needle))))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) ||
      (management?.sort === 'name' ? a.displayName.localeCompare(b.displayName) :
        management?.sort === 'slot' ? Number(a.channel.channelIndex) - Number(b.channel.channelIndex) :
        management?.sort === 'unread' ? Number(!!b.manualUnread || !!b.unreadCount) - Number(!!a.manualUnread || !!a.unreadCount) :
        0) || (b.activityMs ?? -1) - (a.activityMs ?? -1));
  const ownedIds = new Set(allConversations.flatMap(c => c.messages.map(m => m.message.id)));
  const unknownCount = quarantineCount(channelMessages, ownedIds);

  // View selection is navigation only. An external channel-index request can
  // open the currently observed room, never rewrite the actual carrier.
  useEffect(() => {
    const navigation = viewedConversation?.kind === 'meshcore-channel'
      ? viewedConversation.channelIndex : null;
    if (navigation === lastNavigation.current) return;
    if (navigation === null) {
      lastNavigation.current = null;
      setSelectedScope(null);
      return;
    }
    const scope = liveScopes.find(s => s.channelIndex === navigation) ??
      trustedScopes.find(s => s.channelIndex === navigation) ?? null;
    if (!scope) return;
    lastNavigation.current = navigation;
    setSelectedScope(scope);
  }, [viewedConversation, liveScopes, trustedScopes]);

  const activeKey = selectedScope ? conversationKey(selectedScope) : null;
  const activeDraft = activeKey ? drafts[activeKey] ?? (selectedScope ? preferencesFor(selectedScope)?.draft : '') ?? '' : '';
  const localPreference = selectedScope ? preferencesFor(selectedScope) : undefined;
  const localId = selectedScope?.channelGeneration.startsWith('config:') ? selectedScope.channelGeneration.split(':').pop() : undefined;
  const localIncarnation = localPreference?.incarnation ?? 1;
  const activeNotice = activeKey ? notices[activeKey] ?? null : null;
  const selectedMessages = useMemo(() => selectedScope
    ? scopedMessages(channelMessages, selectedScope,
      persistedOwnership, sessionOwnership) : [],
    [channelMessages, selectedScope, persistedOwnership, sessionOwnership]);

  useEffect(() => {
    if (!management || !selectedScope || !selectedMessages.length || settingsVisible || managementSelection || !tabVisible) return;
    const receivedIds = selectedMessages.filter(item => item.message.direction === 'received').map(item => item.message.id);
    if (localId && localPreference && receivedIds.some(id => !readIds.has(id) && !localPreference.readIds?.includes(id))) {
      management.updateLocal(localId, {readIds: [...new Set([...(localPreference.readIds ?? []), ...receivedIds])]}, localIncarnation).catch(() => undefined);
    }
    setReadIds(previous => {
      const next = new Set(previous);
      for (const item of selectedMessages) next.add(item.message.id);
      return next.size === previous.size ? previous : next;
    });
  }, [selectedScope, selectedMessages, management, settingsVisible, managementSelection, tabVisible, localId, localPreference, localIncarnation, readIds]);
  const currentChannel = selectedScope && radioId === selectedScope.radioId && connected
    ? channels.find(c => c.channelIndex === selectedScope.channelIndex &&
      c.channelName === selectedScope.channelName) ?? null : null;
  const boundNow = !!currentChannel && liveScopes.some(s => equalScope(s, selectedScope));
  const presentation = deriveRadioPresentation({
    connected: connected && !!radioId && boundNow,
    canSendChannelMessage,
    channelIndex: boundNow ? selectedScope?.channelIndex ?? null : null,
    channelName: boundNow ? selectedScope?.channelName ?? null : null,
    protocolTransportReady: radioSession.transportReady,
  });
  const pendingInterrupted = selectedMessages.some(m => m.message.direction === 'sent' && m.message.status === 'pending');
  const canSubmit = !pendingInterrupted && boundNow && (!management || (!!selectedScope && !!chatFor(selectedScope) &&
    !management.busy && !management.radioBusy)) && presentation.maySubmitCarrierText &&
    !sending && (activeKey === null || !uncertain.has(activeKey));
  const unavailableReason = !connected
    ? 'Radio disconnected. Proven history is readable; sending is unavailable.'
    : !radioId ? 'A stable connected radio address is unavailable. Cannot safely address this chat.'
      : !boundNow ? 'Channel configuration or radio identity changed. Return to Chats and reopen it.'
        : pendingInterrupted ? 'An interrupted submission remains unresolved. Check saved history; sending is paused.'
        : activeKey && uncertain.has(activeKey)
          ? 'Prior submission acceptance is uncertain. Review before choosing to send again.'
          : presentation.explanation;

  const openRoom = (scope: RadioConversationScope) => {
    setSelectedScope(scope);
    lastNavigation.current = scope.channelIndex;
    setViewedConversation({kind: 'meshcore-channel', channelIndex: scope.channelIndex});
    const prefs = preferencesFor(scope);
    const id = scope.channelGeneration.startsWith('config:') ? scope.channelGeneration.split(':').pop() : undefined;
    if (id && prefs?.unread && management) management.updateLocal(id, {unread: false}, prefs.incarnation ?? 1).catch(() => undefined);
    const key = conversationKey(scope);
    const count = unreadCounts[key];
    if (onConversationRead && Number.isSafeInteger(count) && count > 0) {
      const mostRecent = scopedMessages(channelMessages, scope,
        persistedOwnership, sessionOwnership).slice(-1)[0];
      if (mostRecent) onConversationRead(scope, mostRecent.message.id);
    }
  };
  const closeRoom = () => {
    setSelectedScope(null);
    lastNavigation.current = null;
    setViewedConversation(null);
  };
  useEffect(() => {
    if (!tabVisible || settingsVisible || managementSelection || !selectedScope) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedScope(null);
      lastNavigation.current = null;
      setViewedConversation(null);
      return true;
    });
    return () => subscription.remove();
  }, [tabVisible, settingsVisible, managementSelection, selectedScope, setViewedConversation]);
  const openChatManagement = (scope: RadioConversationScope) => {
    const live = chatFor(scope);
    const prefs = preferencesFor(scope);
    const chat = live ?? prefs?.configuration;
    if (chat && management && tabVisible) {
      setManagementSelection({kind: 'settings', chat, incarnation: prefs?.incarnation ?? 1});
    } else {
      Alert.alert('Chat unavailable', 'Connect the original radio and refresh chats before changing this configuration.');
    }
  };
  const togglePinned = (scope: RadioConversationScope) => {
    if (management) {
      const prefs = preferencesFor(scope);
      const id = scope.channelGeneration.startsWith('config:') ? scope.channelGeneration.split(':').pop() : undefined;
      if (id && prefs) management.updateLocal(id, {pinned: !prefs.pinned}, prefs.incarnation ?? 1).catch(() => Alert.alert('Could not save', 'Local pin preference was not saved.'));
      else Alert.alert('Chat unavailable', 'This earlier conversation incarnation does not have editable preferences.');
      return;
    }
    const key = conversationKey(scope);
    setPinned(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const updateDraft = (value: string) => {
    if (!activeKey) return;
    setDrafts(current => ({...current, [activeKey]: value}));
    if (localId && localPreference && management) management.updateLocal(localId, {draft: value}, localIncarnation).catch(() => postNotice(activeKey, 'Draft could not be saved on this phone.'));
  };
  const postNotice = (key: string, value: string) => {
    setNotices(current => ({...current, [key]: value}));
  };

  const submit = async () => {
    if (!selectedScope || !activeKey || sendingRef.current || !canSubmit) return;
    const validation = validateCarrierText(activeDraft);
    if (!validation.valid) {
      postNotice(activeKey, validation.issue ?? 'Message not ready.');
      return;
    }
    // Revalidation against current enumerated slot, name and actual radio
    // identity is mandatory. Never select a carrier or switch the convoy.
    const current = channels.find(c => c.channelIndex === selectedScope.channelIndex &&
      c.channelName === selectedScope.channelName);
    if (!connected || !radioId || radioId !== selectedScope.radioId ||
      !current || !liveScopes.some(s => equalScope(s, selectedScope)) ||
      !canSendChannelMessage || !validChannelIndex(selectedScope.channelIndex)) {
      postNotice(activeKey, 'Chat binding changed. Message was not submitted.');
      return;
    }
    const capturedScope = selectedScope;
    const verifiedChat = chatFor(capturedScope);
    if (management && !verifiedChat) {
      postNotice(activeKey, 'Refresh the verified chat before sending.');
      return;
    }
    const capturedKey = activeKey;
    const submittedText = validation.text;
    let durableId: string | null = null;
    const durable = !!verifiedChat && !!addDurableChannelMessage && !!finishDurableSubmission;
    const beforeSubmit = async () => {
      const id = 'submission-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      const inserted = await addDurableChannelMessage({id, createdAt: new Date().toISOString(), channelIndex: capturedScope.channelIndex,
        channelName: capturedScope.channelName, text: submittedText, direction: 'sent', status: 'pending',
        conversation: {...capturedScope, version: 1, provenance: 'local-submission'}});
      if (!inserted) throw new Error('Submission journal was not saved.');
      durableId = id;
    };
    const recordSubmission = async (status: 'accepted' | 'failed', submissionFailure?: ReturnType<typeof classifyChannelSubmissionFailure>) => {
      const record = {channelIndex: capturedScope.channelIndex, channelName: capturedScope.channelName,
        text: submittedText, direction: 'sent' as const, status, ...(submissionFailure ? {submissionFailure} : {})};
      if (durable) {
        if (!durableId) throw new Error('No durable submission journal exists.');
        await finishDurableSubmission(durableId, {status, ...(submissionFailure ? {submissionFailure} : {})});
      } else {
        const id = addLocalChannelMessage(record);
        if (management && id) setSessionOwnership(current => ({...current, [id]: capturedScope}));
      }
    };
    sendingRef.current = true;
    setSending(true);
    postNotice(capturedKey, 'Submitting to the current radio…');
    try {
      // Only the owning service issues the command. A resolved promise proves
      // PACKET_OK acceptance, never a peer acknowledgement.
      if (verifiedChat && durable) await radioConnection.sendVerifiedChat(verifiedChat, submittedText, beforeSubmit);
      else if (verifiedChat) await radioConnection.sendVerifiedChat(verifiedChat, submittedText);
      else await sendChannelMessage(Number(capturedScope.channelIndex), submittedText);
      // Radio accepted; a separate local history failure must not turn this
      // into a fabricated radio rejection or trigger another transmission.
      let recorded = true;
      try {
        await recordSubmission('accepted');
      } catch {
        recorded = false;
      }
      setDrafts(currentDrafts => ({
        ...currentDrafts,
        [capturedKey]: currentDrafts[capturedKey]?.trim() === submittedText
          ? '' : currentDrafts[capturedKey] ?? '',
      }));
      if (verifiedChat && management && recorded) management.updateLocal(verifiedChat.id, {draft: ''}, Number(capturedScope.channelGeneration.split(':')[1])).catch(() => postNotice(capturedKey, 'Radio accepted; saved draft could not be cleared. Do not resend.'));
      postNotice(capturedKey, recorded
        ? 'Radio accepted. No peer delivery confirmation.'
        : 'Radio accepted, but local history recording failed. Do not resend to repair history.');
    } catch (error) {
      if (management) management.invalidate();
      if (error instanceof ChatOperationError && error.code === 'stale') {
        if (durableId) {
          try {await finishDurableSubmission(durableId, {status: 'failed', submissionNotAttempted: true});}
          catch {postNotice(capturedKey, 'No message submitted; pending history outcome could not be saved.'); return;}
        }
        postNotice(capturedKey, error.message);
        return; // No command was submitted, no uncertain delivery record.
      }
      const failure = classifyChannelSubmissionFailure(error);
      let recorded = true;
      try {
        await recordSubmission('failed', failure);
      } catch {
        recorded = false;
      }
      const couldHaveSent = failure.reason !== 'firmware-error';
      if (couldHaveSent) setUncertain(currentSet => new Set(currentSet).add(capturedKey));
      postNotice(capturedKey, formatChannelSubmissionFailure(failure) +
        (recorded ? '' : ' Local history could not record this outcome.'));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const openSettings = () => {
    if (onOpenMessagingSettings) onOpenMessagingSettings();
    else setSettingsOpen(true);
  };
  const provision = (action: 'create' | 'join') => {
    setShowNew(false);
    const callback = action === 'create' ? onCreateChat : onJoinChat;
    if (management) {
      if (!management.radio) {
        Alert.alert('Connect a radio', 'Connect and sync your MeshCore companion before creating or joining a chat.');
        return;
      }
      setManagementSelection({kind: action, radio: management.radio});
      if (!management.ready && !management.busy && !management.radioBusy) management.refresh().catch(() => undefined);
    } else if (callback) callback();
    else if (onOpenCarrierDetails) onOpenCarrierDetails();
    else setSettingsOpen(true);
  };
  const isRestoring = messagePersistenceStatus === 'restoring';
  const dialog = management && tabVisible ? <ChatManagementDialog controller={management}
    selection={managementSelection} onClose={() => setManagementSelection(null)}
    onProvisioned={setPendingChat}
    onLeft={chat => {
      if (selectedScope?.channelGeneration.endsWith(':' + chat.id) &&
          selectedScope.radioId === chat.radio) closeRoom();
    }} /> : null;

  if (showUnattributed) {
    return <RadioQuarantineReview
      messages={channelMessages.filter(message => !ownedIds.has(message.id))}
      onBack={() => setShowUnattributed(false)} />;
  }

  if (showDiagnostics) return <RadioTechnicalDrawer
    onClose={() => setShowDiagnostics(false)} />;

  if (settingsOpen) {
    return (
      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <Text style={styles.panelTitle}>Messaging settings</Text>
          <TouchableOpacity accessibilityRole="button"
            accessibilityLabel="Back to messaging"
            onPress={() => setSettingsOpen(false)} style={styles.panelAction}>
            <Text style={styles.actionText}>Done</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.panelCopy}>
          Message transport is owned by MeshCore. No automatic retries,
          verified convoy membership or channel provisioning occurs here.
          Legacy Radio History is encrypted but lacks durable radio/channel
          incarnation metadata, so ambiguous messages stay quarantined.
        </Text>
        <TouchableOpacity accessibilityRole="button"
          accessibilityLabel="Show radio technical diagnostics"
          onPress={() => {setShowDiagnostics(true); setSettingsOpen(false);}}
          style={styles.panelAction}>
          <Text style={styles.actionText}>Technical diagnostics</Text>
        </TouchableOpacity>
        {onOpenCarrierDetails ? <TouchableOpacity accessibilityRole="button"
          accessibilityLabel="Open carrier management"
          onPress={onOpenCarrierDetails} style={styles.panelAction}>
          <Text style={styles.actionText}>Manage MeshCore channels</Text>
        </TouchableOpacity> : null}
      </View>
    );
  }

  if (selectedScope) {
    const warned = !!activeKey && uncertain.has(activeKey);
    return (
      <View style={styles.root}>
        <RadioChatRoom
          scope={selectedScope} messages={selectedMessages}
          connected={connected && radioId === selectedScope.radioId}
          visible={tabVisible && !settingsVisible && !managementSelection}
          quickMessages={localPreference?.quickMessages}
          onSaveQuickMessages={management && localId && localPreference ? templates => management.updateLocal(localId, {quickMessages: templates}, localIncarnation).catch(() => Alert.alert('Could not save', 'Quick messages were not saved.')) : undefined}
          starredIds={localPreference?.starredIds}
          pinnedIds={localPreference?.pinnedIds}
          onMessagePreference={management && localId && localPreference ? (id, kind) => {
            const existing = localPreference[kind] ?? [];
            management.updateLocal(localId, {[kind]: existing.includes(id) ? existing.filter(v => v !== id) : [...existing, id]}, localIncarnation).catch(() => postNotice(activeKey ?? '', 'Message preference could not be saved.'));
          } : undefined}
          canSubmit={canSubmit} reason={unavailableReason}
          draft={activeDraft} notice={activeNotice}
          isSubmitting={sending} onDraft={updateDraft}
          onSend={() => {submit().catch(() => undefined);}}
          onBack={closeRoom}
          onOpenSettings={management ? openChatManagement : onOpenChatSettings}
          onOpenMenu={management ? undefined : onOpenConversationMenu}
          persistentPin={!!management}
          personalisation={preferencesFor(selectedScope)}
          displayName={preferencesFor(selectedScope)?.displayName}
          pinned={preferencesFor(selectedScope)?.pinned ?? (!!activeKey && pinned.has(activeKey))}
          onTogglePinned={() => togglePinned(selectedScope)}
          observedCount={localId ? channelMessages.filter(m => m.observation?.configurationId === localId && m.observation?.radio === selectedScope.radioId && !m.conversation).length : 0}
          onReviewObserved={() => setShowUnattributed(true)}
        />
        {management && (messagePersistenceStatus === 'error' || messagePersistenceError) ?
          <Text style={styles.uncertainText}>Radio History storage needs attention. Check Messaging Settings.</Text> : null}
        {management && !management.ready && management.radio ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh verified chats"
            style={styles.panelAction} disabled={management.busy || management.radioBusy}
            onPress={() => management.refresh().catch(() => undefined)}>
            <Text style={styles.actionText}>Refresh verified chats</Text>
          </TouchableOpacity>
        ) : null}
        {dialog}
        {pendingInterrupted && !sending && management && finishDurableSubmission ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Resolve interrupted submission locally" style={styles.uncertainButton} onPress={() => {
          Alert.alert('Keep outcome unknown?', 'These messages may have transmitted. This only records the unknown outcome and unlocks the composer; it does not resend anything.', [
            {text: 'Cancel', style: 'cancel'}, {text: 'Keep unknown', onPress: () => {
              Promise.all(selectedMessages.filter(m => m.message.direction === 'sent' && m.message.status === 'pending').map(m => finishDurableSubmission(m.message.id, {status: 'failed', submissionFailure: {reason: 'unknown'}}))).catch(() => Alert.alert('Storage error', 'The unresolved submission remains in history.'));
            }},
          ]);
        }}><Text style={styles.uncertainText}>Review interrupted submission</Text></TouchableOpacity> : null}
        {warned ? (
          <TouchableOpacity accessibilityRole="button"
            accessibilityLabel="Acknowledge uncertain radio submission"
            style={styles.uncertainButton}
            onPress={() => {
              if (!activeKey) return;
              setUncertain(current => {
                const next = new Set(current); next.delete(activeKey); return next;
              });
              postNotice(activeKey,
                'Manual retry enabled. The previous packet may have transmitted; check the radio first.');
            }}>
            <Text style={styles.uncertainText}>I understand the duplicate-send risk</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {management?.error ? <Text style={styles.uncertainText}>{management.error}</Text> : null}
      <RadioInbox
        conversations={conversations}
        managed={!!management}
        visible={tabVisible && !settingsVisible}
        filter={archived ? 'archived' : filter}
        onFilter={next => {setArchived(next === 'archived'); setFilter(next === 'archived' ? 'all' : next);}}
        onRefresh={management?.radio && !management.radioBusy ? () => management.refresh().catch(() => undefined) : undefined}
        refreshing={management?.busy ?? false}
        online={connected} radioLabel={connectedDeviceName}
        restoring={isRestoring}
        historyIssue={messagePersistenceStatus === 'error'
          ? 'Encrypted history could not be restored; inspect device diagnostics.'
          : messagePersistenceStatus === 'unsupported'
            ? 'Encrypted history storage is unavailable in this environment.'
            : messagePersistenceError ? 'History storage reported a recovery event.' : null}
        unknownHistoryCount={unknownCount}
        search={search} onSearch={setSearch}
        onOpen={openRoom} onPin={togglePinned}
        onNewChat={() => setShowNew(v => !v)}
        onSettings={openSettings}
        onReviewUnattributed={() => setShowUnattributed(true)}
        onOpenRowMenu={management ? undefined : onOpenConversationMenu}
        onOpenChatSettings={management ? openChatManagement : onOpenChatSettings}
      />
      {showNew ? (
        <View style={styles.newMenu}>
          <Text style={styles.newTitle}>Start a channel chat</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Create channel"
            onPress={() => provision('create')} style={styles.panelAction}>
            <Text style={styles.actionText}>＋ Create a channel</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Join channel"
            onPress={() => provision('join')} style={styles.panelAction}>
            <Text style={styles.actionText}>↳ Join a channel</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel new chat"
            onPress={() => setShowNew(false)} style={styles.panelAction}>
            <Text style={styles.actionText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.panelCopy}>
            {management ? 'Create or join a private channel using verified radio provisioning.' :
              'Channel creation and joining are managed by the existing carrier setup tools.'}
          </Text>
        </View>
      ) : null}
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  managementBar: {flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16,
    paddingVertical: 8, backgroundColor: colors.surfaceSoft},
  panel: {flex: 1, backgroundColor: colors.background, padding: 18, gap: 14},
  panelHead: {minHeight: 64, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between'},
  panelTitle: {color: colors.textPrimary, fontSize: 22, fontWeight: '900'},
  panelCopy: {color: colors.textSecondary, fontSize: 14, lineHeight: 21},
  panelAction: {minHeight: 52, paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: colors.surfaceSoft, justifyContent: 'center'},
  actionText: {color: colors.textPrimary, fontSize: 14, fontWeight: '800'},
  newMenu: {position: 'absolute', left: 12, right: 12, top: 78,
    padding: 15, borderRadius: 18, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, gap: 8},
  newTitle: {color: colors.textPrimary, fontSize: 18, fontWeight: '800'},
  uncertainButton: {marginHorizontal: 12, marginBottom: 8,
    minHeight: 54, borderRadius: 12, borderWidth: 1,
    borderColor: colors.warning, alignItems: 'center', justifyContent: 'center'},
  uncertainText: {color: colors.warning, fontSize: 13, fontWeight: '800'},
});
