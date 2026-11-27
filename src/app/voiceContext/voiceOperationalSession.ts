import type {ViewedConversationRef} from '../activeContext/ViewedConversationContext';
import type {AuthorizedConvoyMembership} from '../activeContext/operationalConvoy';
import {checkedMembership} from '../activeContext/operationalConvoy';
import {
  conversationKey, equalScope, validScope,
  type RadioConversationScope,
} from '../../screens/radioMessenger/messengerModel';

/**
 * This is a navigation and admission policy layer, NOT a new VoiceAssistant,
 * microphone controller, radio sender, Security authority or background task.
 *
 * Every "verified" status below is an ASSERTION by the supplying production
 * adapter. Only the real Radio verified-chat and Security v1 adapters may
 * construct these inputs. Channel discovery, PSKs and incoming text cannot.
 */
export type VoiceTab = 'drive' | 'radio' | 'convoy' | 'contacts' | 'device';
export type HostLifecycle = 'foreground' | 'inactive' | 'background';

export type VoiceSelectedConversation =
  | {readonly kind: 'radio'; readonly scope: RadioConversationScope}
  | {readonly kind: 'convoy'; readonly convoyId: string};

export type RadioVoiceBinding = {
  /** Full Radio scope, including radio identity and configuration incarnation. */
  readonly scope: RadioConversationScope;
  /** Opaque Radio chat-management identifier, NOT a MeshCore channel slot. */
  readonly chatRecordRef: string;
  /** Actual RadioConnection.getChatSessionEpoch() for this binding. */
  readonly radioSessionEpoch: string;
  /** Attested by actual verified Radio chat submission adapter. */
  readonly submissionAuthority: 'verified-radio-chat';
  readonly state: 'ready' | 'unavailable';
};

export type VerifiedConvoyRadioLink = {
  readonly convoyId: string;
  readonly localIdentityRef: string;
  readonly membershipRecordRef: string;
  /** Opaque verified relationship record. No group keys or PSKs. */
  readonly linkRecordRef: string;
  readonly radioScope: RadioConversationScope;
  readonly verifiedBy: 'security-v1-convoy-radio-link';
};

export type VoiceOperationalInputs = {
  readonly viewedConversation: ViewedConversationRef | null;
  readonly selectedTab: VoiceTab;
  readonly lifecycle: HostLifecycle;
  readonly activeConvoy: AuthorizedConvoyMembership | null;
  readonly localIdentityRef: string | null;
  readonly radioSessionEpoch: string | null;
  readonly radioBindings: readonly RadioVoiceBinding[];
  readonly convoyLinks: readonly VerifiedConvoyRadioLink[];
  /** Default false. Future native provider must attest actual wake readiness. */
  readonly nativeWake: {
    readonly supported: boolean;
    readonly detectorOwnerRef: string | null;
  };
};

export type VoiceReason =
  | 'no-explicit-destination'
  | 'invalid-destination'
  | 'radio-unavailable'
  | 'radio-session-changed'
  | 'radio-binding-missing'
  | 'radio-binding-ambiguous'
  | 'radio-not-ready'
  | 'convoy-unavailable'
  | 'convoy-membership-changed'
  | 'convoy-link-missing'
  | 'convoy-link-ambiguous'
  | 'convoy-link-invalid'
  | 'app-not-foreground'
  | 'tab-changed'
  | 'suspended-by-user'
  | 'cancelled'
  | 'conversation-removed'
  | 'security-invalidated'
  | 'wake-detector-unavailable'
  | 'wake-event-stale'
  | 'wake-event-replayed'
  | 'wake-event-untrusted'
  | 'wake-session-mismatch'
  | 'session-inactive'
  | 'ready';

export type ResolvedVoiceDestination = Readonly<{
  kind: 'radio';
  scope: Readonly<RadioConversationScope>;
  key: string;
  chatRecordRef: string;
  radioSessionEpoch: string;
  convoy: Readonly<{
    convoyId: string;
    membershipRecordRef: string;
    linkRecordRef: string;
    localIdentityRef: string;
  }> | null;
}>;

export type VoiceResolution =
  | Readonly<{ready: true; reason: 'ready'; destination: ResolvedVoiceDestination}>
  | Readonly<{ready: false; reason: VoiceReason; destination: null}>;

export type VoiceSessionStatus = 'inactive' | 'active' | 'suspended' | 'invalidated';

