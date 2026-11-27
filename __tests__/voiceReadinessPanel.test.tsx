import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {VoiceReadinessPanel} from '../src/speech/VoiceReadinessPanel';
import {SpeechProvider} from '../src/state/SpeechContext';
import {nativeSpeech, type NativeSpeechStatus, type VoicePreferences} from '../src/native/NativeSpeech';
import {nativeSpeechRecognition} from '../src/native/NativeSpeechRecognition';

const ready: NativeSpeechStatus = {initialized: true, initializing: false, failed: false, languageTag: 'en-AU', offlineVoice: true, criticalAlertsEnabled: true, radioMessagesEnabled: false};
const recognition = {supported: true, listening: false, apiLevel: 36, reason: null};
const preferences: VoicePreferences = {locale: 'en-AU', rate: 1, voice: 'local', voices: [{locale: 'en-AU', name: 'local'}]};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}
let tree: ReactTestRenderer.ReactTestRenderer | undefined;
const view = (visible = true) => <SpeechProvider>{visible ? <VoiceReadinessPanel/> : null}</SpeechProvider>;
const mount = async () => {await act(async () => {tree = ReactTestRenderer.create(view());});};
const button = (label: string) => tree!.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const content = () => tree!.root.findAllByType('Text' as unknown as React.ElementType).map(n => n.props.children).flat(Infinity).join(' ');

beforeEach(() => {
  jest.spyOn(nativeSpeech, 'isSupported').mockReturnValue(true);
  jest.spyOn(nativeSpeech, 'getStatus').mockResolvedValue(ready);
  jest.spyOn(nativeSpeech, 'getVoicePreferences').mockResolvedValue(preferences);
  jest.spyOn(nativeSpeech, 'setVoicePreferences').mockResolvedValue(undefined);
  jest.spyOn(nativeSpeechRecognition, 'getStatus').mockResolvedValue(recognition);
  jest.spyOn(nativeSpeechRecognition, 'checkLanguage').mockResolvedValue('installed');
});
afterEach(async () => {
  if (tree) await act(async () => {tree!.unmount();});
  tree = undefined;
  jest.restoreAllMocks();
});

test('mount shares native TTS status with provider and does not loop on provider or local renders', async () => {
  await mount();
  expect(nativeSpeech.getStatus).toHaveBeenCalledTimes(1);
  expect(nativeSpeechRecognition.getStatus).toHaveBeenCalledTimes(1);
  expect(nativeSpeechRecognition.checkLanguage).toHaveBeenCalledWith('en-AU');
  expect(content()).toContain('reported installed');
  expect(content()).toContain('Offline voice: en-AU');
  await act(async () => {button('Choose installed offline voice').props.onPress();});
  expect(nativeSpeech.getStatus).toHaveBeenCalledTimes(1);
  expect(nativeSpeechRecognition.checkLanguage).toHaveBeenCalledTimes(1);
});

test('manual refresh is single flight and a preference write gets fresh language readiness', async () => {
  await mount();
  const pending = deferred<NativeSpeechStatus>();
  jest.spyOn(nativeSpeech, 'getStatus').mockReturnValueOnce(pending.promise);
  await act(async () => {
    const press = button('Refresh voice readiness').props.onPress;
    press(); press();
  });
  expect(nativeSpeech.getStatus).toHaveBeenCalledTimes(2);
  expect(button('Refresh voice readiness').props.disabled).toBe(true);
  await act(async () => {pending.resolve(ready);});
  expect(nativeSpeechRecognition.checkLanguage).toHaveBeenCalledTimes(2);
  jest.spyOn(nativeSpeech, 'getVoicePreferences').mockResolvedValue({...preferences, locale: 'en-GB'});
  jest.spyOn(nativeSpeechRecognition, 'checkLanguage').mockResolvedValue('download-required');
  await act(async () => {button('en-GB').props.onPress();});
  expect(nativeSpeech.setVoicePreferences).toHaveBeenCalledWith({...preferences, locale: 'en-GB'});
  expect(nativeSpeech.getStatus).toHaveBeenCalledTimes(3);
  expect(nativeSpeechRecognition.checkLanguage).toHaveBeenLastCalledWith('en-GB');
  expect(content()).toContain('en-GB model: download required');
});

test('unmount before status resolves never starts a stale language probe', async () => {
  const pending = deferred<typeof recognition>();
  jest.spyOn(nativeSpeechRecognition, 'getStatus').mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => {tree!.update(view(false));});
  await act(async () => {pending.resolve(recognition);});
  expect(nativeSpeechRecognition.checkLanguage).not.toHaveBeenCalled();
  await act(async () => {tree!.update(view());});
  expect(nativeSpeechRecognition.checkLanguage).toHaveBeenCalledTimes(1);
  expect(content()).toContain('reported installed');
});

test('late language probe after navigation cannot overwrite the new readiness panel', async () => {
  const pending = deferred<'installed' | 'download-required' | 'unknown'>();
  jest.spyOn(nativeSpeechRecognition, 'checkLanguage').mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => {tree!.update(view(false));});
  jest.spyOn(nativeSpeechRecognition, 'checkLanguage').mockResolvedValue('download-required');
  await act(async () => {tree!.update(view());});
  expect(content()).toContain('download required');
  await act(async () => {pending.resolve('installed');});
  expect(content()).toContain('download required');
  expect(content()).not.toContain('reported installed');
});
