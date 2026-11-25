import React, {useEffect, useRef, useState} from 'react';
import {
  Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, Share,
  StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors} from '../../theme/colors';
import {ChatAvatar, ChatAvatarPicker} from './ChatAvatar';
import {
  ChatConfiguration, ChatPersonalisation, chatRole, defaultChatPreferences,
} from './chatPreferences';
import {decodeChatInvite, encodeChatInvite, validateChatInvite, validateChatName} from './chatInvitations';
import {ChatManagementController} from './useChatManagement';

export type ChatManagementSelection =
  | {kind: 'create' | 'join'; radio: string}
  | {kind: 'settings'; chat: ChatConfiguration};

export type ChatManagementDialogProps = {
  selection: ChatManagementSelection | null;
  controller: ChatManagementController;
  onClose: () => void;
  /** Navigation only: do not change the active BushMesh carrier. */
  onProvisioned?: (chat: ChatConfiguration) => void;
  onLeft?: (chat: ChatConfiguration) => void;
};

function Action({label, onPress, disabled, danger, primary}: {
  label: string; onPress: () => void; disabled?: boolean; danger?: boolean; primary?: boolean;
}) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled: !!disabled}}
      disabled={disabled} style={[styles.action, primary && styles.primary, disabled && styles.disabled]}
      onPress={onPress}>
      <Text style={[styles.actionText, primary && styles.primaryText, danger && styles.danger]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Toggle({label, value, disabled, onChange}: {
  label: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange}
        trackColor={{false: colors.border, true: colors.accent}}
        thumbColor={value ? colors.background : colors.textSecondary}/>
    </View>
  );
}

function localPersonalisation(value: ChatPersonalisation): ChatPersonalisation {
  return {description: value.description, avatarColor: value.avatarColor, avatarIcon: value.avatarIcon};
}

function Personalise({name, value, onChange, disabled}: {
  name: string; value: ChatPersonalisation; onChange: (value: ChatPersonalisation) => void; disabled: boolean;
}) {
  return (
    <>
      <ChatAvatarPicker name={name} value={value} onChange={onChange} disabled={disabled}/>
      <Text style={styles.label}>Description · optional, local only</Text>
      <TextInput accessibilityLabel="Local description" style={[styles.input, styles.description]}
        value={value.description} editable={!disabled} multiline maxLength={240}
        onChangeText={description => onChange({...value, description})}
        placeholder="What is this chat for?" placeholderTextColor={colors.textMuted}/>
    </>
  );
}

