import {Buffer} from 'buffer';
import type {BushMeshLocationFix} from '../../location/positionPlanner';
import {
  RollingAirtimeBudget,
  estimateLoRaAirtimeMs,
  type LoRaModemParams,
} from '../../radio/loraAirtime';
import type {MeshCoreInboundEnvelope} from '../../meshcore/meshcoreInboundInbox';
import {
  CHANNEL_FIELD_MAX_FIX_AGE_MS,
  CHANNEL_FIELD_MAX_FUTURE_MS,
  CHANNEL_FIELD_MAX_MESSAGE_AGE_MS,
  channelFieldSessionToken,
  decodeUnverifiedChannelPosition,
  encodeUnverifiedChannelPosition,
} from './channelFieldWire';

export const CHANNEL_FIELD_PRIVACY_WARNING =
  'UNVERIFIED CHANNEL POSITION: every participant with this MeshCore channel key may receive your coordinates. ' +
  'Channel encryption does not authenticate the sender or establish convoy membership. ' +
  'Do not use these markers for safety, navigation, or verified member tracking.';

export const CHANNEL_FIELD_MIN_INTERVAL_MS = 60_000;
export const CHANNEL_FIELD_WINDOW_MS = 600_000;
export const CHANNEL_FIELD_MAX_SENDS_PER_WINDOW = 6;
export const CHANNEL_FIELD_MAX_AIRTIME_MS = 15_000;
export const CHANNEL_FIELD_MAX_REMOTE_MARKERS = 20;
const CHANNEL_FIELD_ESTIMATED_FRAMING_OVERHEAD = 64;

export type AndroidFieldLocationSnapshot = {
  providerId: 'android-gps' | 'simulated' | 'none';
  status: 'tracking' | 'tracking-no-link' | 'stopped' | 'error';
  fix: BushMeshLocationFix | null;
};

/** Existing MeshCore channel text sender + existing shared inbound listener. */
export interface ChannelFieldRadioPort {
  isConnected(): boolean;
  isPrivateChannel(index: number): boolean;
  currentModem(): LoRaModemParams | null;
  sendChannelMessage(index: number, text: string): Promise<void>;
  subscribeMessages(listener: (envelope: MeshCoreInboundEnvelope) => void): () => void;
  subscribeConnection(listener: () => void): () => void;
  /** Existing Android/OS CSPRNG, not an identity-signing primitive. */
  randomBytes(length: number): Promise<Uint8Array>;
}

export type UnverifiedChannelRemotePosition = {
  kind: 'UNVERIFIED CHANNEL POSITION';
  channelIndex: number;
  /** A sender-chosen label can be copied or spoofed by ANY channel participant. */
  claimedLabel: string;
  claimedSession: string;
  transportSourceDeviceId: null;
  sourceAuthentication: 'none-channel-key-only';
  latitude: number;
  longitude: number;
  receivedAtMs: number;
  claimedFixTimeMs: number;
  expiresAtMs: number;
  freshness: 'recent' | 'stale';
};

export type ChannelFieldSnapshot = {
  kind: 'channel-only-field-test';
  sharingEnabled: boolean;
  sharingIndicator: 'UNVERIFIED CHANNEL POSITION SHARING' | 'OFF';
  channelIndex: number | null;
  privacyWarning: string;
  lastSubmission: 'not-sent' | 'submitted-to-meshcore' | 'failed-or-unknown';
  remoteMarkers: UnverifiedChannelRemotePosition[];
};

export type FieldSubmitResult =
  | {kind: 'suppressed'; reason: string}
  | {kind: 'submitted-to-meshcore'; /** NOT a remote peer ACK. */ sequence: number};

type RemoteRecord = UnverifiedChannelRemotePosition & {sequence: number};
type Listener = () => void;

