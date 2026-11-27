import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import type {VoiceDestination} from '../src/speech/VoiceAssistant';
import type {RadioConversationScope} from '../src/screens/radioMessenger/messengerModel';
import {
  VoiceOperationalSessionController, type VoiceOperationalInputs,
  type RadioVoiceBinding,
} from '../src/app/voiceContext/voiceOperationalSession';
import {
  VoiceOperationalProvider, bindVerifiedVoiceDestination,
  currentVoiceRoute, subscribeVoiceSafetyStop,
  useVoiceOperationalSession,
} from '../src/app/voiceContext/VoiceOperationalProvider';

const chatId = 'c'.repeat(64);
const scope: RadioConversationScope = {
  radioId: 'radio-one', channelGeneration: 'config:2:' + chatId,
  channelIndex: '1', channelName: 'Trail',
};
const binding: RadioVoiceBinding = {
  scope, chatRecordRef: chatId, radioSessionEpoch: 3,
  submissionAuthority: 'verified-radio-chat', state: 'ready',
};
const initial: VoiceOperationalInputs = {
  viewedConversation: null, selectedTab: 'radio', lifecycle: 'foreground',
  activeConvoy: null, localIdentityRef: null,
  radioSessionEpoch: 3, radioBindings: [binding], convoyLinks: [],
  nativeWake: {supported: false, detectorOwnerRef: null},
};

function source(send: jest.Mock, scopeOverride = scope, originCurrent = () => true) {
  let draft = '';
  const destination: VoiceDestination = {
    key: 'radio-composer-unique',
    label: 'Trail',
    isCurrent: originCurrent,
    draft: () => draft,
    editDraft: value => {draft = value;},
    send: (text, stillCurrent) => send(text, stillCurrent),
    latest: () => 'Received text is for playback, not command parsing.',
    unread: () => ['Pending playback'],
    quick: () => ['All clear.'],
    radio: () => 'Local companion connected. No peer delivery proof.',
  };
  return {destination, binding, scope: scopeOverride};
}

test('existing VoiceDestination stays unavailable until explicit voice session activation', async () => {
  const c = new VoiceOperationalSessionController(initial, {now: () => 1_000, instanceRef: 'bridge'});
  const transmitted = jest.fn(async (_text: string, checked: () => boolean) =>
    checked() ? 'Radio accepted. Peer not confirmed.' : 'No transmission.');
  expect(bindVerifiedVoiceDestination(c, source(transmitted))).toBeNull();
  c.selectExplicit({kind: 'radio', scope});
  expect(bindVerifiedVoiceDestination(c, source(transmitted))).toBeNull();
  expect(currentVoiceRoute(c)).toBeNull();
  c.activateExplicit();
  const bridge = bindVerifiedVoiceDestination(c, source(transmitted));
  expect(bridge).not.toBeNull();
  expect(bridge?.send).toBeDefined();
  expect(bridge?.isCurrent()).toBe(true);
  expect(bridge?.key).toContain('bridge:1');
  expect(currentVoiceRoute(c)?.scope).toEqual(scope);
  bridge?.editDraft('Hello');
  expect(bridge?.draft()).toBe('Hello');
  expect(bridge?.latest()).toContain('for playback');
  expect(await bridge?.send?.('Hello', () => true)).toContain('Radio accepted');
  expect(transmitted).toHaveBeenCalledTimes(1);
});

test('existing send adapter blocks a late callback after radio session invalidation', async () => {
  const c = new VoiceOperationalSessionController(initial, {now: () => 1_000, instanceRef: 'late'});
  c.selectExplicit({kind: 'radio', scope});
  c.activateExplicit();
  const send = jest.fn(async (_text: string, guard: () => boolean) =>
    guard() ? 'accepted' : 'aborted');
  const voice = bindVerifiedVoiceDestination(c, source(send));
  expect(voice).not.toBeNull();
  c.updateInputs({...initial, radioSessionEpoch: 4});
  expect(voice!.isCurrent()).toBe(false);
  expect(voice!.latest()).toBeNull();
  expect(voice!.unread()).toEqual([]);
  expect(voice!.quick()).toEqual([]);
  voice!.editDraft('Ignored');
  await expect(voice!.send!('Do not send', () => true))
    .rejects.toThrow('Voice destination changed');
  expect(send).not.toHaveBeenCalled();
  expect(currentVoiceRoute(c)).toBeNull();
});