function ProvisionForm({selection, controller, onClose, onProvisioned}: Omit<ChatManagementDialogProps, 'selection'> & {
  selection: Extract<ChatManagementSelection, {kind: 'create' | 'join'}>;
}) {
  const joining = selection.kind === 'join';
  const [mode, setMode] = useState<'invite' | 'manual'>('invite');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [invite, setInvite] = useState('');
  const [personalisation, setPersonalisation] = useState<ChatPersonalisation>(() => localPersonalisation(defaultChatPreferences));
  const [review, setReview] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const submitting = useRef(false);
  const current = controller.radio === selection.radio;
  const disabled = !current || controller.busy || controller.radioBusy;
  const full = !!controller.capacity && controller.capacity.used >= controller.capacity.total;
  useEffect(() => {
    if (!current) {
      setSecret('');
      setInvite('');
      setReview(false);
    }
  }, [current]);
  const reviewInput = () => {
    setInputError(null);
    try {
      if (joining) {
        const parsed = mode === 'invite' ? decodeChatInvite(invite) : validateChatInvite({name, secretHex: secret});
        setName(parsed.name);
        setSecret(parsed.secretHex);
        setInvite('');
      } else {
        setName(validateChatName(name));
      }
      Keyboard.dismiss();
      setReview(true);
    } catch {
      setInputError(joining ? 'Invalid invitation or private key. Check the details with the sender.'
        : 'Use a channel name of 1–31 UTF-8 bytes without control characters.');
    }
  };
  const submit = async () => {
    if (submitting.current || disabled || !review || !controller.isCurrentRadio(selection.radio)) return;
    submitting.current = true;
    try {
      const chat = await controller.provision(selection.radio, {
        name, personalisation, ...(joining ? {secretHex: secret} : {}),
      });
      setSecret('');
      if (controller.isCurrentRadio(chat.radio)) {
        onProvisioned?.(chat);
        onClose();
      }
    } catch {
      setSecret('');
      setInvite('');
      setReview(false);
    } finally {
      submitting.current = false;
    }
  };
  return (
    <>
      <Text style={styles.title}>{joining ? 'Join a chat' : 'New private chat'}</Text>
      <Text style={styles.body}>{joining
        ? 'Paste an invitation from someone you trust, or enter their MeshCore channel details.'
        : 'Give your chat a name. BushMesh creates a private key and checks the radio has saved it.'}</Text>
      {controller.capacity && <Text style={styles.label}>{controller.capacity.used} of {controller.capacity.total} radio slots in use</Text>}
      {full && <Text style={styles.danger}>All channel slots are occupied. Leave an unused chat first.</Text>}
      {!current && <Text style={styles.danger}>Radio disconnected or changed. Close and reopen when connected.</Text>}
      {!review ? (
        <>
          <Section title={joining ? 'Invitation' : 'Chat details'}>
            {joining && <Action label={mode === 'invite' ? 'Enter name and key manually' : 'Paste an invitation instead'}
              disabled={disabled} onPress={() => {
                setMode(mode === 'invite' ? 'manual' : 'invite');
                setSecret(''); setInvite(''); setInputError(null);
              }}/>}
            {joining && mode === 'invite' ? (
              <TextInput accessibilityLabel="Private invitation" style={styles.input}
                value={invite} onChangeText={setInvite} editable={!disabled} secureTextEntry
                autoCorrect={false} autoCapitalize="none" maxLength={512}
                placeholder="Paste private invitation" placeholderTextColor={colors.textMuted}/>
            ) : (
              <>
                <TextInput accessibilityLabel="Channel name" style={styles.input}
                  value={name} onChangeText={setName} editable={!disabled}
                  autoCorrect={false} maxLength={31} placeholder="Channel name" placeholderTextColor={colors.textMuted}/>
                {joining && <TextInput accessibilityLabel="Private channel key" style={styles.input}
                  value={secret} onChangeText={setSecret} editable={!disabled}
                  secureTextEntry autoCorrect={false} autoCapitalize="none" maxLength={32}
                  placeholder="32 hexadecimal characters" placeholderTextColor={colors.textMuted}/>}
              </>
            )}
          </Section>
          <Action primary label="Review chat" disabled={disabled || full} onPress={reviewInput}/>
        </>
      ) : (
        <>
          <Section title="Confirm chat">
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.body}>{joining ? 'You will join using the private key provided.' : 'A new random key will be generated.'} An empty slot will be selected automatically.</Text>
            <Personalise name={name} value={personalisation} onChange={setPersonalisation} disabled={disabled}/>
          </Section>
          <Text style={styles.body}>Anyone with this shared key can access the channel. It does not establish verified identity or administrator rights.</Text>
          <Action primary label={controller.busy ? 'Verifying radio…' : joining ? 'Confirm and join' : 'Create chat'}
            disabled={disabled || full} onPress={() => {submit().catch(() => undefined);}}/>
          <Action label="Edit details" disabled={disabled} onPress={() => {setSecret(''); setReview(false);}}/>
        </>
      )}
      {!!inputError && <Text accessibilityRole="alert" style={styles.danger}>{inputError}</Text>}
      {!controller.ready && current && !review && <Action label="Refresh available chats" disabled={disabled}
        onPress={() => controller.refresh().catch(() => undefined)}/>}
    </>
  );
}