function isRealFreshFix(snapshot: AndroidFieldLocationSnapshot, now: number): snapshot is AndroidFieldLocationSnapshot & {fix: BushMeshLocationFix} {
  const fix = snapshot.fix;
  return snapshot.providerId === 'android-gps' &&
    (snapshot.status === 'tracking' || snapshot.status === 'tracking-no-link') &&
    fix !== null &&
    Number.isFinite(fix.latitude) && fix.latitude >= -90 && fix.latitude <= 90 &&
    Number.isFinite(fix.longitude) && fix.longitude >= -180 && fix.longitude <= 180 &&
    Number.isSafeInteger(fix.timestampMs) && fix.timestampMs > 0 &&
    now - fix.timestampMs <= CHANNEL_FIELD_MAX_FIX_AGE_MS &&
    fix.timestampMs - now <= CHANNEL_FIELD_MAX_FUTURE_MS &&
    typeof fix.accuracyMeters === 'number' && Number.isFinite(fix.accuracyMeters) &&
    fix.accuracyMeters >= 0 && fix.accuracyMeters <= 100;
}

/**
 * In-memory and OFF by default. This class never writes into authorized
 * ConvoyMapMember[], VerifiedConvoyTelemetry, Security v2 or group membership.
 * Start and stop are explicit foreground controls: no background GPS service.
 */
