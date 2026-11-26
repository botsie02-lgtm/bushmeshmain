import {buildConversationExport} from '../src/radio/chatManagement/conversationExport';
import type {BushMeshChannelMessage} from '../src/state/BushMeshContext';
const scope = {radioId:'radio-a', channelGeneration:'config:2:'+'a'.repeat(64), channelIndex:'1', channelName:'Camp'};
const row: BushMeshChannelMessage = {id:'one', channelIndex:'1', channelName:'Camp', createdAt:'2026-01-01T00:00:00Z', direction:'sent', status:'accepted', text:'included', conversation:{...scope,version:1,provenance:'local-submission'}};
test('export includes only exact persisted incarnation and redacts internal identifiers',()=>{
 const result=buildConversationExport([row,{...row,id:'two',text:'other radio',conversation:{...row.conversation!,radioId:'radio-b'}},{...row,id:'three',text:'ambiguous',conversation:undefined},{...row,id:'four',text:'prior incarnation',conversation:{...row.conversation!,channelGeneration:'config:1:'+'a'.repeat(64)}}],scope,'json');
 expect(result.count).toBe(1); expect(JSON.parse(result.content).messages[0].text).toBe('included');
 expect(result.content).not.toMatch(/other radio|ambiguous|prior incarnation|radio-a|aaaaaaaa/);
 expect(buildConversationExport([row],scope,'txt').content).toContain('Radio accepted');
});
test('rejects an ephemeral scope',()=>expect(()=>buildConversationExport([row],{...scope,channelGeneration:'session-1'},'txt')).toThrow());