export type VoiceSessionSnapshot = Readonly<{
  identity: string;
  revision: number;
  status: VoiceSessionStatus;
  createdAtMs: number;
  selected: VoiceSelectedConversation;
  destination: ResolvedVoiceDestination;
  /** True only after a separate local explicit authorisation action. */
  handsFreeAuthorised: boolean;
  authorisedDetectorOwnerRef: string | null;
  reason: VoiceReason;
}>;

export type VoiceOperationalSnapshot = Readonly<{
  /** Navigation-only; never automatically becomes the voice destination. */
  viewedConversation: ViewedConversationRef | null;
  selectedVoiceConversation: VoiceSelectedConversation | null;
  activeConvoy: AuthorizedConvoyMembership | null;
  selectedTab: VoiceTab;
  lifecycle: HostLifecycle;
  resolution: VoiceResolution;
  session: VoiceSessionSnapshot | null;
  readiness: 'needs-selection' | 'unavailable' | 'manual-ready' |
    'hands-free-ready' | 'suspended' | 'invalidated';
  reason: VoiceReason;
}>;

export type WakeEvent = Readonly<{
  source: 'native-wake-detector';
  detectorOwnerRef: string;
  sessionIdentity: string;
  sessionRevision: number;
  eventId: string;
  occurredAtMs: number;
}>;

export type WakeAdmission = Readonly<{
  admitted: boolean;
  reason: VoiceReason;
  sessionIdentity: string | null;
  destination: ResolvedVoiceDestination | null;
}>;

const unavailable = (reason: VoiceReason): VoiceResolution =>
  ({ready: false, reason, destination: null});

function validOpaque(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.length <= 160 && !/[\u0000-\u001f]/.test(value);
}

function copyScope(scope: RadioConversationScope): Readonly<RadioConversationScope> {
  return Object.freeze({
    radioId: scope.radioId,
    channelGeneration: scope.channelGeneration,
    channelIndex: scope.channelIndex,
    channelName: scope.channelName,
  });
}

function copySelection(selection: VoiceSelectedConversation): VoiceSelectedConversation {
  return selection.kind === 'radio'
    ? Object.freeze({kind: 'radio', scope: copyScope(selection.scope)})
    : Object.freeze({kind: 'convoy', convoyId: selection.convoyId});
}

function sameSelection(
  a: VoiceSelectedConversation | null,
  b: VoiceSelectedConversation | null,
): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && (a.kind === 'radio' && b.kind === 'radio'
    ? equalScope(a.scope, b.scope)
    : a.kind === 'convoy' && b.kind === 'convoy' && a.convoyId === b.convoyId);
}

function sameMembership(
  a: AuthorizedConvoyMembership | null,
  b: AuthorizedConvoyMembership | null,
): boolean {
  return (!a || !b) ? a === b :
    a.convoyId === b.convoyId && a.localIdentityRef === b.localIdentityRef &&
    a.membershipRecordRef === b.membershipRecordRef &&
    a.verifiedBy === b.verifiedBy &&
    a.authorizationState === b.authorizationState;
}

function validatedMembership(inputs: VoiceOperationalInputs): AuthorizedConvoyMembership | null {
  const membership = inputs.activeConvoy;
  if (!inputs.localIdentityRef || !membership) return null;
  return checkedMembership(
    membership, membership.convoyId, inputs.localIdentityRef,
  );
}

function validatedBindings(
  inputs: VoiceOperationalInputs, scope: RadioConversationScope,
): VoiceResolution {
  if (!validScope(scope)) return unavailable('invalid-destination');
  const matches = inputs.radioBindings.filter(binding =>
    validScope(binding.scope) && equalScope(binding.scope, scope));
  if (!matches.length) return unavailable('radio-binding-missing');
  if (matches.length !== 1) return unavailable('radio-binding-ambiguous');
  const binding = matches[0];
  if (!validOpaque(binding.chatRecordRef) ||
    binding.submissionAuthority !== 'verified-radio-chat' ||
    !validOpaque(binding.radioSessionEpoch)) return unavailable('radio-binding-missing');
  if (!inputs.radioSessionEpoch ||
    binding.radioSessionEpoch !== inputs.radioSessionEpoch) {
    return unavailable('radio-session-changed');
  }
  if (binding.state !== 'ready') return unavailable('radio-not-ready');
  const safeScope = copyScope(scope);
  return {
    ready: true,
    reason: 'ready',
    destination: Object.freeze({
      kind: 'radio' as const, scope: safeScope,
      key: JSON.stringify([conversationKey(safeScope), binding.chatRecordRef,
        binding.radioSessionEpoch]),
      chatRecordRef: binding.chatRecordRef,
      radioSessionEpoch: binding.radioSessionEpoch,
      convoy: null,
    }),
  };
}

