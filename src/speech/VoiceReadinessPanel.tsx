import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Text, View, TouchableOpacity, StyleSheet, Linking, TextInput} from 'react-native';
import {nativeSpeechRecognition, type OfflineLanguageInventory} from '../native/NativeSpeechRecognition';
import {nativeSpeech, type VoicePreferences} from '../native/NativeSpeech';
import {colors} from '../theme/colors';
import {useSpeech} from '../state/SpeechContext';
import {applicationVoice} from './applicationVoice';
import {downloadFeedback, englishModelChoices, modelLabel} from './offlineRecognitionReadiness';

// Android admits one language probe at a time. Share an outstanding probe
// across panel navigation; defer a different locale until it finishes.
type LanguageReadiness = {model: OfflineLanguageInventory['status']; inventory: OfflineLanguageInventory | null};
let nextSetupRequest = 0;
let languageProbe: {locale: string; promise: Promise<LanguageReadiness>} | null = null;
async function readLanguage(locale: string, current: () => boolean): Promise<LanguageReadiness> {
  while (languageProbe) {
    const pending = languageProbe;
    if (pending.locale === locale) return pending.promise;
    await pending.promise.catch(() => undefined);
    if (!current()) return {model: 'unknown', inventory: null};
  }
  if (!current()) return {model: 'unknown', inventory: null};
  const promise = (async (): Promise<LanguageReadiness> => {
    const inventory = await nativeSpeechRecognition.getLanguageInventory(locale);
    if (!current() && !inventory) return {model: 'unknown', inventory: null};
    return {model: inventory?.status ?? await nativeSpeechRecognition.checkLanguage(locale), inventory};
  })();
  const request = {locale, promise};
  languageProbe = request;
  try {
    return await promise;
  } finally {
    if (languageProbe === request) languageProbe = null;
  }
}

