import React,{useEffect,useSyncExternalStore} from 'react';
import {Alert,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {applicationVoice} from './applicationVoice';
import {nativeSpeechRecognition} from '../native/NativeSpeechRecognition';
import {nativeSpeech} from '../native/NativeSpeech';
import type {VoiceDestination} from './VoiceAssistant';
import {colors} from '../theme/colors';
export function VoiceComposerControls({destination,visible,disabled}:{destination:VoiceDestination;visible:boolean;disabled:boolean}){
 const state=useSyncExternalStore(applicationVoice.subscribe,applicationVoice.snapshot);
 const active=!['idle','error','suspended'].includes(state.phase);
 const key=destination.key;
 const armed=applicationVoice.isQuickArmed(key);
 useEffect(()=>()=>{applicationVoice.cancel(true).catch(()=>undefined);},[key]);
 useEffect(()=>{if(!visible&&state.phase!=='permission')applicationVoice.cancel(true).catch(()=>undefined);},[visible,state.phase]);
 if(!visible||(!nativeSpeechRecognition.isSupported()&&!nativeSpeech.isSupported()))return null;
 const action=(label:string,text:string,run:()=>void,off=false)=><TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={off} style={[styles.button,off&&styles.disabled]} onPress={run}><Text style={styles.label}>{text}</Text></TouchableOpacity>;
 return <View>
  <View style={styles.row}>
   {nativeSpeechRecognition.isSupported()&&action('Dictate message','🎙 Dictate',()=>{applicationVoice.run('dictation',destination).catch(()=>undefined);},disabled||active)}
   {nativeSpeechRecognition.isSupported()&&action('Voice command','Command',()=>{applicationVoice.run('command',destination).catch(()=>undefined);},disabled||active)}
   {nativeSpeech.isSupported()&&action('Read latest message','🔊 Read',()=>{const text=destination.latest();if(text)applicationVoice.readText(text,destination).catch(()=>undefined);},active||!destination.latest())}
   {nativeSpeech.isSupported()&&action('Stop ordinary speech','Stop',()=>{nativeSpeech.stopOrdinary().catch(()=>undefined);})}
   {destination.send&&!active&&nativeSpeechRecognition.isSupported()&&action('Voice quick send policy',armed?'Disarm quick send':'Quick send policy',()=>{
     if(armed){applicationVoice.cancel().catch(()=>undefined);return;}
     const choices=destination.quick().slice(0,2);
     Alert.alert('One-command quick send','Choose one of the first two saved phrases to transmit without another spoken yes on the next voice command only. Destination: '+destination.label+'. Ordinary dictation and all other sends still require confirmation.',[{text:'Cancel',style:'cancel'},...choices.map(text=>({text,onPress:()=>{applicationVoice.armQuickMessage(destination,text);}}))]);
   })}
  </View>
  {armed&&<Text style={styles.detail}>One-command quick send armed · this chat only</Text>}
  {active||state.detail?<Text accessibilityLiveRegion="polite" style={styles.detail}>{state.detail}{state.transcript?' · '+state.transcript:''}</Text>:null}
  {active&&<View style={styles.row}>{['listening','dictating','confirming'].includes(state.phase)&&action('Finish recognition','Finish',()=>{applicationVoice.stopListening().catch(()=>undefined);})}{action('Cancel voice session','Cancel',()=>{applicationVoice.cancel().catch(()=>undefined);})}</View>}
 </View>;
}
const styles=StyleSheet.create({row:{flexDirection:'row',flexWrap:'wrap',gap:4},button:{minHeight:44,paddingHorizontal:9,justifyContent:'center'},label:{color:colors.accent,fontWeight:'600'},disabled:{opacity:0.4},detail:{color:colors.textSecondary,fontSize:12,paddingHorizontal:8}});