/** Resolve ONLY the explicitly selected voice target; neither tab, viewed
 * conversation, active convoy nor MeshCore slot is an implicit fallback.
 */
export function resolveVoiceDestination(
  selected: VoiceSelectedConversation | null,
  inputs: VoiceOperationalInputs,
): VoiceResolution {
  if (!selected) return unavailable('no-explicit-destination');
  if (inputs.lifecycle !== 'foreground') return unavailable('app-not-foreground');
  if (selected.kind === 'radio') return validatedBindings(inputs, selected.scope);
  if (selected.kind !== 'convoy' || !validOpaque(selected.convoyId)) {
    return unavailable('invalid-destination');
  }
  const membership = validatedMembership(inputs);
  if (!membership || membership.convoyId !== selected.convoyId) {
    return unavailable('convoy-unavailable');
  }
  const links = inputs.convoyLinks.filter(link => link.convoyId === selected.convoyId);
  if (!links.length) return unavailable('convoy-link-missing');
  if (links.length !== 1) return unavailable('convoy-link-ambiguous');
  const link = links[0];
  if (link.verifiedBy !== 'security-v1-convoy-radio-link' ||
    link.localIdentityRef !== membership.localIdentityRef ||
    link.membershipRecordRef !== membership.membershipRecordRef ||
    !validOpaque(link.linkRecordRef) || !validScope(link.radioScope)) {
    return unavailable('convoy-link-invalid');
  }
  const radio = validatedBindings(inputs, link.radioScope);
  if (!radio.ready) return radio;
  return {
    ready: true, reason: 'ready',
    destination: Object.freeze({
      ...radio.destination,
      convoy: Object.freeze({
        convoyId: membership.convoyId,
        localIdentityRef: membership.localIdentityRef,
        membershipRecordRef: membership.membershipRecordRef,
        linkRecordRef: link.linkRecordRef,
      }),
      key: JSON.stringify([radio.destination.key, membership.convoyId,
        membership.localIdentityRef, membership.membershipRecordRef, link.linkRecordRef]),
    }),
  };
}

export function sameDestination(
  a: ResolvedVoiceDestination,
  b: ResolvedVoiceDestination,
): boolean {
  return a.key === b.key && equalScope(a.scope, b.scope) &&
    a.chatRecordRef === b.chatRecordRef &&
    a.radioSessionEpoch === b.radioSessionEpoch &&
    (!a.convoy || !b.convoy ? a.convoy === b.convoy :
      a.convoy.convoyId === b.convoy.convoyId &&
      a.convoy.localIdentityRef === b.convoy.localIdentityRef &&
      a.convoy.membershipRecordRef === b.convoy.membershipRecordRef &&
      a.convoy.linkRecordRef === b.convoy.linkRecordRef);
}

function copyInputs(inputs: VoiceOperationalInputs): VoiceOperationalInputs {
  return {
    ...inputs,
    viewedConversation: inputs.viewedConversation
      ? {...inputs.viewedConversation} : null,
    activeConvoy: inputs.activeConvoy ? {...inputs.activeConvoy} : null,
    radioBindings: inputs.radioBindings.map(binding => ({
      ...binding, scope: copyScope(binding.scope),
    })),
    convoyLinks: inputs.convoyLinks.map(link => ({
      ...link, radioScope: copyScope(link.radioScope),
    })),
    nativeWake: {...inputs.nativeWake},
  };
}

export class VoiceOperationalSessionController {
  private readonly listeners = new Set<() => void>();
  private selection: VoiceSelectedConversation | null = null;
  private session: VoiceSessionSnapshot | null = null;
  private inputs: VoiceOperationalInputs;
  private sequence = 0;
  private readonly instanceRef: string;
  private readonly seenNativeEvents = new Set<string>();
  private readonly now: () => number;
  private snapshotValue: VoiceOperationalSnapshot;

  constructor(inputs: VoiceOperationalInputs, options: {
    now?: () => number; instanceRef?: string;
  } = {}) {
    this.now = options.now ?? Date.now;
    this.instanceRef = options.instanceRef ??
      'voice-' + this.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    this.inputs = copyInputs(inputs);
    this.snapshotValue = this.project();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): VoiceOperationalSnapshot => this.snapshotValue;

