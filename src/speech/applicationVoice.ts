import {AppState, PermissionsAndroid,Platform} from 'react-native';
import {nativeSpeechRecognition} from '../native/NativeSpeechRecognition';
import {nativeSpeech} from '../native/NativeSpeech';
import {VoiceAssistant} from './VoiceAssistant';

export const applicationVoice=new VoiceAssistant({
 permission:async()=>{
  if(Platform.OS!=='android'||!nativeSpeechRecognition.isSupported()||!(await nativeSpeechRecognition.getStatus()).supported)return false;
  const p=PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  return await PermissionsAndroid.check(p)||await PermissionsAndroid.request(p)===PermissionsAndroid.RESULTS.GRANTED;
 },
 recognize:()=>nativeSpeechRecognition.recognizeOnce('en-AU'),
 cancel:()=>nativeSpeechRecognition.cancel(),
 stopListening:()=>nativeSpeechRecognition.stopListening(),
 speak:async text=>{if(!await nativeSpeech.speakOrdinaryAndWait(text))throw new Error('Offline speech unavailable.');},
 stopSpeech:()=>nativeSpeech.stopOrdinary(),
});
// Permission dialogs may transition through inactive; native recognition
// checks actual host lifecycle before starting. Background always cancels.
AppState.addEventListener('change',state=>{if(state==='background')applicationVoice.cancel(true).catch(()=>undefined);});
