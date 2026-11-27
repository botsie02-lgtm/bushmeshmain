import React,{useEffect,useState} from 'react';
import {Text,View,TouchableOpacity,StyleSheet} from 'react-native';
import {nativeSpeechRecognition} from '../native/NativeSpeechRecognition';
import {nativeSpeech} from '../native/NativeSpeech';
import {colors} from '../theme/colors';
export function VoiceReadinessPanel(){
 const [status,setStatus]=useState('Checking local speech…');
 const refresh=async()=>{try{const [r,s]=await Promise.all([nativeSpeechRecognition.getStatus(),nativeSpeech.getStatus()]);setStatus((r.supported?'On-device recognizer available; en-AU model readiness requires a real recognition test.':r.reason??'Recognition unavailable.')+' '+(s.offlineVoice?'Offline English voice: '+s.languageTag:'Offline English voice unavailable.')+' Wake phrase and screen-off listening unavailable.');}catch{setStatus('Speech status unavailable.');}};
 useEffect(()=>{refresh().catch(()=>undefined);},[]);
 return <View><Text style={styles.text}>{status}</Text><TouchableOpacity accessibilityRole="button" onPress={()=>{refresh().catch(()=>undefined);}}><Text style={styles.text}>Refresh voice readiness</Text></TouchableOpacity></View>;
}
const styles=StyleSheet.create({text:{color:colors.textSecondary,padding:8}});