  private project(): VoiceOperationalSnapshot {
    const resolution = resolveVoiceDestination(this.selection, this.inputs);
    const session = this.session;
    const reason = session && session.status !== 'active'
      ? session.reason : resolution.reason;
    const readiness = !session ? (this.selection
      ? resolution.ready ? 'manual-ready' : 'unavailable'
      : 'needs-selection') : session.status === 'suspended'
        ? 'suspended' : session.status === 'invalidated'
          ? 'invalidated' : !resolution.ready
            ? 'unavailable' : session.handsFreeAuthorised
              ? 'hands-free-ready' : 'manual-ready';
    return Object.freeze({
      viewedConversation: this.inputs.viewedConversation
        ? Object.freeze({...this.inputs.viewedConversation}) : null,
      selectedVoiceConversation: this.selection,
      activeConvoy: this.inputs.activeConvoy
        ? Object.freeze({...this.inputs.activeConvoy}) : null,
      selectedTab: this.inputs.selectedTab,
      lifecycle: this.inputs.lifecycle,
      resolution,
      session,
      readiness,
      reason,
    });
  }

  private notify(): void {
    this.snapshotValue = this.project();
    this.listeners.forEach(listener => listener());
  }

  /** Safe to call for ANY tab navigation: it cannot silently select or
   * rewrite a voice destination, carrier, operational convoy or group.
   */
  updateInputs(next: VoiceOperationalInputs): void {
    const old = this.inputs;
    this.inputs = copyInputs(next);
    if (this.session?.status === 'active') {
      const previous = this.session;
      const fresh = resolveVoiceDestination(this.selection, this.inputs);
      if (!fresh.ready || !sameDestination(previous.destination, fresh.destination)) {
        this.invalidate(fresh.ready
          ? 'security-invalidated' : fresh.reason, false);
      } else if (old.selectedTab !== next.selectedTab && !previous.handsFreeAuthorised) {
        this.suspend('tab-changed', false);
      }
    }
    this.notify();
  }

  /** Only direct, explicit user UI selection may invoke this method.
   * Does NOT activate the microphone or grant hands-free access.
   */
  selectExplicit(selection: VoiceSelectedConversation | null): VoiceResolution {
    const checked = selection && (
      selection.kind === 'radio' ? validScope(selection.scope)
        : selection.kind === 'convoy' && validOpaque(selection.convoyId)
    ) ? copySelection(selection) : null;
    if (selection && !checked) return unavailable('invalid-destination');
    if (!sameSelection(this.selection, checked)) {
      if (this.session && this.session.status !== 'invalidated') {
        this.invalidate('cancelled', false);
      }
      this.selection = checked;
      this.session = null;
      this.seenNativeEvents.clear();
      this.notify();
    }
    return resolveVoiceDestination(this.selection, this.inputs);
  }

  /** Activation creates a new immutable per-session identity and frozen
   * destination snapshot. No audio or radio side-effects.
   */
  activateExplicit(): VoiceResolution {
    const resolved = resolveVoiceDestination(this.selection, this.inputs);
    if (!resolved.ready) {
      this.notify();
      return resolved;
    }
    if (this.session?.status === 'active') {
      // An automatic call cannot silently overwrite an active session.
      return unavailable('session-inactive');
    }
    this.sequence += 1;
    this.seenNativeEvents.clear();
    this.session = Object.freeze({
      identity: this.instanceRef + ':' + this.sequence,
      revision: this.sequence,
      status: 'active' as const,
      createdAtMs: this.now(),
      selected: copySelection(this.selection!),
      destination: resolved.destination,
      handsFreeAuthorised: false,
      authorisedDetectorOwnerRef: null,
      reason: 'ready' as const,
    });
    this.notify();
    return resolved;
  }

  /** Separate explicit user choice. This does not assert a detector exists:
   * native readiness must be supplied from an actual trusted native owner.
   */
  authoriseHandsFreeExplicit(): boolean {
    if (!this.session || this.session.status !== 'active' ||
      !this.inputs.nativeWake.supported ||
      !validOpaque(this.inputs.nativeWake.detectorOwnerRef) ||
      !this.isCurrent(this.session.identity)) return false;
    this.session = Object.freeze({
      ...this.session,
      handsFreeAuthorised: true,
      authorisedDetectorOwnerRef: this.inputs.nativeWake.detectorOwnerRef,
    });
    this.notify();
    return true;
  }

