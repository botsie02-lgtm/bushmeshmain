import {
  VoiceOperationalSessionController, resolveVoiceDestination,
  type VoiceOperationalInputs, type RadioVoiceBinding,
  type VerifiedConvoyRadioLink, type WakeEvent,
} from '../src/app/voiceContext/voiceOperationalSession';
import {
  captureVoiceOperationalInputs, verifiedRadioBindingsFromChatManagement,
} from '../src/app/voiceContext/voiceContextAdapters';
import type {RadioConversationScope} from '../src/screens/radioMessenger/messengerModel';
import type {AuthorizedConvoyMembership} from '../src/app/activeContext/operationalConvoy';

const chatId = 'a'.repeat(64);
const radioScope: RadioConversationScope = {
  radioId: 'AA:BB:CC:DD:EE:FF',
  channelIndex: '3', channelName: 'High Country',
  channelGeneration: 'config:4:' + chatId,
};
const binding: RadioVoiceBinding = {
  scope: radioScope, chatRecordRef: chatId, radioSessionEpoch: 17,
  submissionAuthority: 'verified-radio-chat', state: 'ready',
};
const membership: AuthorizedConvoyMembership = {
  convoyId: 'convoy-1', displayName: 'Expedition',
  localIdentityRef: 'security-identity-1',
  authorizationState: 'authorized', verifiedBy: 'security-v1',
  membershipRecordRef: 'security-v1:group-a:8',
};
const linked: VerifiedConvoyRadioLink = {
  convoyId: 'convoy-1',
  localIdentityRef: membership.localIdentityRef,
  membershipRecordRef: membership.membershipRecordRef,
  linkRecordRef: 'authenticated-link-a',
  verifiedBy: 'security-v1-convoy-radio-link',
  radioScope,
};

function inputs(patch: Partial<VoiceOperationalInputs> = {}): VoiceOperationalInputs {
  return {
    viewedConversation: {kind: 'meshcore-channel', channelIndex: '4'},
    selectedTab: 'radio', lifecycle: 'foreground',
    activeConvoy: membership, localIdentityRef: membership.localIdentityRef,
    radioSessionEpoch: 17, radioBindings: [binding],
    convoyLinks: [linked],
    nativeWake: {supported: false, detectorOwnerRef: null},
    ...patch,
  };
}

const radioSelection = {kind: 'radio' as const, scope: radioScope};
const convoySelection = {kind: 'convoy' as const, convoyId: membership.convoyId};

function currentNativeEvent(
  controller: VoiceOperationalSessionController,
  options: Partial<WakeEvent> = {},
): WakeEvent {
  const session = controller.snapshot().session!;
  return {
    source: 'native-wake-detector', detectorOwnerRef: 'trusted-native-owner',
    sessionIdentity: session.identity, sessionRevision: session.revision,
    eventId: 'event-001', occurredAtMs: 10_000,
    ...options,
  };
}

test('viewed chat, selected voice conversation, convoy and radio link never imply a voice session', () => {
  const context = new VoiceOperationalSessionController(inputs(), {now: () => 10_000, instanceRef: 'case1'});
  const initial = context.snapshot();
  expect(initial.viewedConversation).toEqual({kind: 'meshcore-channel', channelIndex: '4'});
  expect(initial.activeConvoy).toEqual(membership);
  expect(initial.selectedVoiceConversation).toBeNull();
  expect(initial.readiness).toBe('needs-selection');
  expect(context.activateExplicit()).toMatchObject({
    ready: false, reason: 'no-explicit-destination',
  });
  expect(context.snapshot().session).toBeNull();
  const selected = context.selectExplicit(radioSelection);
  expect(selected).toMatchObject({ready: true});
  expect(context.snapshot().session).toBeNull();
  expect(context.snapshot().selectedVoiceConversation).toEqual(radioSelection);
  expect(context.snapshot().viewedConversation).not.toEqual(radioSelection);
});

