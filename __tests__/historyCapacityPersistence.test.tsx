import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {BushMeshProvider,useBushMesh,type BushMeshChannelMessage} from '../src/state/BushMeshContext';
import {androidMessagePersistence} from '../src/persistence/AndroidMessagePersistence';
import {createMessageSnapshot} from '../src/persistence/messageSnapshot';
import {HISTORY_CAPACITY_MESSAGE} from '../src/persistence/historySnapshotBudget';

const row: BushMeshChannelMessage = {id:'one',channelIndex:'1',channelName:'Camp',text:'old',createdAt:'2026-01-01T00:00:00Z',direction:'received',status:'confirmed'};
test('capacity rejection preserves committed rows, leaves history available and successful retry avoids redundant rewrite',async()=>{
  let saved=createMessageSnapshot([row]);
  let blocked=true;
  jest.spyOn(androidMessagePersistence,'isSupported').mockReturnValue(true);
  jest.spyOn(androidMessagePersistence,'load').mockImplementation(async()=>saved);
  const save=jest.spyOn(androidMessagePersistence,'save').mockImplementation(async snapshot=>{
    if(blocked) throw new Error(HISTORY_CAPACITY_MESSAGE);
    saved=snapshot;
  });
  let current!: ReturnType<typeof useBushMesh>;
  function Probe(){current=useBushMesh();return null;}
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  try {
    await ReactTestRenderer.act(async()=>{renderer=ReactTestRenderer.create(<BushMeshProvider><Probe/></BushMeshProvider>);});
    expect(save).not.toHaveBeenCalled();
    const next={...row,id:'two',text:'new'};
    await ReactTestRenderer.act(async()=>{await expect(current.addDurableChannelMessage(next)).rejects.toThrow('safe snapshot memory budget');});
    expect(saved.messages.map(m=>m.id)).toEqual(['one']);
    expect(current.channelMessages.map(m=>m.id)).toEqual(['one']);
    expect(current.messageHistoryAvailable).toBe(true);
    expect(current.messagePersistenceStatus).toBe('error');
    blocked=false;
    await ReactTestRenderer.act(async()=>{expect(await current.addDurableChannelMessage(next)).toBe(true);});
    expect(saved.messages).toHaveLength(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(current.messagePersistenceStatus).toBe('ready');
  } finally {if(renderer) await ReactTestRenderer.act(async()=>renderer.unmount());jest.restoreAllMocks();}
});
