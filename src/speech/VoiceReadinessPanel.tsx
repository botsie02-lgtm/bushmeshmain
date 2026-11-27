import React,{useEffect,useState} from 'react';
import {Text,View,TouchableOpacity,StyleSheet,Linking} from 'react-native';
import {nativeSpeechRecognition} from '../native/NativeSpeechRecognition';
import {nativeSpeech,type VoicePreferences} from '../native/NativeSpeech';
import {colors} from '../theme/colors';
import {useSpeech} from '../state/SpeechContext';
export function VoiceReadinessPanel(){
 const speech=useSpeech();
 const [status,setStatus]=useState('Checking local speech…');
 const [prefs,setPrefs]=useState<VoicePreferences|null>(null);
 const [busy,setBusy]=useState(false);
 const [showVoices,setShowVoices]=useState(false);
 const refresh=async()=>{try{
  const [r,s,p]=await Promise.all([nativeSpeechRecognition.getStatus(),nativeSpeech.getStatus(),nativeSpeech.getVoicePreferences()]);
  setPrefs(p);
  await speech.refresh();
  const locale=p?.locale??'en-AU';
  const model=r.supported?await nativeSpeechRecognition.checkLanguage(locale):'unknown';
  setStatus((r.supported?'On-device recognizer available. '+locale+' model: '+(model==='installed'?'reported installed':model==='download-required'?'download required':'readiness unknown; test locally')+'.':r.reason??'Recognition unavailable.')+' '+(s.offlineVoice?'Offline voice: '+s.languageTag:'Offline English voice unavailable.')+' Wake phrase and screen-off listening unavailable.');
 }catch{setStatus('Speech status unavailable.');}};
 useEffect(()=>{refresh().catch(()=>undefined);},[]);
 const update=async(patch:Partial<Pick<VoicePreferences,'locale'|'voice'|'rate'>>)=>{if(!prefs||busy)return;setBusy(true);try{await nativeSpeech.setVoicePreferences({...prefs,...patch});await refresh();}catch{setStatus('Voice preference not saved. Stop speech and try again.');}finally{setBusy(false);}};
 const choice=(label:string,onPress:()=>void,selected=false)=><TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected,disabled:busy}} disabled={busy} onPress={onPress} style={styles.button}><Text style={[styles.text,selected&&styles.selected]}>{label}</Text></TouchableOpacity>;
 return <View><Text style={styles.text}>{status}</Text>
 {prefs&&<><Text style={styles.text}>Recognition language</Text><View style={styles.row}>{['en-AU','en-GB','en-US'].map(locale=>choice(locale,()=>{update({locale}).catch(()=>undefined);},prefs.locale===locale))}</View>
 <Text style={styles.text}>Speech rate</Text><View style={styles.row}>{[.85,1,1.15].map(rate=>choice(rate.toFixed(2)+'×',()=>{update({rate}).catch(()=>undefined);},Math.abs(prefs.rate-rate)<.01))}</View>
 {choice(showVoices?'Hide installed voices':'Choose installed offline voice',()=>setShowVoices(v=>!v))}
 {showVoices&&<>{choice('Automatic English voice',()=>{update({voice:null}).catch(()=>undefined);})}{prefs.voices.map(v=>choice(v.locale+' · '+v.name,()=>{update({voice:v.name}).catch(()=>undefined);},prefs.voice===v.name))}</>}
 {choice('Test offline speech',()=>{nativeSpeech.speakOrdinaryAndWait('BushMesh offline speech test.').catch(()=>setStatus('Offline speech test failed.'));})}</>}
 {choice('Refresh voice readiness',()=>{refresh().catch(()=>undefined);})}
 {choice('Open microphone and app settings',()=>{Linking.openSettings().catch(()=>setStatus('Open Android app settings manually.'));})}
 </View>;
}
const styles=StyleSheet.create({text:{color:colors.textSecondary,padding:8},row:{flexDirection:'row',flexWrap:'wrap'},button:{minHeight:44,justifyContent:'center'},selected:{color:colors.accent,fontWeight:'700'}});