export class ChannelFieldLocationSession {
  private enabled = false;
  private generation = 0;
  private token: string | null = null;
  private channel: number | null = null;
  private label = '';
  private sequence = 0;
  private lastAttemptMs: number | null = null;
  private inFlight = false;
  private lastSubmission: ChannelFieldSnapshot['lastSubmission'] = 'not-sent';
  private readonly sentAtMs: number[] = [];
  private readonly remote = new Map<string, RemoteRecord>();
  private readonly listeners = new Set<Listener>();
  private readonly airtime = new RollingAirtimeBudget({
    windowMs: CHANNEL_FIELD_WINDOW_MS, maxAirtimeMs: CHANNEL_FIELD_MAX_AIRTIME_MS,
  });
  private unsubscribeMessages: (() => void) | null = null;
  private unsubscribeConnection: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly radio: ChannelFieldRadioPort,
    private readonly readAndroidLocation: () => AndroidFieldLocationSnapshot,
    private readonly clock: () => number = Date.now,
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  }

  /** Does not show expired markers; never returns ConvoyMap authorisedMembers. */
  snapshot(): ChannelFieldSnapshot {
    this.expire();
    return {
      kind: 'channel-only-field-test',
      sharingEnabled: this.enabled,
      sharingIndicator: this.enabled ? 'UNVERIFIED CHANNEL POSITION SHARING' : 'OFF',
      channelIndex: this.channel,
      privacyWarning: CHANNEL_FIELD_PRIVACY_WARNING,
      lastSubmission: this.lastSubmission,
      remoteMarkers: [...this.remote.values()]
        .map(({sequence: _sequence, ...marker}) => ({...marker}))
        .sort((a, b) => a.claimedSession.localeCompare(b.claimedSession)),
    };
  }

  /**
   * Must be invoked only by an explicit user action after displaying the
   * full privacy warning. No automatic restart after BLE/radio reconnect.
   */
  async start(input: {
    channelIndex: number;
    claimedLabel: string;
    privacyWarningAccepted: true;
  }): Promise<boolean> {
    this.stop();
    const startGeneration = this.generation;
    if (input.privacyWarningAccepted !== true ||
        !Number.isInteger(input.channelIndex) || input.channelIndex < 0 ||
        input.channelIndex > 255 ||
        !/^[A-Za-z0-9_-]{1,12}$/.test(input.claimedLabel) ||
        !this.radio.isConnected() ||
        !this.radio.isPrivateChannel(input.channelIndex) ||
        !this.radio.currentModem()) return false;
    let token: string;
    try {
      token = channelFieldSessionToken(await this.radio.randomBytes(12));
    } catch {
      return false;
    }
    if (startGeneration !== this.generation || !this.radio.isConnected() ||
        !this.radio.isPrivateChannel(input.channelIndex) ||
        !this.radio.currentModem()) return false;
    this.token = token;
    this.channel = input.channelIndex;
    this.label = input.claimedLabel;
    this.enabled = true;
    this.unsubscribeMessages = this.radio.subscribeMessages(envelope => {this.ingest(envelope);});
    this.unsubscribeConnection = this.radio.subscribeConnection(() => {
      if (!this.radio.isConnected() ||
          (this.channel !== null && !this.radio.isPrivateChannel(this.channel))) this.stop();
    });
    // Foreground-only best-effort timer; paused JS cannot promise background sends.
    this.timer = setInterval(() => {
      this.expire();
      this.emit();
      this.shareLatestFix().catch(() => undefined);
    }, 10_000);
    this.emit();
    return true;
  }

  /** Immediate UI and queue gating; already submitted commands cannot be recalled from firmware. */
  stop(): void {
    ++this.generation;
    this.enabled = false;
    this.token = null;
    this.channel = null;
    this.label = '';
    this.sequence = 0;
    this.inFlight = false;
    this.lastAttemptMs = null;
    this.lastSubmission = 'not-sent';
    this.sentAtMs.length = 0;
    this.remote.clear();
    this.airtime.reset();
    this.unsubscribeMessages?.();
    this.unsubscribeMessages = null;
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.emit();
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  /** Safe to call whenever the genuine LocationSessionProvider latestFix changes. */
  async shareLatestFix(): Promise<FieldSubmitResult> {
    if (!this.enabled || this.channel === null || !this.token) {
      return {kind: 'suppressed', reason: 'disabled'};
    }
    if (this.inFlight) return {kind: 'suppressed', reason: 'send-in-progress'};
    if (!this.radio.isConnected() || !this.radio.isPrivateChannel(this.channel)) {
      this.stop();
      return {kind: 'suppressed', reason: 'radio-disconnected'};
    }
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now <= 0) {
      return {kind: 'suppressed', reason: 'invalid-clock'};
    }
    const gps = this.readAndroidLocation();
    if (!isRealFreshFix(gps, now)) {
      return {kind: 'suppressed', reason: 'no-fresh-real-android-gps'};
    }
    if (this.lastAttemptMs !== null && now - this.lastAttemptMs < CHANNEL_FIELD_MIN_INTERVAL_MS) {
      return {kind: 'suppressed', reason: 'minimum-interval'};
    }
    const recent = this.sentAtMs.filter(t => t > now - CHANNEL_FIELD_WINDOW_MS && t <= now);
    this.sentAtMs.splice(0, this.sentAtMs.length, ...recent);
    if (recent.length >= CHANNEL_FIELD_MAX_SENDS_PER_WINDOW || this.sequence >= 0xffffffff) {
      return {kind: 'suppressed', reason: 'rate-or-sequence-cap'};
    }
    const modem = this.radio.currentModem();
    if (!modem) return {kind: 'suppressed', reason: 'unknown-modem'};
    const sequence = this.sequence + 1;
    const text = encodeUnverifiedChannelPosition({
      session: this.token, sequence, issuedAtMs: gps.fix.timestampMs,
      latitude: gps.fix.latitude, longitude: gps.fix.longitude,
      claimedLabel: this.label,
    });
    let airtimeMs: number;
    try {
      airtimeMs = estimateLoRaAirtimeMs(
        Buffer.byteLength(text, 'utf8') + CHANNEL_FIELD_ESTIMATED_FRAMING_OVERHEAD,
        modem,
      ).totalDurationMs;
      if (!Number.isFinite(airtimeMs) || airtimeMs <= 0 ||
          !this.airtime.canSpend(airtimeMs, now)) {
        return {kind: 'suppressed', reason: 'airtime-budget'};
      }
    } catch {
      return {kind: 'suppressed', reason: 'invalid-radio-modem'};
    }
    const operationGeneration = this.generation;
    const channel = this.channel;
    // Reserve before invoking the command; failed or uncertain send consumes
    // this allowance to avoid retry storms. Never auto-retry.
    this.sequence = sequence;
    this.lastAttemptMs = now;
    this.sentAtMs.push(now);
    this.airtime.record(airtimeMs, now);
    this.inFlight = true;
    try {
      if (!this.enabled || operationGeneration !== this.generation ||
          !this.radio.isConnected() || !this.radio.isPrivateChannel(channel)) {
        return {kind: 'suppressed', reason: 'stopped-before-submission'};
      }
      await this.radio.sendChannelMessage(channel, text);
      if (operationGeneration !== this.generation || !this.enabled) {
        return {kind: 'suppressed', reason: 'stopped-during-submission'};
      }
      this.lastSubmission = 'submitted-to-meshcore';
      this.emit();
      return {kind: 'submitted-to-meshcore', sequence};
    } catch {
      if (operationGeneration === this.generation) {
        this.lastSubmission = 'failed-or-unknown';
        this.emit();
      }
      return {kind: 'suppressed', reason: 'radio-command-failed-or-unknown'};
    } finally {
      if (operationGeneration === this.generation) this.inFlight = false;
    }
  }

  /** Parsed MeshCore 0x08/0x11 channel text ONLY. Cannot identify the transmitting radio. */
  ingest(envelope: MeshCoreInboundEnvelope): boolean {
    if (!this.enabled || this.channel === null || !this.radio.isConnected()) return false;
    const index = Number(envelope.message.channelIndex);
    if (!Number.isInteger(index) || index !== this.channel ||
        !Number.isSafeInteger(envelope.receivedAtMs) || envelope.receivedAtMs <= 0) return false;
    const receivedAt = envelope.receivedAtMs;
    const now = this.clock();
    if (receivedAt > now + CHANNEL_FIELD_MAX_FUTURE_MS ||
        now - receivedAt > CHANNEL_FIELD_MAX_MESSAGE_AGE_MS) return false;
    const packet = decodeUnverifiedChannelPosition(envelope.message.text);
    if (!packet || packet.session === this.token ||
        packet.issuedAtMs > now + CHANNEL_FIELD_MAX_FUTURE_MS ||
        now - packet.issuedAtMs > CHANNEL_FIELD_MAX_MESSAGE_AGE_MS) return false;
    const firmwareTime = envelope.message.timestamp;
    if (firmwareTime !== null &&
        (!Number.isSafeInteger(firmwareTime) || firmwareTime < 0 ||
        Math.abs(firmwareTime * 1000 - packet.issuedAtMs) > 120_000)) return false;
    this.expire();
    const key = index + ':' + packet.session;
    const previous = this.remote.get(key);
    if (previous && (packet.sequence <= previous.sequence ||
        packet.issuedAtMs <= previous.claimedFixTimeMs)) return false;
    if (!previous && this.remote.size >= CHANNEL_FIELD_MAX_REMOTE_MARKERS) return false;
    this.remote.set(key, {
      kind: 'UNVERIFIED CHANNEL POSITION',
      channelIndex: index,
      claimedSession: packet.session,
      claimedLabel: packet.claimedLabel,
      transportSourceDeviceId: null,
      sourceAuthentication: 'none-channel-key-only',
      latitude: packet.latitude,
      longitude: packet.longitude,
      receivedAtMs: receivedAt,
      claimedFixTimeMs: packet.issuedAtMs,
      expiresAtMs: Math.min(receivedAt, packet.issuedAtMs) + CHANNEL_FIELD_MAX_MESSAGE_AGE_MS,
      freshness: 'recent',
      sequence: packet.sequence,
    });
    this.emit();
    return true;
  }

  private expire(): void {
    const now = this.clock();
    for (const [key, marker] of this.remote) {
      if (marker.expiresAtMs <= now || marker.receivedAtMs > now + CHANNEL_FIELD_MAX_FUTURE_MS) {
        this.remote.delete(key);
      } else {
        marker.freshness = now - marker.receivedAtMs > 45_000 ? 'stale' : 'recent';
      }
    }
  }
  private emit(): void {
    this.listeners.forEach(listener => {
      try {listener();} catch { /* UI observers never influence radio/persistence. */ }
    });
  }
}
