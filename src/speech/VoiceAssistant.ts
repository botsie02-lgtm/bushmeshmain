import {validateCarrierText} from '../screens/radioMessenger/messengerModel';

export type Recognition = {text:string;confidence:number;alternatives?:readonly string[]};
export type VoiceState = {phase:'idle'|'permission'|'listening'|'interpreting'|'dictating'|'confirming'|'speaking'|'executing'|'error'|'suspended'; detail:string; transcript?:string};
export type VoiceCommand = 'send'|'quick'|'last'|'unread'|'repeat'|'stop'|'cancel'|'radio'|'location'|'speed'|'heading';
const normalize=(text:string)=>text.toLowerCase().trim().replace(/[.!?]+$/,'').replace(/\s+/g,' ').replace(/^hey bushmesh,? /,'');
const commands:Record<string,VoiceCommand>={
 'send message':'send','send a message':'send','send quick message':'quick','send a quick message':'quick',
 'read last message':'last','read latest message':'last','read unread messages':'unread','repeat':'repeat',
 'stop reading':'stop','cancel':'cancel','stop listening':'cancel','radio check':'radio',
 'send coordinates':'location','send location':'location','what is my speed':'speed',"what's my speed":'speed',
 'what is my heading':'heading',"what's my heading":'heading',
};
export function parseVoiceCommand(result:Recognition):VoiceCommand|null {
 const key=normalize(result.text);
 const command=Object.prototype.hasOwnProperty.call(commands,key)?commands[key]:null;
 if(!command || !Number.isFinite(result.confidence) || (result.confidence<0.65||result.confidence>1)) return null;
 if(result.alternatives?.some(value=>commands[normalize(value)]!==command)) return null;
 return command;
}
export function appendDictation(draft:string,text:string){return draft+(draft&&!/\s$/.test(draft)?' ':'')+text.trim();}
export function matchQuickMessage(text:string,values:readonly string[]):string|null{
 const matches=values.filter(v=>normalize(v)===normalize(text));
 return matches.length===1?matches[0]:null;
}
export type VoiceDestination={
 /** An immutable full scope + session epoch, never a slot/name alone. */
 key:string; label:string; isCurrent:()=>boolean; draft:()=>string; editDraft:(value:string)=>void;
 send?:(text:string,stillCurrent:()=>boolean)=>Promise<string>;
 latest:()=>string|null; unread:()=>readonly string[]; quick:()=>readonly string[];
 radio:()=>string; localReading?:(command:'speed'|'heading')=>Promise<string>;
};
export type VoiceAdapter={permission:()=>Promise<boolean>;recognize:()=>Promise<Recognition>;cancel:()=>Promise<unknown>;stopListening:()=>Promise<unknown>;speak:(text:string)=>Promise<unknown>;stopSpeech:()=>Promise<unknown>};
/** Application-owned, single finite dialogue. Received text only reaches speak,
 * never the command parser. No automatic or background activation. */
