import {VoiceAssistant,parseVoiceCommand,appendDictation,matchQuickMessage,type VoiceAdapter,type HeldVoiceAdapter,type VoiceDestination,type Recognition} from '../src/speech/VoiceAssistant';
import {localGpsReading} from '../src/speech/voiceGps';
const heard=(text:string,confidence=.95):Recognition=>({text,confidence});
function fixture(values:Recognition[]){
 let draft='unsent';let current=true;
 const send=jest.fn(async(_text:string,guard:()=>boolean):ReturnType<NonNullable<VoiceDestination['send']>>=>guard()?'Message accepted by the radio.':'No message submitted.');
 const adapter:VoiceAdapter={permission:jest.fn(async()=>true),recognize:jest.fn(async()=>{const r=values.shift();if(!r)throw Error('no match');return r;}),cancel:jest.fn(async()=>undefined),stopListening:jest.fn(async()=>undefined),speak:jest.fn(async()=>undefined),stopSpeech:jest.fn(async()=>undefined)};
 const d:VoiceDestination={key:'radio-A/config:2/id',label:'Camp',isCurrent:()=>current,draft:()=>draft,editDraft:v=>{draft=v;},send,latest:()=> 'send message',unread:()=>['one','two'],quick:()=>['All clear'],radio:()=> 'Connected'};
 return {a:new VoiceAssistant(adapter),adapter,d,send,change:()=>{current=false;}};
}
test('command grammar is exact, confidence checked and alternatives must agree',()=>{
 expect(parseVoiceCommand(heard('Hey BushMesh, send a message.'))).toBe('send');
 expect(parseVoiceCommand(heard('do not send message'))).toBeNull();
 expect(parseVoiceCommand(heard('send message',.4))).toBeNull();
 expect(parseVoiceCommand({...heard('send message'),alternatives:['read last message']})).toBeNull();
 expect(parseVoiceCommand(heard('constructor'))).toBeNull();
 expect(matchQuickMessage('All clear',['All clear','all clear'])).toBeNull();
});
test('dictation preserves existing draft and never transmits or truncates',async()=>{
 const f=fixture([heard('🙂'.repeat(40))]);await f.a.run('dictation',f.d);
 expect(f.d.draft()).toBe(appendDictation('unsent','🙂'.repeat(40)));expect(f.send).not.toHaveBeenCalled();
});
test('finite dialogue requires reliable yes, never changes existing draft',async()=>{
 const f=fixture([heard('send message'),heard('tree across track'),heard('yes')]);await f.a.run('command',f.d);
 expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0]).toBe('tree across track');expect(f.d.draft()).toBe('unsent');
});
test.each([heard('no'),heard('yes',.3),{...heard('yes'),alternatives:['no']},heard('cancel')])('no reliable confirmation never sends: %j',async answer=>{
 const f=fixture([heard('send message'),heard('tree'),answer]);await f.a.run('command',f.d);expect(f.send).not.toHaveBeenCalled();
});
test('quick selection reuses library and rejects oversize',async()=>{
 const f=fixture([heard('send quick message'),heard('all clear'),heard('yes')]);await f.a.run('command',f.d);expect(f.send.mock.calls[0][0]).toBe('All clear');
 const g=fixture([heard('send message'),heard('🙂'.repeat(40)),heard('yes')]);await g.a.run('command',g.d);expect(g.send).not.toHaveBeenCalled();
});
test('permission denial and stale callback cannot mutate or transmit',async()=>{
 const f=fixture([heard('send message')]);jest.spyOn(f.adapter,'permission').mockResolvedValue(false);await f.a.run('command',f.d);expect(f.adapter.recognize).not.toHaveBeenCalled();
 const g=fixture([]);let resolve!:(r:Recognition)=>void;jest.spyOn(g.adapter,'recognize').mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const running=g.a.run('dictation',g.d);await Promise.resolve();await g.a.cancel(true);resolve(heard('stale'));await running;expect(g.d.draft()).toBe('unsent');
});
test('destination replacement during dialogue and received command injection cannot transmit',async()=>{
 const f=fixture([heard('send message'),heard('tree'),heard('yes')]);jest.spyOn(f.adapter,'speak').mockImplementation(async()=>{f.change();});await f.a.run('command',f.d);expect(f.send).not.toHaveBeenCalled();
 const g=fixture([heard('read last message')]);await g.a.run('command',g.d);expect(g.adapter.speak).toHaveBeenCalledWith('send message');expect(g.send).not.toHaveBeenCalled();
});
test('location disclosure remains disabled; local GPS readings reject stale simulated and future fixes',async()=>{
 const f=fixture([heard('send coordinates')]);await f.a.run('command',f.d);expect(f.send).not.toHaveBeenCalled();
 const fix={latitude:-37,longitude:145,timestampMs:1000,accuracyMeters:10,speedKmh:12,headingDegrees:90};
 expect(localGpsReading('speed',fix,true,true,1100)).toContain('12 kilometres');
 for(const reading of [localGpsReading('speed',fix,false,true,1100),localGpsReading('speed',fix,true,false,1100),localGpsReading('speed',fix,true,true,999),localGpsReading('heading',fix,true,true,20000)])expect(reading).toContain('unavailable');
});

