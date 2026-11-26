import {Buffer} from 'buffer';
import {createMessageSnapshot, decodeMessageSnapshot, encodeMessageSnapshot} from '../src/persistence/messageSnapshot';
import {scopedMessages} from '../src/screens/radioMessenger/messengerModel';
import type {BushMeshChannelMessage} from '../src/state/BushMeshContext';

const config='a'.repeat(64);
const scope={radioId:'synthetic-radio',channelGeneration:'config:1:'+config,channelIndex:'1',channelName:'Camp'};
function makeRow(index:number): BushMeshChannelMessage {
  return {id:'scale-'+index.toString().padStart(8,'0'),channelIndex:'1',channelName:'Camp',
    text:'Synthetic message '+index+' '+ 'x'.repeat(90), direction:'received', status:'confirmed',
    createdAt:new Date(1767225600000+index*1000).toISOString(),conversation:{...scope,version:1,provenance:'local-observation'},
    observation:{version:1,source:'native-session',origin:'queued-generation-unknown',radio:scope.radioId,configurationId:config,configurationName:scope.channelName,timestamp:index,snr:3,pathLength:1,association:{version:1,evidence:'post-empty-local-observation',incarnation:1},queueOccurrenceId:'scale-'+index}};
}
test.each([1000,10000,50000])('history host snapshot and search fixture: %i messages',count=>{
  const memoryBefore=process.memoryUsage().heapUsed;
  const rows=Array.from({length:count},(_,i)=>makeRow(i));
  const start=Date.now();
  const serialized=encodeMessageSnapshot(createMessageSnapshot(rows));
  const initialEncodeMs=Date.now()-start;
  const restoreStart=Date.now();
  const restored=decodeMessageSnapshot(serialized);
  const restoreMs=Date.now()-restoreStart;
  const incrementStart=Date.now();
  const next=encodeMessageSnapshot(createMessageSnapshot([makeRow(count),...restored.messages]));
  const incrementalEncodeMs=Date.now()-incrementStart;
  const searchStart=Date.now();
  const proofs=Object.fromEntries(restored.messages.map(m=>[m.id,m.conversation!]));
  const scoped=scopedMessages(restored.messages,scope,proofs);
  const page=scoped.filter(m=>m.message.text.includes('Synthetic message')).slice(-100);
  const searchAndPageMs=Date.now()-searchStart;
  const metrics={count,bytes:Buffer.byteLength(serialized),initialEncodeMs,restoreMs,incrementalEncodeMs,searchAndPageMs,heapDeltaBytes:process.memoryUsage().heapUsed-memoryBefore};
  // Host-only measurements; not Android Keystore, SharedPreferences, or device RSS.
  console.info('RADIO_HISTORY_SCALE '+JSON.stringify(metrics));
  expect(restored.messages).toHaveLength(count);
  expect(JSON.parse(next).messages).toHaveLength(count+1);
  expect(page).toHaveLength(100);
  expect(page[99].message.id).toBe(makeRow(count-1).id);
  expect(()=>decodeMessageSnapshot(serialized.slice(0,-1))).toThrow();
},60000);
