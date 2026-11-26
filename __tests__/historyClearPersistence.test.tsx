import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {BushMeshProvider, useBushMesh, type BushMeshChannelMessage} from '../src/state/BushMeshContext';
import {androidMessagePersistence} from '../src/persistence/AndroidMessagePersistence';
import {createMessageSnapshot, decodeMessageSnapshot, encodeMessageSnapshot, type BushMeshMessageSnapshotV1} from '../src/persistence/messageSnapshot';

const config = 'a'.repeat(64);
const scope = {radioId:'radio-A',channelGeneration:'config:1:'+config,channelIndex:'1',channelName:'Camp'};
const incoming: BushMeshChannelMessage = {id:'old', direction:'received',status:'confirmed',channelIndex:'1',channelName:'Camp',text:'same',createdAt:'2026-01-01T00:00:00Z',conversation:{...scope,version:1,provenance:'local-observation'},observation:{version:1,source:'native-session',origin:'queued-generation-unknown',radio:'radio-A',configurationId:config,configurationName:'Camp',timestamp:1,snr:null,pathLength:null,association:{version:1,evidence:'post-empty-local-observation',incarnation:1}}};
const other: BushMeshChannelMessage = {...incoming,id:'unknown',conversation:undefined,observation:undefined};
test('failed clear keeps original rows; concurrent receive, commit and restart preserve deletion and isolate replay', async () => {
  let saved: BushMeshMessageSnapshotV1 = createMessageSnapshot([incoming,other]);
  const stored = () => saved;
  let failure = true;
  let gate: Promise<void> | null = null;
  let entered: (()=>void) | null = null;
  jest.spyOn(androidMessagePersistence,'isSupported').mockReturnValue(true);
  jest.spyOn(androidMessagePersistence,'load').mockImplementation(async()=>decodeMessageSnapshot(encodeMessageSnapshot(stored())));
  jest.spyOn(androidMessagePersistence,'clear').mockResolvedValue(undefined);
  jest.spyOn(androidMessagePersistence,'save').mockImplementation(async snapshot=>{
    if (snapshot.retention && failure) {failure=false; throw new Error('write rejected');}
    if (snapshot.retention && gate) {const pending=gate; gate=null; entered?.(); await pending;}
    saved=decodeMessageSnapshot(encodeMessageSnapshot(snapshot));
  });
  let current!: ReturnType<typeof useBushMesh>;
  function Probe(){current=useBushMesh();return null;}
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  const mount=async()=>{await ReactTestRenderer.act(async()=>{renderer=ReactTestRenderer.create(<BushMeshProvider><Probe/></BushMeshProvider>);});};
  try {
    await mount();
    expect(current.channelMessages).toHaveLength(2);
    await ReactTestRenderer.act(async()=>{await expect(current.clearConversationHistory(scope)).rejects.toThrow('write rejected');});
    expect(current.channelMessages).toHaveLength(2);
    expect(stored().retention).toBeUndefined();
    let release!: ()=>void;
    gate=new Promise<void>(resolve=>{release=resolve;});
    const started=new Promise<void>(resolve=>{entered=resolve;});
    await ReactTestRenderer.act(async()=>{
      const clearing=current.clearConversationHistory(scope);
      await started;
      const newMessage=current.addDurableChannelMessage({...incoming,id:'new',observation:{...incoming.observation!,timestamp:2}});
      release();
      expect(await clearing).toEqual(['old']);
      expect(await newMessage).toBe(true);
    });
    expect(current.channelMessages.map(m=>m.id).sort()).toEqual(['new','unknown']);
    await ReactTestRenderer.act(async()=>renderer.unmount());
    await mount();
    await ReactTestRenderer.act(async()=>{
      expect(await current.addDurableChannelMessage(incoming)).toBe(false);
      expect(await current.addDurableChannelMessage({...incoming,id:'possible-replay'})).toBe(true);
    });
    expect(current.channelMessages.find(m=>m.id==='possible-replay')?.conversation).toBeUndefined();
    expect(current.channelMessages.find(m=>m.id==='possible-replay')?.observation?.retentionReason).toBe('possible-cleared-record-replay');
    expect(stored().retention?.deletedIds).toEqual(['old']);
    expect(current.channelMessages.some(m=>m.id==='unknown')).toBe(true);
  } finally {if(renderer) await ReactTestRenderer.act(async()=>renderer.unmount());jest.restoreAllMocks();}
},15000);
