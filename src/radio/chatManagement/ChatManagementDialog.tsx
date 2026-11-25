import React, {useState} from 'react';
import {
  Alert, Modal, ScrollView, Share, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import {colors} from '../../theme/colors';
import {ChatConfiguration, chatRole, defaultChatPreferences} from './chatPreferences';
import {ChatManagementController} from './useChatManagement';

export type ChatManagementSelection =
  | {kind: 'create' | 'join'; radio: string}
  | {kind: 'settings'; chat: ChatConfiguration};

type Props = {
  selection: ChatManagementSelection | null;
  controller: ChatManagementController;
  onClose: () => void;
  /** Navigation only: do not change the active BushMesh carrier. */
  onProvisioned?: (chat: ChatConfiguration) => void;
  onLeft?: (chat: ChatConfiguration) => void;
};

function Action({label, onPress, disabled, danger}: {
  label: string; onPress: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <TouchableOpacity accessibilityRole="button" disabled={disabled}
      style={[styles.action, disabled && styles.disabled]} onPress={onPress}>
      <Text style={[styles.actionText, danger && styles.danger]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ProvisionForm({selection, controller, onClose, onProvisioned}: Omit<Props, 'selection'> & {
  selection: Extract<ChatManagementSelection, {kind: 'create' | 'join'}>;
}) {
  const joining = selection.kind === 'join';
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const current = controller.radio === selection.radio;
  const disabled = !current || controller.busy || controller.radioBusy;
  const submit = async () => {
    try {
      const chat = await controller.provision(selection.radio, {
        name, ...(joining ? {secretHex: secret.trim()} : {}),
      });
      setSecret('');
      if (controller.isCurrentRadio(chat.radio)) {
        onProvisioned?.(chat);
        onClose();
      }
    } catch {
      setSecret('');
    }
  };
  return (
    <>
      <Text style={styles.title}>{joining ? 'Join a chat' : 'Create a chat'}</Text>
      <Text style={styles.body}>{joining
        ? 'Enter the exact MeshCore channel name and private key supplied by a trusted person.'
        : 'A random private channel key will be generated on this device. Only an empty firmware slot will be used.'}</Text>
      <TextInput accessibilityLabel="Channel name" style={styles.input}
        value={name} onChangeText={setName} editable={!disabled}
        autoCorrect={false} placeholder="Channel name" placeholderTextColor={colors.textMuted}/>
      {joining && <TextInput accessibilityLabel="Private channel key" style={styles.input}
        value={secret} onChangeText={setSecret} editable={!disabled}
        secureTextEntry autoCorrect={false} autoCapitalize="none" maxLength={32}
        placeholder="32 hexadecimal characters" placeholderTextColor={colors.textMuted}/>}
      <Text style={styles.body}>Shared keys allow carrier access, not authenticated membership or administrator rights.</Text>
      {!current && <Text style={styles.danger}>Radio changed. Close and reopen this dialog.</Text>}
      <Action label={controller.busy ? 'Verifying…' : joining ? 'Join and verify' : 'Create and verify'}
        disabled={disabled || !name.trim() || (joining && !/^[a-f0-9]{32}$/i.test(secret.trim()))}
        onPress={() => {void submit();}}/>
    </>
  );
}

function Settings({chat, controller, onClose, onLeft}: {
  chat: ChatConfiguration; controller: ChatManagementController;
  onClose: () => void; onLeft?: (chat: ChatConfiguration) => void;
}) {
  const p = controller.preferences[chat.id] ?? defaultChatPreferences;
  const [name, setName] = useState(p.displayName);
  const current = controller.ready && controller.radio === chat.radio &&
    controller.chats.some(c => c.id === chat.id);
  const disabled = !current || controller.busy || controller.radioBusy;
  const update = (patch: Parameters<ChatManagementController['update']>[1]) => {
    controller.update(chat, patch).catch(() => undefined);
  };
  const invite = () => Alert.alert(
    'Share private channel key?',
    'Anyone receiving this key can access the shared carrier. The receiving app may keep a copy. Do not share publicly or take screenshots. This is not a verified convoy invitation.',
    [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Share key', onPress: () => {
        (async () => {
          try {
            const secret = await controller.credential(chat);
            if (!controller.isCurrentRadio(chat.radio)) return;
            await Share.share({message: 'MeshCore private channel\nName: ' + chat.name + '\nKey: ' + secret});
          } catch {
            // Never display bridge/share errors that could include the credential.
          }
        })();
      }},
    ],
  );
  const leave = () => Alert.alert(
    'Leave this chat on the connected radio?',
    'This clears only this verified firmware channel slot and its local preferences. Other radios keep their configuration. Encrypted Radio History is retained. You will need the channel key to join again.',
    [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Leave and clear slot', style: 'destructive', onPress: () => {
        controller.leave(chat).then(() => {
          onLeft?.(chat);
          onClose();
        }).catch(() => undefined);
      }},
    ],
  );
  return (
    <>
      <Text style={styles.title}>{p.displayName || chat.name}</Text>
      <Text style={styles.body}>Channel: {chat.name} · Slot {chat.slot}</Text>
      <Text style={styles.body}>{chat.privateChannel ? 'Private key configured' : 'Public / zero key'} · MeshCore</Text>
      <Text style={styles.body}>{chatRole(p)}</Text>
      <Text style={styles.body}>Verified owner, administrator and participant roles are unavailable.</Text>
      {!current && <Text style={styles.danger}>Configuration not current. Close and refresh chats.</Text>}
      <TextInput accessibilityLabel="Local display name" style={styles.input}
        value={name} onChangeText={setName} maxLength={80} editable={!disabled}
        placeholder="Local display name" placeholderTextColor={colors.textMuted}/>
      <Action label="Save local display name" disabled={disabled || name.trim() === p.displayName}
        onPress={() => update({displayName: name})}/>
      <Action label={p.pinned ? 'Unpin chat' : 'Pin chat'} disabled={disabled}
        onPress={() => update({pinned: !p.pinned})}/>
      <Action label={p.archived ? 'Unarchive chat' : 'Archive chat locally'} disabled={disabled}
        onPress={() => update({archived: !p.archived})}/>
      <Action label={p.unread ? 'Mark read' : 'Mark unread'} disabled={disabled}
        onPress={() => update({unread: !p.unread})}/>
      <Text style={styles.body}>Mute unavailable: native notification routing is not configuration-scoped.</Text>
      <Action label="Share private channel invitation" disabled={disabled || !chat.privateChannel} onPress={invite}/>
      <Text style={styles.body}>History export and per-chat deletion unavailable: existing history cannot verify the channel configuration for every message.</Text>
      <Action label="Leave chat / clear radio slot" disabled={disabled} danger onPress={leave}/>
    </>
  );
}

export function ChatManagementDialog(props: Props): React.JSX.Element | null {
  const {selection, controller, onClose} = props;
  if (!selection) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet"
      onRequestClose={() => {if (!controller.busy) onClose();}}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <Action label="Close" disabled={controller.busy} onPress={onClose}/>
        {selection.kind === 'settings'
          ? <Settings key={selection.chat.id} chat={selection.chat} controller={controller}
              onClose={onClose} onLeft={props.onLeft}/>
          : <ProvisionForm key={selection.kind + selection.radio} {...props} selection={selection}/>}
        {!!controller.error && <Text accessibilityRole="alert" style={styles.danger}>{controller.error}</Text>}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 20, paddingBottom: 60, gap: 12},
  title: {fontSize: 25, fontWeight: '800', color: colors.textPrimary},
  body: {fontSize: 14, lineHeight: 21, color: colors.textSecondary},
  input: {borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    padding: 14, color: colors.textPrimary, backgroundColor: colors.surface},
  action: {backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border},
  actionText: {fontSize: 15, fontWeight: '700', color: colors.accent},
  disabled: {opacity: 0.45},
  danger: {color: colors.danger, fontSize: 14},
});