  revokeHandsFree(): void {
    if (this.session?.status !== 'active') return;
    this.session = Object.freeze({
      ...this.session, handsFreeAuthorised: false,
      authorisedDetectorOwnerRef: null,
    });
    this.seenNativeEvents.clear();
    this.notify();
  }

  private suspend(reason: VoiceReason, notify = true): void {
    if (this.session?.status !== 'active') return;
    this.session = Object.freeze({
      ...this.session, status: 'suspended' as const,
      handsFreeAuthorised: false, authorisedDetectorOwnerRef: null, reason,
    });
    this.seenNativeEvents.clear();
    if (notify) this.notify();
  }

  suspendSession(reason: 'suspended-by-user' | 'tab-changed' = 'suspended-by-user'): void {
    this.suspend(reason);
  }

  private invalidate(reason: VoiceReason, notify = true): void {
    if (!this.session || this.session.status === 'invalidated') return;
    this.session = Object.freeze({
      ...this.session, status: 'invalidated' as const,
      handsFreeAuthorised: false, authorisedDetectorOwnerRef: null, reason,
    });
    this.seenNativeEvents.clear();
    if (notify) this.notify();
  }

  invalidateSecurity(): void {
    this.invalidate('security-invalidated');
  }

  conversationRemoved(scope: RadioConversationScope): void {
    if (this.selection?.kind !== 'radio' ||
      !equalScope(this.selection.scope, scope)) {
      if (this.session?.destination.convoy &&
        equalScope(this.session.destination.scope, scope)) {
        this.invalidate('conversation-removed');
      }
      return;
    }
    this.invalidate('conversation-removed');
  }

  /** Cancelling never resurrects an earlier destination. Fresh activation
   * requires explicit UI intent and gets a different identity.
   */
  deactivateExplicit(): void {
    if (this.session) {
      this.invalidate('cancelled', false);
    }
    this.selection = null;
    this.session = null;
    this.seenNativeEvents.clear();
    this.notify();
  }

  isCurrent(identity: string): boolean {
    const session = this.session;
    if (!session || session.identity !== identity ||
      session.status !== 'active') return false;
    const fresh = resolveVoiceDestination(this.selection, this.inputs);
    return fresh.ready && sameDestination(session.destination, fresh.destination);
  }

  /** Reject all events by default. Only future trusted native wake adapter
   * may call this, and only when a separate explicit hands-free grant exists.
   * A returned admission is NOT a command, microphone start or send.
   */
  admitNativeWakeEvent(event: WakeEvent): WakeAdmission {
    const s = this.session;
    const denied = (reason: VoiceReason): WakeAdmission =>
      ({admitted: false, reason, sessionIdentity: null, destination: null});
    if (!s || s.status !== 'active' || !this.isCurrent(s.identity)) {
      return denied('session-inactive');
    }
    if (!s.handsFreeAuthorised ||
      !this.inputs.nativeWake.supported ||
      !s.authorisedDetectorOwnerRef ||
      s.authorisedDetectorOwnerRef !== this.inputs.nativeWake.detectorOwnerRef) {
      return denied('wake-detector-unavailable');
    }
    if (event.source !== 'native-wake-detector' ||
      !validOpaque(event.detectorOwnerRef) ||
      event.detectorOwnerRef !== s.authorisedDetectorOwnerRef) {
      return denied('wake-event-untrusted');
    }
    if (event.sessionIdentity !== s.identity ||
      event.sessionRevision !== s.revision) {
      return denied('wake-session-mismatch');
    }
    const now = this.now();
    if (!validOpaque(event.eventId) ||
      !Number.isFinite(event.occurredAtMs) ||
      event.occurredAtMs < s.createdAtMs ||
      event.occurredAtMs > now + 500 ||
      now - event.occurredAtMs > 5_000) return denied('wake-event-stale');
    if (this.seenNativeEvents.has(event.eventId)) return denied('wake-event-replayed');
    this.seenNativeEvents.add(event.eventId);
    if (this.seenNativeEvents.size > 256) {
      // Session-level replay set is bounded; fail closed rather than evicting.
      this.suspend('wake-event-replayed');
      return denied('wake-event-replayed');
    }
    return {
      admitted: true, reason: 'ready',
      sessionIdentity: s.identity, destination: s.destination,
    };
  }
}