test('explicit single-use quick grant is exact, scoped and never applies to arbitrary dictation',async()=>{
 const f=fixture([heard('send quick message'),heard('all clear')]);
 expect(f.a.armQuickMessage(f.d,'All clear')).toBe(true);
 await f.a.run('command',f.d);expect(f.send).toHaveBeenCalledTimes(1);expect(f.a.isQuickArmed(f.d.key)).toBe(false);
 const g=fixture([heard('send message'),heard('arbitrary'),heard('no')]);expect(g.a.armQuickMessage(g.d,'All clear')).toBe(true);await g.a.run('command',g.d);expect(g.send).not.toHaveBeenCalled();
 const h=fixture([heard('send quick message'),heard('all clear',.8),heard('no')]);expect(h.a.armQuickMessage(h.d,'All clear')).toBe(true);await h.a.run('command',h.d);expect(h.send).not.toHaveBeenCalled();
});
test('uncertain submission is never retried and spoken failure cannot convert acceptance into another send',async()=>{
 const f=fixture([heard('send message'),heard('tree'),heard('yes')]);
 f.send.mockResolvedValue('Radio acceptance uncertain. Do not resend automatically.');
 await f.a.run('command',f.d);expect(f.send).toHaveBeenCalledTimes(1);expect(f.a.snapshot().detail).toContain('uncertain');
});

test('failed spoken outcome preserves uncertain submission and never retries',async()=>{
 const f=fixture([heard('send message'),heard('tree'),heard('yes')]);
 f.send.mockResolvedValue('Radio acceptance uncertain. Do not resend automatically.');
 jest.spyOn(f.adapter,'speak').mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Offline speech unavailable.'));
 await f.a.run('command',f.d);expect(f.send).toHaveBeenCalledTimes(1);expect(f.a.snapshot().detail).toContain('Radio acceptance uncertain. Do not resend automatically.');expect(f.a.snapshot().detail).toContain('readback');
});

