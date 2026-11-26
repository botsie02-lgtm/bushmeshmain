import {planConversationClear, applyHistoryRetention} from '../src/persistence/historyRetention';
import {createMessageSnapshot, decodeMessageSnapshot, encodeMessageSnapshot} from '../src/persistence/messageSnapshot';
import type {BushMeshChannelMessage} from '../src/state/BushMeshContext';
const id='a'.repeat(64);
const scope={radioId:'radio-a',channelGeneration:'config:2:'+id,channelIndex:'1',channelName:'Camp'};
const received: BushMeshChannelMessage={id:'received-1',channelIndex:'1',channelName:'Camp',direction:'received',status:'confirmed',text:'test',createdAt:'2026-01-01T00:00:00Z',conversation:{...scope,version:1,provenance:'local-observation'},observation:{version:1,source:'native-session',origin:'queued-generation-unknown',radio:'radio-a',configurationId:id,configurationName:'Camp',timestamp:100,snr:null,pathLength:null,association:{version:1,evidence:'post-empty-local-observation',incarnation:2}}};
const sent: BushMeshChannelMessage={...received,id:'sent-1',direction:'sent',status:'accepted',observation:undefined,conversation:{...scope,version:1,provenance:'local-submission'}};
test('clear selects only exact persisted scope and retains unknown or different incarnation records',()=>{
 const other={...sent,id:'other',conversation:{...sent.conversation!,channelGeneration:'config:1:'+id}};
 const unknown={...sent,id:'unknown',conversation:undefined};
 const plan=planConversationClear([received,sent,other,unknown],scope);
 expect(plan.deletedIds).toEqual(['received-1','sent-1']);
 expect(plan.remaining).toEqual([other,unknown]);
 const stored=decodeMessageSnapshot(encodeMessageSnapshot(createMessageSnapshot(plan.remaining,1,plan.retention)));
 expect(stored.retention).toEqual(plan.retention);
 expect(applyHistoryRetention([received,sent,...stored.messages],stored.retention)).toEqual([other,unknown]);
});
test('possible receive replay with a new occurrence is quarantined; different timestamps and scopes remain',()=>{
 const plan=planConversationClear([received],scope);
 const replay={...received,id:'new-occurrence'};
 const later={...received,id:'later',observation:{...received.observation!,timestamp:101}};
 const result=applyHistoryRetention([replay,later],plan.retention);
 expect(result[0].conversation).toBeUndefined();
 expect(result[0].observation?.retentionReason).toBe('possible-cleared-record-replay');
 expect(result[0].text).toBe(received.text);
 expect(result[1]).toEqual(later);
});
test('pending outgoing journal prevents clearing',()=>expect(()=>planConversationClear([{...sent,status:'pending'}],scope)).toThrow('pending'));
