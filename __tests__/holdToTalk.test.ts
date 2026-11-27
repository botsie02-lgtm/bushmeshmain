import {HoldToTalk, type HeldRecognitionAdapter} from '../src/speech/HoldToTalk';
import type {HeldSpeechPartial, NativeSpeechRecognitionResult} from '../src/native/NativeSpeechRecognition';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

const result: NativeSpeechRecognitionResult = {
  text: 'Synthetic transcript', confidence: 0.8, durationMs: 1000, alternatives: [],
};

function fixture() {
  const permission = deferred<boolean>();
  const recognition = deferred<NativeSpeechRecognitionResult>();
  let listener: ((partial: HeldSpeechPartial) => void) | undefined;
  const unsubscribe = jest.fn(() => {listener = undefined;});
  const adapter: jest.Mocked<HeldRecognitionAdapter> = {
    permission: jest.fn(() => permission.promise),
    recognize: jest.fn(() => recognition.promise),
    finish: jest.fn(async () => true),
    subscribePartial: jest.fn(callback => {listener = callback; return unsubscribe;}),
  };
  return {adapter, permission, recognition, unsubscribe, emit: (partial: HeldSpeechPartial) => listener?.(partial), held: new HoldToTalk(adapter)};
}

test('release while permission is pending never opens native microphone', async () => {
  const f = fixture();
  const turn = f.held.press();
  expect(await f.held.release()).toBe(true);
  f.permission.resolve(true);
  expect(await turn).toBeNull();
  expect(f.adapter.recognize).not.toHaveBeenCalled();
  expect(f.adapter.finish).not.toHaveBeenCalled();
});

test('denied permission and cancellation never fall back to recognition', async () => {
  const f = fixture();
  const turn = f.held.press();
  f.permission.resolve(false);
  await expect(turn).rejects.toThrow('permission denied');
  expect(f.adapter.recognize).not.toHaveBeenCalled();
  expect(await f.held.cancel()).toBe(false);
});

test('scoped release returns actual native final result and ignores foreign partials', async () => {
  const f = fixture();
  const partial = jest.fn();
  const turn = f.held.press('en-AU', partial);
  f.permission.resolve(true);
  await Promise.resolve();
  expect(f.adapter.recognize).toHaveBeenCalledTimes(1);
  const id = f.adapter.recognize.mock.calls[0][1];
  f.emit({requestId: 'old-request', text: 'Ignore'});
  f.emit({requestId: id, text: 'Preview'});
  expect(partial).toHaveBeenCalledTimes(1);
  expect(partial).toHaveBeenCalledWith('Preview');
  expect(await f.held.release()).toBe(true);
  expect(await f.held.release()).toBe(false);
  expect(f.adapter.finish).toHaveBeenCalledWith(id, false);
  f.recognition.resolve(result);
  expect(await turn).toEqual(result);
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
});

test('cancel after release discards late final results and partials', async () => {
  const f = fixture();
  const partial = jest.fn();
  const turn = f.held.press('en-AU', partial);
  f.permission.resolve(true);
  await Promise.resolve();
  const id = f.adapter.recognize.mock.calls[0][1];
  await f.held.release();
  expect(await f.held.cancel()).toBe(true);
  expect(f.adapter.finish).toHaveBeenLastCalledWith(id, true);
  f.emit({requestId: id, text: 'Late'});
  f.recognition.resolve(result);
  expect(await turn).toBeNull();
  expect(partial).not.toHaveBeenCalled();
});

test('native early-release cancellation is not a recognized transcript', async () => {
  const f = fixture();
  const turn = f.held.press();
  f.permission.resolve(true);
  await Promise.resolve();
  await f.held.release();
  f.recognition.reject(Object.assign(new Error('Cancelled'), {code: 'BUSHMESH_STT_CANCELLED'}));
  expect(await turn).toBeNull();
});

test('native interruption and timeout fail closed; no retries or fallback', async () => {
  for (const code of ['BUSHMESH_STT_INTERRUPTED', 'BUSHMESH_STT_TIMEOUT', 'BUSHMESH_STT_START_FAILED']) {
    const f = fixture();
    const turn = f.held.press();
    f.permission.resolve(true);
    await Promise.resolve();
    f.recognition.reject(Object.assign(new Error(code), {code}));
    await expect(turn).rejects.toThrow(code);
    expect(f.adapter.recognize).toHaveBeenCalledTimes(1);
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  }
});

test('one explicit press at a time, including pending permission', async () => {
  const f = fixture();
  const turn = f.held.press();
  await expect(f.held.press()).rejects.toThrow('already active');
  await f.held.cancel();
  f.permission.resolve(true);
  expect(await turn).toBeNull();
  expect(f.adapter.recognize).not.toHaveBeenCalled();
});
