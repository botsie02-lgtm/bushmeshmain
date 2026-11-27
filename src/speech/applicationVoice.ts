import {AppState, PermissionsAndroid,Platform} from 'react-native';
import {nativeSpeechRecognition} from '../native/NativeSpeechRecognition';
import {nativeSpeech} from '../native/NativeSpeech';
import {VoiceAssistant} from './VoiceAssistant';
import {HoldToTalk} from './HoldToTalk';

let recognitionLocale='en-AU';
export const applicationVoice=new VoiceAssistant({
 permission:async()=>{
  if(Platform.OS!=='android'||!nativeSpeechRecognition.isSupported()||!(await nativeSpeechRecognition.getStatus()).supported)return false;
  // Finish all asynchronous settings work before the controller rechecks
  // its token and issues the synchronous native recognition request.
  recognitionLocale=(await nativeSpeech.getStatus()).recognitionLocale??'en-AU';
  const p=PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  return await PermissionsAndroid.check(p)||await PermissionsAndroid.request(p)===PermissionsAndroid.RESULTS.GRANTED;
 },
 recognize:()=>nativeSpeechRecognition.recognizeOnce(recognitionLocale),
 cancel:()=>nativeSpeechRecognition.cancel(),
 stopListening:()=>nativeSpeechRecognition.stopListening(),
 speak:async text=>{if(!await nativeSpeech.speakOrdinaryAndWait(text))throw new Error('Offline speech unavailable.');},
 stopSpeech:()=>nativeSpeech.stopOrdinary(),
});
// Separate held-text adapter for the composer integration worker. Neither
// activation nor completion calls VoiceDestination.send.
export const applicationHoldToTalk = new HoldToTalk({
  permission: async () => {
    if (Platform.OS !== 'android' || !nativeSpeechRecognition.supportsHeldRecognition() ||
        !(await nativeSpeechRecognition.getStatus()).supported) {
      return false;
    }
    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    return await PermissionsAndroid.check(permission) ||
      await PermissionsAndroid.request(permission) === PermissionsAndroid.RESULTS.GRANTED;
  },
  recognize: (locale, requestId) => nativeSpeechRecognition.recognizeHeld(locale, requestId),
  finish: (requestId, cancel) => nativeSpeechRecognition.finishHeld(requestId, cancel),
  subscribePartial: listener => nativeSpeechRecognition.subscribeHeldPartial(listener),
});

// Permission dialogs may transition through inactive; native recognition
// checks actual host lifecycle before starting. Background always cancels.
AppState.addEventListener('change', state => {
  if (state === 'background') {
    applicationVoice.cancel(true).catch(() => undefined);
    applicationHoldToTalk.cancel().catch(() => undefined);
  }
});
