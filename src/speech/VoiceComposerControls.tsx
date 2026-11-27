import React, {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {Alert, AppState, Keyboard, PermissionsAndroid, Platform, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {nativeSpeechRecognition} from '../native/NativeSpeechRecognition';
import {nativeSpeech} from '../native/NativeSpeech';
import {colors} from '../theme/colors';
import {RadioMessagingNavigationContext} from '../app/shell/RadioMessagingNavigation';

export type DictationDestination = {
  key: string;
  isCurrent: () => boolean;
  draft: () => string;
  editDraft: (value: string) => void;
};
type Phase = 'idle' | 'permission' | 'starting' | 'listening' | 'processing' | 'review' | 'error';
type State = {phase: Phase; detail: string; level: number | null; transcript: string};
type Turn = {
  id: string; destination: DictationDestination; phase: Phase; started: boolean;
  confirmed: boolean; result: string | null;
};
const idle: State = {phase: 'idle', detail: '', level: null, transcript: ''};
let nextTurn = 0;
const prefix = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

/** One explicit, finite, on-device recognition request. No transport or
 * command port. Android may end recognition early; only an explicit tick
 * can commit the final result. The draft is never changed by partials. */
export function useDictation(destination: DictationDestination | undefined, visible: boolean, disabled = false) {
  const [state, setState] = useState<State>(idle);
  const turn = useRef<Turn | null>(null);
  const live = useRef({destination, visible, disabled});
  live.current = {destination, visible, disabled};
  const current = useCallback((t: Turn) => turn.current === t &&
    live.current.destination?.key === t.destination.key && t.destination.isCurrent() &&
    !live.current.disabled && AppState.currentState !== 'background' &&
    (live.current.visible || (t.phase === 'permission' && AppState.currentState === 'inactive')), []);
  const cancel = useCallback((render = true) => {
    const t = turn.current;
    turn.current = null;
    if (t?.started) nativeSpeechRecognition.finishHeld(t.id, true).catch(() => undefined);
    if (render) setState(idle);
  }, []);
  const fail = (t: Turn, detail: string) => {
    if (turn.current !== t) return;
    turn.current = null;
    if (t.started) nativeSpeechRecognition.finishHeld(t.id, true).catch(() => undefined);
    setState({...idle, phase: 'error', detail});
  };
  const commit = (t: Turn) => {
    if (!current(t) || !live.current.visible || AppState.currentState !== 'active' || !t.confirmed || !t.result) return;
    const previous = t.destination.draft();
    const next = previous + (previous && !/\s$/.test(previous) ? ' ' : '') + t.result;
    if (next.length > 512) {
      fail(t, 'Dictation is too long for this draft. Original text retained; try a shorter phrase.');
      return;
    }
    turn.current = null;
    t.destination.editDraft(next);
    setState({...idle, detail: 'Dictation added. Review before sending.'});
  };
  useEffect(() => {
    if (turn.current && !current(turn.current)) cancel();
  }, [visible, disabled, destination?.key, state.phase, current, cancel]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', value => {
      if (value === 'background' || (value === 'inactive' && turn.current?.phase !== 'permission')) cancel();
    });
    return () => {sub.remove(); cancel(false);};
  }, [cancel]);
  const start = async () => {
    const d = live.current.destination;
    if (turn.current || !d || !d.isCurrent() || !live.current.visible || live.current.disabled ||
        AppState.currentState !== 'active') return;
    Keyboard.dismiss();
    const t: Turn = {id: 'dictation-' + prefix + '-' + ++nextTurn, destination: d,
      phase: 'permission', started: false, confirmed: false, result: null};
    turn.current = t;
    setState({...idle, phase: 'permission', detail: 'Checking microphone…'});
    let unsubscribeState: (() => void) | undefined;
    let unsubscribeLevel: (() => void) | undefined;
    try {
      if (Platform.OS !== 'android' || !nativeSpeechRecognition.supportsHeldRecognition() ||
          !(await nativeSpeechRecognition.getStatus()).supported) {
        throw new Error('On-device recognition unavailable. Check speech-to-text setup.');
      }
      if (!current(t)) return;
      const locale = (await nativeSpeech.getStatus()).recognitionLocale ?? 'en-AU';
      if (!current(t)) return;
      const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
      const granted = await PermissionsAndroid.check(permission);
      if (!current(t)) return;
      if (!granted && await PermissionsAndroid.request(permission) !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error('Microphone permission denied. Enable it in app settings.');
      }
      if (!current(t) || AppState.currentState !== 'active') return;
      t.phase = 'starting';
      setState({...idle, phase: 'starting', detail: 'Starting offline recognition…'});
      unsubscribeState = nativeSpeechRecognition.subscribeSessionState(status => {
        if (!current(t) || status.requestId !== t.id) return;
        if (status.phase === 'listening' && t.phase === 'starting') {
          t.phase = 'listening';
          setState({...idle, phase: 'listening', detail: 'Listening…'});
        } else if (status.phase === 'finishing' && t.phase !== 'review') {
          t.phase = 'processing';
          setState({...idle, phase: 'processing', detail: 'Processing speech…'});
        }
      });
      unsubscribeLevel = nativeSpeechRecognition.subscribeAudioLevel(sample => {
        if (current(t) && sample.requestId === t.id && t.phase === 'listening' && Number.isFinite(sample.rmsDb)) {
          setState(s => ({...s, level: Math.max(0, Math.min(1, (sample.rmsDb + 2) / 14))}));
        }
      });
      t.started = true;
      const result = await nativeSpeechRecognition.recognizeHeld(locale, t.id);
      if (!current(t)) return;
      t.started = false;
      const text = result.text.trim();
      if (!text) {fail(t, 'No speech recognised. Original draft retained.'); return;}
      t.result = text;
      if (t.confirmed) commit(t);
      else {
        t.phase = 'review';
        setState({...idle, phase: 'review', transcript: text, detail: 'Speech ready · tap ✓ to add'});
      }
    } catch (error) {
      if (current(t)) fail(t, error instanceof Error ? error.message : 'Offline recognition failed. Original draft retained.');
    } finally {
      unsubscribeState?.();
      unsubscribeLevel?.();
      if (turn.current === t && (!current(t) || (t.phase === 'permission' && !t.started))) cancel();
    }
  };
  const confirm = async () => {
    const t = turn.current;
    if (!t || !current(t) || AppState.currentState !== 'active' || t.confirmed ||
        !['listening', 'processing', 'review'].includes(t.phase)) return;
    t.confirmed = true;
    if (t.result) {commit(t); return;}
    const needsStop = t.phase === 'listening';
    t.phase = 'processing';
    setState({...idle, phase: 'processing', detail: 'Processing speech…'});
    if (needsStop) {
      try {
        // A false acknowledgement can mean the recognizer already completed;
        // its scoped result or failure is still the authoritative outcome.
        await nativeSpeechRecognition.finishHeld(t.id, false);
      } catch {
        fail(t, 'Recognition could not finish. Original draft retained.');
      }
    }
  };
  return {state, start, confirm, cancel: () => cancel(), active: !['idle', 'error'].includes(state.phase),
    canConfirm: ['listening', 'processing', 'review'].includes(state.phase) && !turn.current?.confirmed,
    supported: nativeSpeechRecognition.supportsHeldRecognition()};
}
export type Dictation = ReturnType<typeof useDictation>;

