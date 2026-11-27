import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Text, View, TouchableOpacity, StyleSheet, Linking} from 'react-native';
import {nativeSpeechRecognition} from '../native/NativeSpeechRecognition';
import {nativeSpeech, type VoicePreferences} from '../native/NativeSpeech';
import {colors} from '../theme/colors';
import {useSpeech} from '../state/SpeechContext';

export function VoiceReadinessPanel() {
  const {refresh: refreshSpeech, supported} = useSpeech();
  const [status, setStatus] = useState('Checking local speech…');
  const [prefs, setPrefs] = useState<VoicePreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [showVoices, setShowVoices] = useState(false);
  const lifecycle = useRef({generation: 0, mounted: false, busy: false});

  // Synchronous admission prevents double taps before React commits disabled.
  // All asynchronous UI changes are fenced to this effect's lifetime.
  const run = useCallback(async (action: (current: () => boolean) => Promise<void>) => {
    const owner = lifecycle.current;
    if (!owner.mounted || owner.busy) return;
    const generation = owner.generation;
    const current = () => owner.mounted && owner.generation === generation;
    owner.busy = true;
    setBusy(true);
    try {
      await action(current);
    } finally {
      if (current()) {
        owner.busy = false;
        setBusy(false);
      }
    }
  }, []);

  const refresh = useCallback(async (current: () => boolean, afterMutation = false) => {
    try {
      const [r, s, p] = await Promise.all([
        nativeSpeechRecognition.getStatus(),
        refreshSpeech(afterMutation),
        nativeSpeech.getVoicePreferences(),
      ]);
      if (!current()) return;
      const locale = p?.locale ?? 'en-AU';
      const model = r.supported ? await nativeSpeechRecognition.checkLanguage(locale) : 'unknown';
      if (!current()) return;
      setPrefs(p);
      setStatus((r.supported ? 'On-device recognizer available. ' + locale + ' model: ' +
        (model === 'installed' ? 'reported installed' : model === 'download-required' ? 'download required' : 'readiness unknown; test locally') + '.'
        : r.reason ?? 'Recognition unavailable.') + ' ' +
        (s?.offlineVoice ? 'Offline voice: ' + s.languageTag : supported && !s ? 'Offline voice status unavailable.' : 'Offline English voice unavailable.') +
        ' Wake phrase and screen-off listening unavailable.');
    } catch {
      if (current()) setStatus('Speech status unavailable.');
    }
  }, [refreshSpeech, supported]);

  useEffect(() => {
    const owner = lifecycle.current;
    owner.mounted = true;
    run(refresh).catch(() => undefined);
    return () => {
      owner.mounted = false;
      owner.generation++;
      owner.busy = false;
    };
  }, [refresh, run]);

  const update = (patch: Partial<Pick<VoicePreferences, 'locale' | 'voice' | 'rate'>>) => {
    if (!prefs) return;
    run(async current => {
      try {
        await nativeSpeech.setVoicePreferences({...prefs, ...patch});
        if (current()) await refresh(current, true);
      } catch {
        if (current()) setStatus('Voice preference not saved. Stop speech and try again.');
      }
    }).catch(() => undefined);
  };
  const choice = (label: string, onPress: () => void, selected = false) =>
    <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected, disabled: busy}} disabled={busy} onPress={onPress} style={styles.button}>
      <Text style={[styles.text, selected && styles.selected]}>{label}</Text>
    </TouchableOpacity>;

  return <View><Text style={styles.text}>{status}</Text>
    {prefs && <><Text style={styles.text}>Recognition language</Text><View style={styles.row}>{['en-AU', 'en-GB', 'en-US'].map(locale => choice(locale, () => update({locale}), prefs.locale === locale))}</View>
      <Text style={styles.text}>Speech rate</Text><View style={styles.row}>{[.85, 1, 1.15].map(rate => choice(rate.toFixed(2) + '×', () => update({rate}), Math.abs(prefs.rate - rate) < .01))}</View>
      {choice(showVoices ? 'Hide installed voices' : 'Choose installed offline voice', () => setShowVoices(v => !v))}
      {showVoices && <>{choice('Automatic English voice', () => update({voice: null}))}{prefs.voices.map(v => choice(v.locale + ' · ' + v.name, () => update({voice: v.name}), prefs.voice === v.name))}</>}
      {choice('Test offline speech', () => {
        run(async current => {
          try {
            if (!await nativeSpeech.speakOrdinaryAndWait('BushMesh offline speech test.')) throw new Error('Speech unavailable.');
          } catch {
            if (current()) setStatus('Offline speech test failed.');
          }
        }).catch(() => undefined);
      })}</>}
    {choice('Refresh voice readiness', () => {run(refresh).catch(() => undefined);})}
    {choice('Open microphone and app settings', () => {
      run(async current => {
        try {await Linking.openSettings();}
        catch {if (current()) setStatus('Open Android app settings manually.');}
      }).catch(() => undefined);
    })}
  </View>;
}
const styles = StyleSheet.create({text: {color: colors.textSecondary, padding: 8}, row: {flexDirection: 'row', flexWrap: 'wrap'}, button: {minHeight: 44, justifyContent: 'center'}, selected: {color: colors.accent, fontWeight: '700'}});