export function VoiceReadinessPanel() {
  const {refresh: refreshSpeech, supported} = useSpeech();
  const [status, setStatus] = useState('Checking local speech…');
  const [prefs, setPrefs] = useState<VoicePreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [showVoices, setShowVoices] = useState(false);
  const [inventory, setInventory] = useState<OfflineLanguageInventory | null>(null);
  const [modelStatus, setModelStatus] = useState<OfflineLanguageInventory['status']>('unknown');
  const [feedback, setFeedback] = useState('');
  const [testTranscript, setTestTranscript] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testDetail, setTestDetail] = useState('');
  const testKey = useRef<string | null>(null);
  const downloadRequest = useRef<string | null>(null);
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
      const readiness = r.supported ? await readLanguage(locale, current) : {model: 'unknown' as const, inventory: null};
      const model = readiness.model;
      if (!current()) return;
      setPrefs(p);
      setInventory(readiness.inventory);
      setModelStatus(model);
      setStatus((r.supported ? 'On-device recognizer available. ' + locale + ' model: ' +
        modelLabel(model) + '.'
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
      if (testKey.current) applicationVoice.cancelDestination(testKey.current).catch(() => undefined);
      if (downloadRequest.current) nativeSpeechRecognition.stopDownloadObservation(downloadRequest.current).catch(() => undefined);
    };
  }, [refresh, run]);

  const update = (patch: Partial<Pick<VoicePreferences, 'locale' | 'voice' | 'rate'>>) => {
    if (!prefs) return;
    run(async current => {
      try {
        setFeedback('');
        await nativeSpeech.setVoicePreferences({...prefs, ...patch});
        if (current()) await refresh(current, true);
      } catch {
        if (current()) setStatus('Voice preference not saved. Stop speech and try again.');
      }
    }).catch(() => undefined);
  };
  const download = () => {
    if (!prefs) return;
    run(async current => {
      const id = 'setup-download-' + ++nextSetupRequest;
      downloadRequest.current = id;
      setFeedback('Requesting offline model. Internet may be required for this download.');
      const unsubscribe = nativeSpeechRecognition.subscribeModelProgress(progress => {
        if (current() && downloadRequest.current === id && progress.requestId === id) {
          setFeedback('Downloading ' + prefs.locale + ': ' + progress.percent + '%');
        }
      });
      try {
        const outcome = await nativeSpeechRecognition.downloadLanguage(prefs.locale, id);
        if (!current()) return;
        setFeedback(downloadFeedback(outcome));
        await refresh(current);
      } catch {
        if (current()) setFeedback('Model download request failed. Check internet and refresh readiness.');
      } finally {
        unsubscribe();
        if (downloadRequest.current === id) downloadRequest.current = null;
      }
    }).catch(() => undefined);
  };

  // Same dialogue ownership as the composer. No send port or command parser.
  const testRecognition = () => {
    run(async current => {
      const key = 'voice-settings-test-' + ++nextSetupRequest;
      testKey.current = key;
      setTestRunning(true);
      setTestDetail('Checking microphone permission…');
      let transcript = '';
      const unsubscribe = applicationVoice.subscribe(() => {
        if (current() && testKey.current === key) setTestDetail(applicationVoice.snapshot().detail);
      });
      try {
        await applicationVoice.run('dictation', {
          key, label: 'Offline speech test', isCurrent: current,
          draft: () => transcript,
          editDraft: value => {
            transcript = value;
            if (current()) setTestTranscript(value);
          },
          latest: () => null, unread: () => [], quick: () => [], radio: () => '',
        });
        if (current() && transcript) setTestDetail('Recognition returned a local transcript. Nothing transmitted.');
      } finally {
        unsubscribe();
        if (testKey.current === key) testKey.current = null;
        if (current()) setTestRunning(false);
      }
    }).catch(() => undefined);
  };

  const choice = (label: string, onPress: () => void, selected = false) =>
    <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected, disabled: busy}} disabled={busy} onPress={onPress} style={styles.button}>
      <Text style={[styles.text, selected && styles.selected]}>{label}</Text>
    </TouchableOpacity>;

  return <View><Text style={styles.text}>{status}</Text>
    {prefs && <><Text style={styles.text}>Recognition language</Text><View style={styles.row}>{englishModelChoices(inventory, prefs.locale).map(locale => choice(locale, () => update({locale}), prefs.locale === locale))}</View>
      <Text style={styles.text}>Australian English is preferred when installed. Select another English model explicitly if needed.</Text>
      {inventory && <Text style={styles.text}>Installed: {inventory.installed.join(', ') || 'none reported'}{'\n'}Pending: {inventory.pending.join(', ') || 'none reported'}{'\n'}Supported for download: {inventory.downloadable.join(', ') || 'none reported'}{inventory.reason ? '\n' + inventory.reason : ''}</Text>}
      {modelStatus !== 'installed' && modelStatus !== 'unsupported' && choice('Download selected offline model', download)}
      {!!feedback && <Text accessibilityLiveRegion="polite" style={styles.text}>{feedback}</Text>}
      {downloadRequest.current && <TouchableOpacity accessibilityRole="button" onPress={() => {
        const id = downloadRequest.current;
        if (id) nativeSpeechRecognition.stopDownloadObservation(id).catch(() => undefined);
      }} style={styles.button}><Text style={styles.text}>Stop waiting for download</Text></TouchableOpacity>}
      {choice('Test offline recognition', testRecognition)}
      {testRunning && <TouchableOpacity accessibilityRole="button" onPress={() => {
        const key = testKey.current;
        if (key) applicationVoice.cancelDestination(key).catch(() => undefined);
      }} style={styles.button}><Text style={styles.text}>Cancel recognition test</Text></TouchableOpacity>}
      {!!testDetail && <Text accessibilityLiveRegion="polite" style={styles.text}>{testDetail}</Text>}
      <TextInput accessibilityLabel="Local recognition test transcript" value={testTranscript} onChangeText={setTestTranscript} editable={!testRunning} multiline placeholder="Local test transcript (editable, never sent)" placeholderTextColor={colors.textSecondary} style={styles.text}/>

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