/** Full-page settings. Can also be mounted directly by the messenger router. */
export function ChatSettingsPage({chat, controller, onClose, onLeft}: {
  chat: ChatConfiguration; controller: ChatManagementController;
  onClose: () => void; onLeft?: (chat: ChatConfiguration) => void;
}) {
  const p = controller.preferences[chat.id] ?? defaultChatPreferences;
  const [name, setName] = useState(p.displayName);
  const [personalisation, setPersonalisation] = useState<ChatPersonalisation>(() => localPersonalisation(p));
  const [shareError, setShareError] = useState(false);
  const current = controller.ready && controller.radio === chat.radio &&
    controller.chats.some(c => c.id === chat.id);
  const disabled = !current || controller.busy || controller.radioBusy;
  useEffect(() => {
    if (current) {
      setName(p.displayName);
      setPersonalisation({description: p.description, avatarColor: p.avatarColor, avatarIcon: p.avatarIcon});
    }
  }, [current, p.displayName, p.description, p.avatarColor, p.avatarIcon]);
  const update = (patch: Parameters<ChatManagementController['update']>[1]) => {
    controller.update(chat, patch).catch(() => undefined);
  };
  const invite = () => Alert.alert(
    'Share private invitation?',
    'Anyone receiving this invitation can access the shared channel. Only share with trusted people. The receiving app may keep a copy. This is not an authenticated convoy invitation.',
    [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Share invitation', onPress: () => {
        (async () => {
          try {
            setShareError(false);
            const secret = await controller.credential(chat);
            if (!controller.isCurrentRadio(chat.radio)) return;
            await Share.share({message: encodeChatInvite({name: chat.name, secretHex: secret})});
          } catch {
            setShareError(true);
          }
        })();
      }},
    ],
  );
  const leave = () => Alert.alert(
    'Leave this chat?',
    'Clears this channel from the connected radio and removes its local preferences. Other radios and your encrypted Radio History are unchanged. You will need the key to join again.',
    [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Leave chat', style: 'destructive', onPress: () => {
        controller.leave(chat).then(() => {
          onLeft?.(chat);
          onClose();
        }).catch(() => undefined);
      }},
    ],
  );
  return (
    <>
      <View style={styles.hero}>
        <ChatAvatar name={p.displayName || chat.name} {...p} large/>
        <Text style={styles.title}>{p.displayName || chat.name}</Text>
        <Text style={styles.body}>{chat.privateChannel ? 'Private channel' : 'Public channel'} · {current ? 'Radio connected' : 'Not currently verified'}</Text>
        {current && <Text style={styles.label}>{chatRole(p)}</Text>}
      </View>
      {!current && <Text style={styles.danger}>Connect to the original radio and refresh this chat before changing settings.</Text>}
      {!current && controller.radio === chat.radio && <Action label="Refresh chat" disabled={controller.busy || controller.radioBusy}
        onPress={() => controller.refresh().catch(() => undefined)}/>}
      <Section title="Conversation information">
        <Text style={styles.label}>MeshCore channel</Text>
        <Text style={styles.name}>{chat.name}</Text>
        <Text style={styles.body}>Radio slot {chat.slot} · {chat.privateChannel ? 'Private key configured' : 'Public / zero key'}</Text>
        {!!p.description && current && <Text style={styles.body}>{p.description}</Text>}
      </Section>
      <Section title="Personalisation">
        <Text style={styles.label}>Nickname · local only</Text>
        <TextInput accessibilityLabel="Local display name" style={styles.input}
          value={name} onChangeText={setName} maxLength={80} editable={!disabled}
          placeholder={chat.name} placeholderTextColor={colors.textMuted}/>
        <Personalise name={name || chat.name} value={personalisation} onChange={setPersonalisation} disabled={disabled}/>
        <Action primary label="Save personalisation" disabled={disabled}
          onPress={() => update({...localPersonalisation(personalisation), displayName: name})}/>
        <Toggle label="Pin chat" value={p.pinned} disabled={disabled} onChange={pinned => update({pinned})}/>
        <Toggle label="Archive chat locally" value={p.archived} disabled={disabled} onChange={archived => update({archived})}/>
        <Toggle label="Mark unread" value={p.unread} disabled={disabled} onChange={unread => update({unread})}/>
      </Section>
      <Section title="Notifications">
        <Text style={styles.body}>Individual chat mute and auto-read are not available. Global radio speech settings are separate. Critical safety alerts remain independent.</Text>
      </Section>
      <Section title={p.localCreator ? 'Creator tools' : 'Channel access'}>
        <Text style={styles.body}>{current && p.localCreator
          ? 'You created this configuration on this phone. This does not grant authority over other radios.'
          : 'Sharing a private invitation is possible for anyone with the channel key.'}</Text>
        <Action label="Share private invitation" disabled={disabled || !chat.privateChannel} onPress={invite}/>
        {shareError && <Text style={styles.danger}>Invitation could not be shared. Refresh the chat before trying again.</Text>}
        <Text style={styles.body}>Verified member lists, administrator roles and membership controls require authenticated group security and are unavailable.</Text>
      </Section>
      <Section title="Privacy and history">
        <Text style={styles.body}>A MeshCore shared key allows channel access, not proof of who sent a message. Archive hides the chat locally; it does not erase messages or change the radio.</Text>
        <Text style={styles.body}>Per-chat message search, export and deletion are unavailable because existing history cannot reliably identify the original channel configuration.</Text>
      </Section>
      <Section title="Leave chat">
        <Text style={styles.body}>Remove this channel from the connected radio only. Your encrypted Radio History is retained.</Text>
        <Action label="Leave and clear radio slot" disabled={disabled} danger onPress={leave}/>
      </Section>
    </>
  );
}