export function DictationButton({dictation, disabled}: {dictation: Dictation; disabled: boolean}) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dictate message"
    accessibilityHint="Start offline dictation. Review before sending." disabled={disabled}
    accessibilityState={{disabled}} onPress={() => {dictation.start().catch(() => undefined);}}
    style={[styles.button, disabled && styles.disabled]}>
    <View style={styles.micIcon}><View style={styles.micCapsule}/><View style={styles.micCradle}/><View style={styles.micStem}/></View>
  </TouchableOpacity>;
}

export function DictationRecordingControls({dictation}: {dictation: Dictation}) {
  const {state} = dictation;
  return <View style={styles.recording} testID="radio-dictation-recording">
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel dictation" onPress={dictation.cancel} style={styles.button}>
      <Text style={styles.symbol}>×</Text>
    </TouchableOpacity>
    <View style={styles.middle}>
      {state.phase === 'listening' && <View accessibilityLabel={state.level === null ? 'Audio level unavailable' : 'Live microphone activity'} style={styles.meter}>
        {[.4,.65,.9,1,.9,.65,.4].map((weight,i) => <View key={i} style={[styles.bar, {height: 4 + 22 * weight * (state.level ?? 0)}]}/>)}
      </View>}
      <Text accessibilityLiveRegion="polite" style={styles.detail}>{state.detail}</Text>
      {!!state.transcript && <Text numberOfLines={2} style={styles.detail}>{state.transcript}</Text>}
    </View>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Confirm dictation" disabled={!dictation.canConfirm}
      accessibilityState={{disabled: !dictation.canConfirm}} onPress={() => {dictation.confirm().catch(() => undefined);}}
      style={[styles.button, !dictation.canConfirm && styles.disabled]}>
      <Text style={styles.symbol}>✓</Text>
    </TouchableOpacity>
  </View>;
}

export function DictationFeedback({dictation}: {dictation: Dictation}) {
  const navigation = useContext(RadioMessagingNavigationContext);
  if (dictation.active || !dictation.state.detail) return null;
  return <View>
    <Text accessibilityLiveRegion="polite" style={styles.detail}>{dictation.state.detail}</Text>
    {dictation.state.phase === 'error' && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Speech-to-text setup"
      onPress={() => {
        if (navigation?.openVoiceReadiness) navigation.openVoiceReadiness();
        else Alert.alert('Offline speech-to-text', 'Open Radio messaging settings, select an installed offline language and test recognition.',
          navigation ? [{text:'Cancel', style:'cancel'}, {text:'Open settings', onPress:navigation.openMessagingSettings}] : [{text:'OK'}]);
      }} style={styles.button}><Text style={styles.detail}>Speech-to-text setup</Text></TouchableOpacity>}
  </View>;
}

const styles = StyleSheet.create({
  button: {width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center'},
  disabled: {opacity: .35}, symbol: {color: colors.accent, fontSize: 27, fontWeight: '700'},
  micIcon: {width: 24, height: 29, alignItems: 'center', justifyContent: 'center'},
  micCapsule: {width: 10, height: 17, borderRadius: 5, backgroundColor: colors.accent, position: 'absolute', top: 1},
  micCradle: {width: 19, height: 14, borderWidth: 2, borderTopWidth: 0, borderColor: colors.accent,
    borderBottomLeftRadius: 10, borderBottomRightRadius: 10, position: 'absolute', top: 10},
  micStem: {height: 5, width: 2, backgroundColor: colors.accent, position: 'absolute', top: 23},
  recording: {flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 54, borderRadius: 22, backgroundColor: colors.surfaceSoft},
  middle: {flex: 1, alignItems: 'center', paddingVertical: 4},
  meter: {height: 28, flexDirection: 'row', alignItems: 'center', gap: 4},
  bar: {width: 3, borderRadius: 2, backgroundColor: colors.accent},
  detail: {color: colors.textSecondary, fontSize: 12, textAlign: 'center', paddingHorizontal: 4},
});