test('adapter fails closed if the source scope or protected configuration differs', () => {
  const c = new VoiceOperationalSessionController(initial, {now: () => 2_000, instanceRef: 'reject'});
  c.selectExplicit({kind: 'radio', scope});
  c.activateExplicit();
  const send = jest.fn();
  expect(bindVerifiedVoiceDestination(c, source(send, {...scope, channelIndex: '2'})))
    .toBeNull();
  expect(bindVerifiedVoiceDestination(c, {
    ...source(send),
    binding: {...binding, chatRecordRef: 'wrong'},
  })).toBeNull();
  expect(bindVerifiedVoiceDestination(c, {
    ...source(send),
    binding: {...binding, radioSessionEpoch: 9},
  })).toBeNull();
  expect(bindVerifiedVoiceDestination(c, source(send, scope, () => false))).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

test('a reconfiguration during async VoiceAssistant deliberation makes final guard false', async () => {
  const c = new VoiceOperationalSessionController(initial, {now: () => 3_000, instanceRef: 'race'});
  c.selectExplicit({kind: 'radio', scope});
  c.activateExplicit();
  let capturedGuard: (() => boolean) | undefined;
  const send = jest.fn(async (_text: string, guard: () => boolean) => {
    capturedGuard = guard;
    return 'Sender must still check before radio transmission';
  });
  const voice = bindVerifiedVoiceDestination(c, source(send))!;
  await voice.send!('Trail check', () => true);
  expect(capturedGuard?.()).toBe(true);
  c.updateInputs({...initial, radioBindings: [{
    ...binding, scope: {...scope, channelGeneration: 'config:3:' + chatId},
  }]});
  expect(capturedGuard?.()).toBe(false);
});

test('safety-stop subscription cancels the old dialogue on tab suspend, invalidation and grant withdrawal', () => {
  const c = new VoiceOperationalSessionController(initial, {now: () => 4_000, instanceRef: 'cancel'});
  const stop = jest.fn();
  const unbind = subscribeVoiceSafetyStop(c, stop);
  c.selectExplicit({kind: 'radio', scope});
  c.activateExplicit();
  expect(stop).not.toHaveBeenCalled();
  c.updateInputs({...initial, selectedTab: 'drive'});
  expect(stop).toHaveBeenCalledTimes(1);
  c.resumeExplicit();
  c.invalidateSecurity();
  expect(stop).toHaveBeenCalledTimes(2);
  c.selectExplicit({kind: 'radio', scope});
  c.activateExplicit();
  c.deactivateExplicit();
  expect(stop).toHaveBeenCalledTimes(3);
  unbind();
});

test('React provider exposes one shared session and input changes never change selected voice conversation', async () => {
  const c = new VoiceOperationalSessionController(initial, {now: () => 5_000, instanceRef: 'react'});
  const observed: Array<ReturnType<typeof useVoiceOperationalSession>['snapshot']> = [];
  function Probe(): null {
    observed.push(useVoiceOperationalSession().snapshot);
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <VoiceOperationalProvider inputs={initial} controller={c}>
        <Probe />
      </VoiceOperationalProvider>,
    );
  });
  expect(observed[observed.length - 1].selectedVoiceConversation).toBeNull();
  await act(async () => {c.selectExplicit({kind: 'radio', scope});});
  expect(observed[observed.length - 1].selectedVoiceConversation).toEqual({
    kind: 'radio', scope,
  });
  await act(async () => {c.activateExplicit();});
  expect(observed[observed.length - 1].session?.status).toBe('active');
  await act(async () => {
    renderer.update(
      <VoiceOperationalProvider controller={c} inputs={{
        ...initial, selectedTab: 'convoy',
        viewedConversation: {kind: 'operational-convoy', convoyId: 'another'},
      }}>
        <Probe />
      </VoiceOperationalProvider>,
    );
  });
  expect(observed[observed.length - 1].selectedVoiceConversation).toEqual({
    kind: 'radio', scope,
  });
  expect(observed[observed.length - 1].viewedConversation).toEqual({
    kind: 'operational-convoy', convoyId: 'another',
  });
  expect(observed[observed.length - 1].session?.status).toBe('suspended');
  await act(async () => {renderer.unmount();});
});