export function ChatManagementDialog(props: ChatManagementDialogProps): React.JSX.Element | null {
  const {selection, controller, onClose} = props;
  if (!selection) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen"
      onRequestClose={() => {if (!controller.busy) onClose();}}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" disabled={controller.busy}
            onPress={onClose} style={styles.back}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{selection.kind === 'settings' ? 'Chat settings' : 'Chats'}</Text>
        </View>
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={styles.screen} contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {selection.kind === 'settings'
              ? <ChatSettingsPage key={selection.chat.id} chat={selection.chat} controller={controller}
                  onClose={onClose} onLeft={props.onLeft}/>
              : <ProvisionForm key={selection.kind + selection.radio} {...props} selection={selection}/>}
            {!!controller.error && <Text accessibilityRole="alert" style={styles.danger}>{controller.error}</Text>}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 48, gap: 16},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderColor: colors.border},
  headerTitle: {fontSize: 18, fontWeight: '700', color: colors.textPrimary},
  back: {minHeight: 48, justifyContent: 'center', paddingRight: 22},
  backText: {fontSize: 16, fontWeight: '700', color: colors.accent},
  hero: {alignItems: 'center', gap: 8, paddingVertical: 12},
  section: {padding: 16, gap: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border},
  sectionTitle: {fontSize: 16, fontWeight: '800', color: colors.accent},
  title: {fontSize: 26, fontWeight: '800', color: colors.textPrimary},
  name: {fontSize: 18, fontWeight: '700', color: colors.textPrimary},
  body: {fontSize: 15, lineHeight: 22, color: colors.textSecondary},
  label: {fontSize: 14, fontWeight: '700', color: colors.textSecondary},
  input: {borderWidth: 1, borderColor: colors.border, borderRadius: 12, minHeight: 48,
    padding: 12, color: colors.textPrimary, backgroundColor: colors.background, fontSize: 16},
  description: {minHeight: 80, textAlignVertical: 'top'},
  action: {backgroundColor: colors.surfaceSoft, borderRadius: 12, padding: 14, minHeight: 48,
    borderWidth: 1, borderColor: colors.border, justifyContent: 'center'},
  actionText: {fontSize: 15, fontWeight: '700', color: colors.accent},
  primary: {backgroundColor: colors.accent},
  primaryText: {color: colors.background},
  disabled: {opacity: 0.45},
  danger: {color: colors.danger, fontSize: 15, lineHeight: 22},
  toggleRow: {flexDirection: 'row', alignItems: 'center', minHeight: 48, justifyContent: 'space-between'},
  rowLabel: {color: colors.textPrimary, fontSize: 16, flex: 1},
});
