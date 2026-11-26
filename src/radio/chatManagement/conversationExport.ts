import type {BushMeshChannelMessage} from '../../state/BushMeshContext';
import {deliveryText, equalScope, type RadioConversationScope} from '../../screens/radioMessenger/messengerModel';
import {createMessageSnapshot} from '../../persistence/messageSnapshot';

export type ConversationExportFormat = 'txt' | 'json';

/** Only records carrying their own persisted scope are eligible. No ephemeral
 * UI ownership, slot/name inference, key material or raw bridge metadata. */
export function buildConversationExport(messages: readonly BushMeshChannelMessage[], scope: RadioConversationScope, format: ConversationExportFormat) {
  if (!/^config:[1-9][0-9]*:[a-f0-9]{64}$/.test(scope.channelGeneration)) throw new Error('Exact conversation incarnation required.');
  const records = createMessageSnapshot(messages.filter(m => equalScope(m.conversation, scope))).messages.reverse().map(m => ({
    timestamp: m.createdAt, direction: m.direction, text: m.text,
    provenance: m.conversation!.provenance, delivery: deliveryText(m),
  }));
  const header = {version: 1, channel: scope.channelName, provenanceNotice: 'Local records only. Incoming local observation is not authenticated sender or original key proof.'};
  const content = format === 'json' ? JSON.stringify({...header, messages: records}, null, 2) :
    [header.channel, header.provenanceNotice, ...records.map(m => '[' + m.timestamp + '] ' + m.direction + ' | ' + m.provenance + ' | ' + m.delivery + '\n' + m.text)].join('\n\n');
  return {content, count: records.length};
}