export class VoiceAssistant {
 private sequence=0;
 private active=false;
 private listeners=new Set<()=>void>();
 private state:VoiceState={phase:'idle',detail:''};
 private last:{key:string;text:string}|null=null;
 private cancelling=false;
 private transmitting=false;
 private quickGrant:{key:string;text:string}|null=null;
 armQuickMessage(d:VoiceDestination,text:string):boolean {
  if(this.active||!d.isCurrent()||!d.send||!validateCarrierText(text).valid||matchQuickMessage(text,d.quick())!==text)return false;
  this.quickGrant={key:d.key,text};this.set({phase:'idle',detail:'One automatic quick message armed for '+d.label+'.'});return true;
 }
 disarmQuickMessage(){this.quickGrant=null;}
 isQuickArmed(key:string){return this.quickGrant?.key===key;}
 constructor(private readonly adapter:VoiceAdapter){}
 snapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private set(state:VoiceState){this.state=state;this.listeners.forEach(f=>f());}
 private valid(token:number,d:VoiceDestination){return token===this.sequence&&d.isCurrent();}
 async cancel(suspended=false){
  this.disarmQuickMessage();
  this.last=null;
  if(!this.active||this.cancelling){if(!this.active)this.set({phase:suspended?'suspended':'idle',detail:''});return;}
  this.cancelling=true;
  ++this.sequence; this.set({phase:suspended?'suspended':'idle',detail:this.transmitting?'Further voice turns cancelled. Check the submission outcome in history.':suspended?'Voice session suspended.':'Cancelled.'});
  // Keep ownership until the native cancellation has completed.
  await Promise.allSettled([this.adapter.cancel(),this.adapter.stopSpeech()]);
  this.cancelling=false;
  if(!this.transmitting)this.active=false;
 }
 stopListening=()=>this.adapter.stopListening();
 async run(mode:'dictation'|'command',d:VoiceDestination){
  if(this.active||!d.isCurrent())return;
  this.active=true;const token=++this.sequence;
  const grant=this.quickGrant;
  this.disarmQuickMessage(); // one explicit command invocation only
  const check=()=>{if(!this.valid(token,d))throw new Error('Voice destination changed.');};
  const listen=async(phase:VoiceState['phase'],detail:string)=>{check();this.set({phase,detail});const r=await this.adapter.recognize();check();if(!r.text.trim())throw new Error('No speech recognized.');return r;};
  const say=async(text:string)=>{check();this.set({phase:'speaking',detail:text});await this.adapter.speak(text);check();};
  const read=async(text:string)=>{this.last={key:d.key,text};await say(text);};
  try{
   this.set({phase:'permission',detail:'Checking microphone permission…'});
   if(!await this.adapter.permission())throw new Error('Microphone permission denied.');
   check();
   const result=await listen('listening',mode==='dictation'?'Listening for message…':'Listening for command…');
   if(mode==='dictation'){
    d.editDraft(appendDictation(d.draft(),result.text));this.set({phase:'idle',detail:'Dictation added. Review before sending.'});return;
   }
   const command=parseVoiceCommand(result);
   this.set({phase:'interpreting',detail:command?'Command recognized.':'Uncertain command. Nothing sent.',transcript:result.text});
   if(!command)throw new Error('Unknown or uncertain command. Nothing sent.');
   if(command==='cancel'||command==='stop'){await this.adapter.stopSpeech();this.set({phase:'idle',detail:'Stopped.'});return;}
   if(command==='last'||command==='unread'||command==='repeat'){
    const values=command==='last'?[d.latest()]:command==='unread'?d.unread():[this.last?.key===d.key?this.last.text:null];
    const usable=values.filter((value):value is string=>!!value);
    // Bounded playback per explicit request, never mark read here.
    for(const value of usable.slice(0,10))await read(value);
    if(!usable.length)await say('No messages available.');
   }else if(command==='radio')await say(d.radio());
   else if(command==='location')await say('Voice location sharing is unavailable under the current location disclosure policy.');
   else if(command==='speed'||command==='heading')await say(d.localReading?await d.localReading(command):'Current GPS reading unavailable.');
   else {
    if(!d.send)throw new Error('Verified destination unavailable. Nothing sent.');
    let text='';
    for(let attempt=0;attempt<3;attempt++){
     await say(command==='quick'?'Say the exact saved quick message.':'What would you like to say?');
     const dictated=await listen('dictating','Listening for message…');
     text=command==='quick'?matchQuickMessage(dictated.text,d.quick())??'':dictated.text.trim();
     if(!text||!validateCarrierText(text).valid)throw new Error('Message unavailable or exceeds 133 UTF-8 bytes. Nothing sent.');
     const auto=command==='quick'&&grant?.key===d.key&&grant.text===text&&Number.isFinite(dictated.confidence)&&dictated.confidence>=0.9&&dictated.confidence<=1&&result.confidence>=0.9&&result.confidence<=1&&!dictated.alternatives?.some(v=>matchQuickMessage(v,d.quick())!==text);
     if(!auto){
      await say('Send to '+d.label+'? '+text+'. Say yes, no, cancel, or dictate again.');
      const confirmation=await listen('confirming','Confirm sending to '+d.label+' · '+text);
      const answer=normalize(confirmation.text);
      const reliable=Number.isFinite(confirmation.confidence)&&confirmation.confidence>=0.8&&confirmation.confidence<=1&&!confirmation.alternatives?.some(v=>normalize(v)!==answer);
      if(reliable&&answer==='dictate again')continue;
      if(!reliable||answer!=='yes'){this.set({phase:'idle',detail:'Not confirmed. Nothing sent.'});return;}
     }
     check();this.set({phase:'executing',detail:'Submitting verified message…'});
     this.transmitting=true;
     let outcome:string;
     try{outcome=await d.send(text,()=>this.valid(token,d)&&(!auto||matchQuickMessage(text,d.quick())===text));}finally{this.transmitting=false;if(token!==this.sequence&&!this.cancelling)this.active=false;}
     if(this.valid(token,d)){this.set({phase:'speaking',detail:outcome});await this.adapter.speak(outcome);check();this.set({phase:'idle',detail:outcome});}
     return;
    }
    throw new Error('Confirmation attempts exhausted. Nothing sent.');
   }
   check();this.set({phase:'idle',detail:'Voice command finished.'});
  }catch(error){if(token===this.sequence)this.set({phase:'error',detail:error instanceof Error?error.message:'Voice command failed.'});}
  finally{if(token===this.sequence)this.active=false;}
 }
 async readSelection(kind:'unread'|'repeat',d:VoiceDestination){
  if(this.active||!d.isCurrent())return;
  const values=kind==='unread'?d.unread().slice(0,10):this.last?.key===d.key?[this.last.text]:[];
  if(!values.length){this.set({phase:'idle',detail:'No messages available.'});return;}
  await this.readText(values.join('. Next message. '),d);
 }
 async readText(text:string,d:VoiceDestination){
  if(this.active||!d.isCurrent()||!text.trim())return;
  this.active=true;const token=++this.sequence;
  try{this.last={key:d.key,text};this.set({phase:'speaking',detail:'Reading message aloud…'});await this.adapter.speak(text);if(this.valid(token,d))this.set({phase:'idle',detail:''});}
  catch{if(token===this.sequence)this.set({phase:'error',detail:'Offline speech unavailable or interrupted.'});}
  finally{if(token===this.sequence)this.active=false;}
 }
}