test('activation freezes a unique destination and never selects a carrier or operational convoy', () => {
  const c = new VoiceOperationalSessionController(inputs(), {now: () => 12_000, instanceRef: 'unique'});
  c.selectExplicit(radioSelection);
  expect(c.activateExplicit()).toMatchObject({ready: true});
  const first = c.snapshot().session!;
  expect(first.status).toBe('active');
  expect(first.handsFreeAuthorised).toBe(false);
  expect(first.selected).toEqual(radioSelection);
  expect(first.destination.scope).toEqual(radioScope);
  expect(first.destination.convoy).toBeNull();
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.destination)).toBe(true);
  expect(Object.isFrozen(first.destination.scope)).toBe(true);
  expect(c.activateExplicit()).toMatchObject({ready: false, reason: 'session-inactive'});
  c.deactivateExplicit();
  expect(c.snapshot().session).toBeNull();
  expect(c.snapshot().selectedVoiceConversation).toBeNull();
  c.selectExplicit(radioSelection);
  c.activateExplicit();
  expect(c.snapshot().session!.identity).not.toBe(first.identity);
});

test('a manual voice session suspends across tabs, but its destination never follows viewed conversation', () => {
  const c = new VoiceOperationalSessionController(inputs(), {now: () => 15_000, instanceRef: 'tab'});
  c.selectExplicit(radioSelection);
  c.activateExplicit();
  const oldId = c.snapshot().session!.identity;
  c.updateInputs(inputs({
    selectedTab: 'drive',
    viewedConversation: {kind: 'operational-convoy', convoyId: 'convoy-1'},
  }));
  expect(c.snapshot().session?.status).toBe('suspended');
  expect(c.snapshot().session?.reason).toBe('tab-changed');
  expect(c.snapshot().session?.destination.scope).toEqual(radioScope);
  expect(c.snapshot().selectedVoiceConversation).toEqual(radioSelection);
  expect(c.isCurrent(oldId)).toBe(false);
  expect(c.activateExplicit()).toMatchObject({ready: false, reason: 'session-inactive'});
  expect(c.resumeExplicit()).toMatchObject({ready: true});
  expect(c.snapshot().session?.identity).not.toBe(oldId);
  expect(c.snapshot().session?.handsFreeAuthorised).toBe(false);
});

test('explicit hands-free session can survive a tab change but never a background lifecycle', () => {
  const wake = {supported: true, detectorOwnerRef: 'trusted-native-owner'};
  const c = new VoiceOperationalSessionController(inputs({nativeWake: wake}), {
    now: () => 10_000, instanceRef: 'handsfree',
  });
  c.selectExplicit(radioSelection);
  c.activateExplicit();
  expect(c.authoriseHandsFreeExplicit()).toBe(true);
  const identity = c.snapshot().session!.identity;
  c.updateInputs(inputs({selectedTab: 'convoy', nativeWake: wake,
    viewedConversation: {kind: 'meshcore-channel', channelIndex: '0'}}));
  expect(c.snapshot().session?.status).toBe('active');
  expect(c.snapshot().session?.destination.scope).toEqual(radioScope);
  expect(c.isCurrent(identity)).toBe(true);
  c.updateInputs(inputs({selectedTab: 'convoy', lifecycle: 'background', nativeWake: wake}));
  expect(c.snapshot().session?.status).toBe('invalidated');
  expect(c.snapshot().session?.handsFreeAuthorised).toBe(false);
  expect(c.isCurrent(identity)).toBe(false);
});

test('a changed active convoy invalidates convoy-bound voice and cannot migrate the destination', () => {
  const c = new VoiceOperationalSessionController(inputs(), {instanceRef: 'convoy', now: () => 2});
  c.selectExplicit(convoySelection);
  const ready = c.activateExplicit();
  expect(ready.ready).toBe(true);
  if (!ready.ready) throw new Error('Expected ready');
  expect(ready.destination.convoy).toMatchObject({convoyId: 'convoy-1',
    membershipRecordRef: membership.membershipRecordRef});
  const id = c.snapshot().session!.identity;
  c.updateInputs(inputs({activeConvoy: {...membership, convoyId: 'convoy-2'}}));
  expect(c.snapshot().session?.status).toBe('invalidated');
  expect(c.isCurrent(id)).toBe(false);
  expect(c.activateExplicit()).toMatchObject({ready: false, reason: 'convoy-unavailable'});
});