test('held recognition excludes dialogue and readback, previews without editing, then appends only final text',async()=>{
 const f=fixture([heard('send message')]);
 let resolve!:(result:Recognition|null)=>void;
 const result=new Promise<Recognition|null>(done=>{resolve=done;});
 let preview!:(text:string)=>void;
 const held:HeldVoiceAdapter={press:jest.fn(partial=>{preview=partial;return result;}),release:jest.fn(async()=>true),cancel:jest.fn(async()=>true)};
 const controller=new VoiceAssistant(f.adapter,held);
 const running=controller.runHeld(f.d);
 preview('send message');
 expect(controller.snapshot().transcript).toBe('send message');
 expect(f.d.draft()).toBe('unsent');
 await controller.run('command',f.d);
 await controller.readText('readback',f.d);
 expect(f.adapter.recognize).not.toHaveBeenCalled();expect(f.adapter.speak).not.toHaveBeenCalled();
 await controller.releaseHeld('other-key');expect(held.release).not.toHaveBeenCalled();
 await controller.releaseHeld(f.d.key);await controller.releaseHeld(f.d.key);
 expect(held.release).toHaveBeenCalledTimes(1);
 resolve(heard('final'));await running;
 expect(f.d.draft()).toBe('unsent final');expect(f.send).not.toHaveBeenCalled();
});

test('held capture cannot start while a command is awaiting recognition; scoped cancel rejects late held text',async()=>{
 const f=fixture([]);
 let finishCommand!:(result:Recognition)=>void;
 jest.spyOn(f.adapter,'recognize').mockImplementation(()=>new Promise(done=>{finishCommand=done;}));
 let resolve!:(result:Recognition|null)=>void;
 const result=new Promise<Recognition|null>(done=>{resolve=done;});
 let preview!:(text:string)=>void;
 const held:HeldVoiceAdapter={press:jest.fn(partial=>{preview=partial;return result;}),release:jest.fn(async()=>true),cancel:jest.fn(async()=>true)};
 const controller=new VoiceAssistant(f.adapter,held);
 const command=controller.run('command',f.d);await Promise.resolve();
 await controller.runHeld(f.d);expect(held.press).not.toHaveBeenCalled();
 finishCommand(heard('cancel'));await command;
 const running=controller.runHeld(f.d);
 await controller.cancel(true);
 preview('stale');expect(controller.snapshot().transcript).toBeUndefined();
 resolve(heard('stale final'));await running;
 expect(held.cancel).toHaveBeenCalledTimes(1);expect(f.adapter.cancel).not.toHaveBeenCalled();
 expect(f.d.draft()).toBe('unsent');expect(f.send).not.toHaveBeenCalled();
});

test('held result for a replaced destination is discarded even before UI cancellation',async()=>{
 const f=fixture([]);
 let resolve!:(result:Recognition|null)=>void;
 let eligible!:()=>boolean;
 const held:HeldVoiceAdapter={press:jest.fn((_partial,_phase,guard)=>{eligible=guard;return new Promise(done=>{resolve=done;});}),release:jest.fn(async()=>true),cancel:jest.fn(async()=>true)};
 const controller=new VoiceAssistant(f.adapter,held);
 const running=controller.runHeld(f.d);
 expect(eligible()).toBe(true);f.change();expect(eligible()).toBe(false);
 resolve(heard('wrong conversation'));await running;
 expect(f.d.draft()).toBe('unsent');expect(f.send).not.toHaveBeenCalled();
});

test('composer-scoped cancellation cannot cancel a settings-owned finite test; stale phase and transcript are fenced',async()=>{
 const f=fixture([]);
 let complete!:(r:Recognition)=>void;
 let progress:((p:'starting'|'listening'|'finishing')=>void)|undefined;
 jest.spyOn(f.adapter,'recognize').mockImplementation(onPhase=>{
  progress=onPhase;return new Promise(resolve=>{complete=resolve;});
 });
 const running=f.a.run('dictation',f.d);
 await Promise.resolve();
 await f.a.cancelDestination('different-composer',true);
 expect(f.adapter.cancel).not.toHaveBeenCalled();
 progress?.('finishing');
 expect(f.a.snapshot().detail).toContain('Processing offline speech');
 await f.a.cancelDestination(f.d.key);
 const cancelled=f.a.snapshot();
 progress?.('listening');
 complete(heard('late transcript'));
 await running;
 expect(f.a.snapshot()).toEqual(cancelled);
 expect(f.d.draft()).toBe('unsent');
});
