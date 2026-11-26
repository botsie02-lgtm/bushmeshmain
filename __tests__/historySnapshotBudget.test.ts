import {assertHistoryBridgeBudget, utf8SnapshotBytes, HISTORY_MAX_BRIDGE_BYTES} from '../src/persistence/historySnapshotBudget';
import {createMessageSnapshot, encodeMessageSnapshot} from '../src/persistence/messageSnapshot';
import type {BushMeshChannelMessage} from '../src/state/BushMeshContext';
import {Buffer} from 'buffer';
const row: BushMeshChannelMessage = {id:'one', channelIndex:'1', channelName:'Camp', direction:'received',status:'confirmed',text:'日本 é 🙂 \\ "' + String.fromCharCode(10),createdAt:'2026-01-01T00:00:00Z'};
test('counts serialized UTF-8 exactly, including JSON escaping and duplicated retention argument', () => {
  const retention = {version:1 as const,deletedIds:['old'],possibleReplayKeys:[]};
  const snapshot = createMessageSnapshot([row,{...row,id:'two'}],1,retention);
  const size = Buffer.byteLength(encodeMessageSnapshot(snapshot)) + Buffer.byteLength(JSON.stringify(retention));
  expect(assertHistoryBridgeBudget(snapshot,size)).toBe(size);
  expect(()=>assertHistoryBridgeBudget(snapshot,size-1)).toThrow('safe snapshot memory budget');
  expect(utf8SnapshotBytes('é🙂')).toBe(6);
});
test('rejects a large candidate without trimming the history or changing the snapshot', () => {
  const snapshot = createMessageSnapshot(Array.from({length:50000},(_,i)=>({...row,id:String(i),text:'x'.repeat(350)})),1);
  expect(()=>assertHistoryBridgeBudget(snapshot,HISTORY_MAX_BRIDGE_BYTES)).toThrow('safe snapshot memory budget');
  expect(snapshot.messages).toHaveLength(50000);
});