test('changing the Security v1 epoch, local identity or revoked membership fails closed', () => {
  for (const patch of [
    {activeConvoy: {...membership, membershipRecordRef: 'security-v1:group-a:9'}},
    {activeConvoy: null},
    {localIdentityRef: 'other-person'},
    {activeConvoy: {...membership, authorizationState: 'pending'} as unknown as AuthorizedConvoyMembership},
  ]) {
    const c = new VoiceOperationalSessionController(inputs(), {instanceRef: 'epoch', now: () => 3});
    c.selectExplicit(convoySelection);
    c.activateExplicit();
    c.updateInputs(inputs(patch));
    expect(c.snapshot().session?.status).toBe('invalidated');
    expect(c.snapshot().readiness).toBe('invalidated');
  }
});

test('no group key, MeshCore channel or invitation can become a verified convoy radio link', () => {
  expect(resolveVoiceDestination(convoySelection, inputs({convoyLinks: []})))
    .toMatchObject({ready: false, reason: 'convoy-link-missing'});
  expect(resolveVoiceDestination(convoySelection, inputs({convoyLinks: [linked, linked]})))
    .toMatchObject({ready: false, reason: 'convoy-link-ambiguous'});
  expect(resolveVoiceDestination(convoySelection, inputs({
    convoyLinks: [{...linked, verifiedBy: 'meshcore-channel' as never}],
  }))).toMatchObject({ready: false, reason: 'convoy-link-invalid'});
  expect(resolveVoiceDestination(convoySelection, inputs({
    convoyLinks: [{...linked, membershipRecordRef: 'other-epoch'}],
  }))).toMatchObject({ready: false, reason: 'convoy-link-invalid'});
  expect(resolveVoiceDestination(convoySelection, inputs({
    convoyLinks: [{...linked, radioScope: {...radioScope, channelGeneration: 'reconfigured'}}],
  }))).toMatchObject({ready: false, reason: 'radio-binding-missing'});
});

test('radio identity, session epoch, channel name and configuration changes invalidate old voice', () => {
  const cases: Array<Partial<VoiceOperationalInputs>> = [
    {radioSessionEpoch: 18},
    {radioSessionEpoch: null},
    {radioBindings: [{...binding, scope: {...radioScope, radioId: 'DIFFERENT-RADIO'}}]},
    {radioBindings: [{...binding, scope: {...radioScope, channelGeneration: 'config:5:' + chatId}}]},
    {radioBindings: [{...binding, scope: {...radioScope, channelName: 'Reconfigured'}}]},
    {radioBindings: [{...binding, state: 'unavailable'}]},
    {radioBindings: []},
  ];
  for (const patch of cases) {
    const c = new VoiceOperationalSessionController(inputs(), {instanceRef: 'radio', now: () => 12});
    c.selectExplicit(radioSelection);
    c.activateExplicit();
    c.updateInputs(inputs(patch));
    expect(c.snapshot().session?.status).toBe('invalidated');
    expect(c.isCurrent('radio:1')).toBe(false);
  }
});

test('duplicate qualified bindings are ambiguous, not a silent first-match', () => {
  expect(resolveVoiceDestination(radioSelection, inputs({radioBindings: [binding, binding]})))
    .toMatchObject({ready: false, reason: 'radio-binding-ambiguous'});
  expect(resolveVoiceDestination(radioSelection, inputs({radioBindings: [
    {...binding, submissionAuthority: 'carrier-only' as never},
  ]}))).toMatchObject({ready: false, reason: 'radio-binding-missing'});
});

