import {Buffer} from 'buffer';
import type {BushMeshChannel, BushMeshChannelMessage} from '../../state/BushMeshContext';

export const MESHCORE_CHANNEL_TEXT_MAX_BYTES = 133;

/** A stable, non-secret identity supplied by the owning radio/history adapter.
 * Not the slot number, channel label, PSK, or discovered peer identity alone.
 * channelGeneration MUST change whenever a slot is reconfigured.
 */
export type RadioConversationScope = {
  radioId: string;
  channelGeneration: string;
  channelIndex: string;
  channelName: string;
};

export type MessageOwnershipProof = {
  /** An independently persisted, scoped origin for this exact message ID. */
  radioId: string;
  channelGeneration: string;
  channelIndex: string;
  channelName: string;
};

export type ScopedMessage = {
  message: BushMeshChannelMessage;
  /** Origin: live observed in this mounted radio session, or trusted external proof. */
  provenance: 'session' | 'verified-history';
};

export type MessengerConversation = {
  channel: Pick<BushMeshChannel, 'channelIndex' | 'channelName'>;
  scope: RadioConversationScope;
  messages: readonly ScopedMessage[];
  preview: string;
  activityMs: number | null;
  pinned: boolean;
  unreadCount: number | null;
};

export function validChannelIndex(index: string): boolean {
  return /^(?:[0-7])$/.test(index);
}

export function validScope(scope: RadioConversationScope | null | undefined): scope is RadioConversationScope {
  return !!scope && validChannelIndex(scope.channelIndex) &&
    !!scope.radioId.trim() && !!scope.channelGeneration.trim() &&
    !!scope.channelName.trim();
}

export function equalScope(a: RadioConversationScope | null | undefined, b: RadioConversationScope | null | undefined): boolean {
  return validScope(a) && validScope(b) &&
    a.radioId === b.radioId && a.channelGeneration === b.channelGeneration &&
    a.channelIndex === b.channelIndex && a.channelName === b.channelName;
}

export function equalProof(scope: RadioConversationScope, proof: MessageOwnershipProof | undefined): boolean {
  return !!proof && equalScope(scope, proof);
}

/** "Same slot" is deliberately insufficient proof of conversation identity. */
export function scopedMessages(
  messages: readonly BushMeshChannelMessage[],
  scope: RadioConversationScope,
  trustedOwnership: Readonly<Record<string, MessageOwnershipProof>> = {},
  observedSession: Readonly<Record<string, RadioConversationScope>> = {},
): ScopedMessage[] {
  return messages
    .filter(message => message.channelIndex === scope.channelIndex &&
      message.channelName === scope.channelName)
    .flatMap<ScopedMessage>(message => {
      if (equalProof(scope, trustedOwnership[message.id])) {
        return [{message, provenance: 'verified-history' as const}];
      }
      if (equalScope(scope, observedSession[message.id])) {
        return [{message, provenance: 'session' as const}];
      }
      return [];
    })
    .sort((a, b) => {
      const aMs = Date.parse(a.message.createdAt);
      const bMs = Date.parse(b.message.createdAt);
      return (Number.isFinite(aMs) ? aMs : 0) -
        (Number.isFinite(bMs) ? bMs : 0);
    });
}

export function quarantineCount(
  messages: readonly BushMeshChannelMessage[],
  knownIds: ReadonlySet<string>,
): number {
  return messages.filter(m => !knownIds.has(m.id)).length;
}

export function validateCarrierText(value: string): {
  text: string; bytes: number; valid: boolean; issue: string | null;
} {
  const text = value.trim();
  const bytes = Buffer.byteLength(text, 'utf8');
  return !text ? {
    text, bytes, valid: false, issue: 'Enter a message first.',
  } : bytes > MESHCORE_CHANNEL_TEXT_MAX_BYTES ? {
    text, bytes, valid: false,
    issue: 'Message exceeds MeshCore\'s 133 UTF-8 byte limit (' + bytes + ' bytes).',
  } : {
    text, bytes, valid: true, issue: null,
  };
}

export function deliveryText(message: BushMeshChannelMessage): string {
  if (message.direction === 'received') return 'Received · peer identity unverified';
  switch (message.status) {
    case 'pending': return 'Pending radio response';
    case 'accepted': return 'Radio accepted · delivery not confirmed';
    case 'confirmed': return 'Peer confirmed by matching ACK';
    case 'failed':
      return message.submissionFailure?.reason === 'timeout' ||
        message.submissionFailure?.reason === 'disconnected' ||
        message.submissionFailure?.reason === 'write-error' ||
        message.submissionFailure?.reason === 'unknown'
        ? 'Acceptance uncertain · do not auto-retry'
        : 'Radio rejected';
  }
}

export function buildMessengerConversations(input: {
  channels: readonly BushMeshChannel[];
  scopes: readonly RadioConversationScope[];
  messages: readonly BushMeshChannelMessage[];
  verifiedOwnership?: Readonly<Record<string, MessageOwnershipProof>>;
  sessionOwnership?: Readonly<Record<string, RadioConversationScope>>;
  /** From a real acknowledged/recorded read-state provider; null = unknown. */
  unread?: Readonly<Record<string, number>>;
  pinned?: ReadonlySet<string>;
  search?: string;
}): MessengerConversation[] {
  const search = (input.search ?? '').trim().toLocaleLowerCase();
  const seen = new Set<string>();
  // Different radio IDs / channel generations using one physical slot are
  // different conversations. Never collapse the scopes into one slot row.
  return input.scopes.flatMap(scope => {
      const channel = input.channels.find(c => c.channelIndex === scope.channelIndex &&
        c.channelName === scope.channelName);
      if (!channel || !validScope(scope) || !validChannelIndex(channel.channelIndex) ||
        !channel.channelName.trim() || channel.channelName === 'Empty') return [];
      const id = conversationKey(scope);
      if (seen.has(id)) return [];
      seen.add(id);
      const messages = scopedMessages(input.messages, scope,
        input.verifiedOwnership, input.sessionOwnership);
      const latest = messages[messages.length - 1]?.message;
      const parsed = latest ? Date.parse(latest.createdAt) : NaN;
      const activityMs = Number.isFinite(parsed) ? parsed : null;
      const preview = latest?.text ?? 'No attributed messages yet';
      if (search && !(channel.channelName.toLocaleLowerCase().includes(search) ||
        preview.toLocaleLowerCase().includes(search))) return [];
      const unread = input.unread?.[id];
      return [{
        channel: {channelIndex: channel.channelIndex, channelName: channel.channelName},
        scope, messages, preview, activityMs, pinned: input.pinned?.has(id) ?? false,
        unreadCount: Number.isSafeInteger(unread) && unread! >= 0 ? unread! : null,
      }];
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) ||
      (b.activityMs ?? -1) - (a.activityMs ?? -1) ||
      a.channel.channelName.localeCompare(b.channel.channelName));
}

export function conversationKey(scope: RadioConversationScope): string {
  // Serialized tuple is injective: naive colon concatenation can collide
  // when real radio addresses themselves contain ':'.
  return JSON.stringify([
    scope.radioId, scope.channelGeneration, scope.channelIndex, scope.channelName,
  ]);
}