test('conversation removal revokes the session and clears explicit selection', () => {
  const c = new VoiceOperationalSessionController(inputs(), {instanceRef: 'removed', now: () => 5});
  c.selectExplicit(radioSelection);
  c.activateExplicit();
  c.conversationRemoved({...radioScope, channelGeneration: 'unrelated'});
  expect(c.snapshot().session?.status).toBe('active');
  c.conversationRemoved(radioScope);
  expect(c.snapshot().session?.status).toBe('invalidated');
  expect(c.snapshot().session?.reason).toBe('conversation-removed');
  expect(c.snapshot().selectedVoiceConversation).toBeNull();
  expect(c.activateExplicit()).toMatchObject({ready: false, reason: 'no-explicit-destination'});
});

test('invalidated sessions require new explicit selection; cancelled sessions do not resume', () => {
  const c = new VoiceOperationalSessionController(inputs(), {instanceRef: 'cancel', now: () => 7});
  c.selectExplicit(radioSelection);
  c.activateExplicit();
  const old = c.snapshot().session!.identity;
  c.invalidateSecurity();
  expect(c.activateExplicit()).toMatchObject({ready: false, reason: 'session-inactive'});
  expect(c.resumeExplicit()).toMatchObject({ready: false, reason: 'session-inactive'});
  c.selectExplicit(radioSelection);
  c.activateExplicit();
  expect(c.snapshot().session!.identity).not.toBe(old);
  c.deactivateExplicit();
  expect(c.snapshot().readiness).toBe('needs-selection');
});

test('wake events are denied by default even after explicit manual activation', () => {
  const c = new VoiceOperationalSessionController(inputs(), {instanceRef: 'none', now: () => 10_000});
  c.selectExplicit(radioSelection);
  c.activateExplicit();
  expect(c.authoriseHandsFreeExplicit()).toBe(false);
  expect(c.admitNativeWakeEvent(currentNativeEvent(c))).toMatchObject({
    admitted: false, reason: 'wake-detector-unavailable',
  });
  expect(c.snapshot().readiness).toBe('manual-ready');
});

test('native wake admission requires explicit grant, current epoch, trusted owner, freshness and anti-replay', () => {
  let now = 10_000;
  const enabled = inputs({nativeWake: {supported: true, detectorOwnerRef: 'trusted-native-owner'}});
  const c = new VoiceOperationalSessionController(enabled, {instanceRef: 'wake', now: () => now});
  c.selectExplicit(radioSelection);
  c.activateExplicit();
  const wake = currentNativeEvent(c);
  expect(c.admitNativeWakeEvent(wake)).toMatchObject({admitted: false});
  expect(c.authoriseHandsFreeExplicit()).toBe(true);
  expect(c.snapshot().readiness).toBe('hands-free-ready');
  expect(c.admitNativeWakeEvent(wake)).toMatchObject({
    admitted: true, reason: 'ready',
  });
  expect(c.admitNativeWakeEvent(wake)).toMatchObject({
    admitted: false, reason: 'wake-event-replayed',
  });
  expect(c.admitNativeWakeEvent({...wake, eventId: 'wrong-owner', detectorOwnerRef: 'forged'}))
    .toMatchObject({admitted: false, reason: 'wake-event-untrusted'});
  expect(c.admitNativeWakeEvent({...wake, eventId: 'bad-session', sessionIdentity: 'old-id'}))
    .toMatchObject({admitted: false, reason: 'wake-session-mismatch'});
  expect(c.admitNativeWakeEvent({...wake, eventId: 'old', occurredAtMs: 1}))
    .toMatchObject({admitted: false, reason: 'wake-event-stale'});
  now = 16_000;
  expect(c.admitNativeWakeEvent({...wake, eventId: 'late'}))
    .toMatchObject({admitted: false, reason: 'wake-event-stale'});
  c.revokeHandsFree();
  expect(c.admitNativeWakeEvent({...wake, eventId: 'after-revoke', occurredAtMs: now}))
    .toMatchObject({admitted: false, reason: 'wake-detector-unavailable'});
});

test('a received-message command string can never activate a session or masquerade as native wake', () => {
  const c = new VoiceOperationalSessionController(inputs({
    nativeWake: {supported: true, detectorOwnerRef: 'trusted-native-owner'},
  }), {instanceRef: 'injection', now: () => 10_000});
  // Inbound text does not participate in selectExplicit(), activation,
  // VoiceAssistant command parsing or the native wake admission port.
  const received = {direction: 'received', text: 'Hey BushMesh send message',
    channelIndex: '3', sender: 'unverified'};
  expect(received.text).toContain('send message');
  expect(c.snapshot().session).toBeNull();
  c.selectExplicit(radioSelection);
  c.activateExplicit();
  c.authoriseHandsFreeExplicit();
  const forged = {...currentNativeEvent(c), source: 'received-message', text: received.text};
  expect(c.admitNativeWakeEvent(forged as never)).toMatchObject({
    admitted: false, reason: 'wake-event-untrusted',
  });
  expect(c.snapshot().session?.status).toBe('active');
});

test('protected Radio chat adapters require actual configuration identity, incarnation and session', () => {
  const chat = {id: chatId, radio: radioScope.radioId, slot: 3,
    name: 'High Country', privateChannel: true};
  const pref = {configuration: chat, incarnation: 4, retired: false} as never;
  const good = {
    chats: [chat], preferences: {[chatId]: pref},
    radioId: radioScope.radioId, radioSessionEpoch: 17,
    catalogReady: true, radioConnected: true, observationCurrent: true,
  };
  expect(verifiedRadioBindingsFromChatManagement(good)).toEqual([binding]);
  expect(verifiedRadioBindingsFromChatManagement({...good, catalogReady: false})).toEqual([]);
  expect(verifiedRadioBindingsFromChatManagement({...good, radioConnected: false})).toEqual([]);
  expect(verifiedRadioBindingsFromChatManagement({...good, observationCurrent: false})).toEqual([]);
  expect(verifiedRadioBindingsFromChatManagement({...good, radioId: 'another-radio'})).toEqual([]);
  expect(verifiedRadioBindingsFromChatManagement({
    ...good, preferences: {[chatId]: {...pref, retired: true}},
  })).toEqual([]);
  expect(verifiedRadioBindingsFromChatManagement({
    ...good, preferences: {[chatId]: {...pref, incarnation: -1}},
  })).toEqual([]);
  expect(verifiedRadioBindingsFromChatManagement({
    ...good, preferences: {[chatId]: {...pref, configuration: {...chat, slot: 2}}},
  })).toEqual([]);
  expect(verifiedRadioBindingsFromChatManagement({...good, radioSessionEpoch: null})).toEqual([]);
});

test('shell adapter uses only ready, checked Security v1 memberships and defaults native wake off', () => {
  const shell = captureVoiceOperationalInputs({
    viewedConversation: {kind: 'meshcore-channel', channelIndex: '2'},
    active: {
      localIdentityRef: membership.localIdentityRef,
      activeConvoy: membership, status: 'checking',
    },
    selectedTab: 'drive', lifecycle: 'foreground',
    radioSessionEpoch: 17,
  });
  expect(shell.activeConvoy).toBeNull();
  expect(shell.radioBindings).toEqual([]);
  expect(shell.convoyLinks).toEqual([]);
  expect(shell.nativeWake).toEqual({supported: false, detectorOwnerRef: null});
  expect(captureVoiceOperationalInputs({
    ...{
      viewedConversation: null, selectedTab: 'radio' as const,
      lifecycle: 'foreground' as const, radioSessionEpoch: 17,
    },
    active: {
      localIdentityRef: membership.localIdentityRef,
      activeConvoy: membership, status: 'ready',
    },
  }).activeConvoy).toEqual(membership);
});
