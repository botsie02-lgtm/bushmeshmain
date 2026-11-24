import {MeshCoreInboundInbox} from '../src/meshcore/meshcoreInboundInbox';
import {
  ChannelFieldLocationSession,
  CHANNEL_FIELD_PRIVACY_WARNING,
  type ChannelFieldRadioPort,
  type AndroidFieldLocationSnapshot,
} from '../src/convoy/fieldLocation/ChannelFieldLocationSession';
import {
  decodeUnverifiedChannelPosition,
  encodeUnverifiedChannelPosition,
} from '../src/convoy/fieldLocation/channelFieldWire';

const START = 1_800_000_000_000;
const MODEM = {spreadingFactor: 9, bandwidthKhz: 125, codingRate: 5 as const};

class TestChannelRadio implements ChannelFieldRadioPort {
  private static nextId = 1;
  private readonly id = TestChannelRadio.nextId++;
  connected = true;
  privateChannel = true;
  modem: typeof MODEM | null = MODEM;
  sent: string[] = [];
  onSend: ((channel: number, text: string) => Promise<void>) | null = null;
  private incoming = new Set<(envelope: {
    message: {packetType: 'channel'; channelIndex: string; text: string;
      timestamp: number | null; pathLength: number | null;
      textType: number | null; snr: number | null};
    receivedAtMs: number;
  }) => void>();
  private connections = new Set<() => void>();

  isConnected(): boolean {return this.connected;}
  isPrivateChannel(_index: number): boolean {return this.privateChannel;}
  currentModem() {return this.modem;}
  randomBytes(): Promise<Uint8Array> {return Promise.resolve(Uint8Array.from(Array(12).fill(this.id % 255)));}
  subscribeMessages(listener: Parameters<ChannelFieldRadioPort['subscribeMessages']>[0]): () => void {
    this.incoming.add(listener);
    return () => {this.incoming.delete(listener);};
  }
  subscribeConnection(listener: () => void): () => void {
    this.connections.add(listener);
    return () => {this.connections.delete(listener);};
  }
  async sendChannelMessage(channel: number, text: string): Promise<void> {
    this.sent.push(text);
    if (this.onSend) await this.onSend(channel, text);
  }
  receive(text: string, atMs: number, channelIndex = 4, firmwareTime: number | null = null): void {
    const envelope = {
      message: {
        packetType: 'channel' as const, channelIndex: String(channelIndex),
        text, timestamp: firmwareTime, pathLength: null, textType: 0, snr: null,
      },
      receivedAtMs: atMs,
    };
    this.incoming.forEach(listener => listener(envelope));
  }
  dropConnection(): void {
    this.connected = false;
    this.connections.forEach(listener => listener());
  }
  reconnect(): void {
    this.connected = true;
    this.connections.forEach(listener => listener());
  }
}

function fix(time: number, latitude = -37.81): AndroidFieldLocationSnapshot {
  return {
    providerId: 'android-gps', status: 'tracking',
    fix: {
      latitude, longitude: 144.96, timestampMs: time,
      accuracyMeters: 8, speedKmh: 0, headingDegrees: 0,
    },
  };
}

function makeSession(radio: TestChannelRadio, read: () => AndroidFieldLocationSnapshot, clock: () => number) {
  return new ChannelFieldLocationSession(radio, read, clock);
}
const consent = {channelIndex: 4, claimedLabel: 'Truck_A', privacyWarningAccepted: true as const};

describe('Wave 5 optional UNVERIFIED CHANNEL POSITION text format', () => {
  const valid = {
    session: 'ab'.repeat(12), sequence: 1,
    issuedAtMs: START, latitude: -37.81001, longitude: 144.96543,
    claimedLabel: 'Truck_A',
  };
  it('round-trips bounded ASCII location text within MeshCore 133-char limit', () => {
    const text = encodeUnverifiedChannelPosition(valid);
    expect(text.length).toBeLessThanOrEqual(110);
    expect(decodeUnverifiedChannelPosition(text)).toEqual(valid);
    expect(decodeUnverifiedChannelPosition(text + '|extra')).toBeNull();
    expect(decodeUnverifiedChannelPosition(text.replace('BMFL1', 'OTHER'))).toBeNull();
    expect(decodeUnverifiedChannelPosition(text.replace('|Truck_A', '|🚙'))).toBeNull();
    expect(decodeUnverifiedChannelPosition('x'.repeat(140))).toBeNull();
    expect(() => encodeUnverifiedChannelPosition({...valid, latitude: 95})).toThrow();
  });

  it('rejects noncanonical numbers, oversized content and invalid ranges', () => {
    const baseline = encodeUnverifiedChannelPosition(valid);
    expect(decodeUnverifiedChannelPosition(baseline.replace('|1|', '|01|'))).toBeNull();
    expect(decodeUnverifiedChannelPosition(baseline.replace('|1|', '|-1|'))).toBeNull();
    expect(decodeUnverifiedChannelPosition(baseline.replace('14496543', '19000000'))).toBeNull();
    expect(decodeUnverifiedChannelPosition(baseline.replace('ab'.repeat(12), 'spoof'))).toBeNull();
  });
});

describe('Wave 5 two virtual radios and opt-in field-only sharing', () => {
  let now = START;
  const sessions: ChannelFieldLocationSession[] = [];
  beforeEach(() => {now = START;});
  afterEach(() => {sessions.splice(0).forEach(session => session.dispose());});

  async function pair() {
    const a = new TestChannelRadio();
    const b = new TestChannelRadio();
    let gpsA = fix(now);
    let gpsB = fix(now, -37.82);
    a.onSend = async (_, text) => {b.receive(text, now);};
    b.onSend = async (_, text) => {a.receive(text, now);};
    const sender = makeSession(a, () => gpsA, () => now);
    const receiver = makeSession(b, () => gpsB, () => now);
    sessions.push(sender, receiver);
    expect(await sender.start(consent)).toBe(true);
    expect(await receiver.start({...consent, claimedLabel: 'Truck_B'})).toBe(true);
    return {a, b, sender, receiver, changeGpsA: (v: AndroidFieldLocationSnapshot) => {gpsA = v;},
      changeGpsB: (v: AndroidFieldLocationSnapshot) => {gpsB = v;}};
  }

  it('shares actual Android fixes across two virtual channels, never verified identities', async () => {
    const {sender, receiver, changeGpsB} = await pair();
    expect(CHANNEL_FIELD_PRIVACY_WARNING).toContain('every participant');
    expect(sender.snapshot().sharingIndicator).toBe('UNVERIFIED CHANNEL POSITION SHARING');
    expect((await sender.shareLatestFix()).kind).toBe('submitted-to-meshcore');
    const remote = receiver.snapshot().remoteMarkers;
    expect(remote).toHaveLength(1);
    expect(remote[0]).toMatchObject({
      kind: 'UNVERIFIED CHANNEL POSITION',
      claimedLabel: 'Truck_A',
      sourceAuthentication: 'none-channel-key-only',
      transportSourceDeviceId: null,
      latitude: -37.81,
    });
    // Different path and types: cannot masquerade as ConvoyMap.authorisedMembers.
    expect((remote[0] as unknown as {position?: unknown}).position).toBeUndefined();
    now += 60_001;
    changeGpsB(fix(now, -37.82));
    expect((await receiver.shareLatestFix()).kind).toBe('submitted-to-meshcore');
    expect(sender.snapshot().remoteMarkers).toHaveLength(1);
  });

  it('blocks duplicates, stale and delayed samples, future stamps and wrong channel', async () => {
    const {a, b, sender, receiver} = await pair();
    await sender.shareLatestFix();
    const original = a.sent[0];
    const before = receiver.snapshot().remoteMarkers[0].receivedAtMs;
    a.onSend = null;
    b.receive(original, now, 4);
    expect(receiver.snapshot().remoteMarkers[0].receivedAtMs).toBe(before);
    const payload = decodeUnverifiedChannelPosition(original)!;
    b.receive(encodeUnverifiedChannelPosition({...payload, sequence: 2}), now, 7);
    expect(receiver.snapshot().remoteMarkers).toHaveLength(1);
    b.receive(encodeUnverifiedChannelPosition({...payload, sequence: 2, issuedAtMs: now - 91_000}), now);
    b.receive(encodeUnverifiedChannelPosition({...payload, sequence: 2, issuedAtMs: now + 6_000}), now);
    b.receive(encodeUnverifiedChannelPosition({...payload, sequence: 2}), now, 4,
      Math.floor(now / 1000) + 200);
    expect(receiver.snapshot().remoteMarkers[0].receivedAtMs).toBe(before);
    now += 91_000;
    b.receive(original, now);
    expect(receiver.snapshot().remoteMarkers).toHaveLength(0);
  });

  it('sender labels are spoofable and never promoted to a verified transport source', async () => {
    const {sender, receiver, a, b} = await pair();
    await sender.shareLatestFix();
    const existing = decodeUnverifiedChannelPosition(a.sent[0])!;
    const spoofed = encodeUnverifiedChannelPosition({
      ...existing, sequence: 2, issuedAtMs: now + 1,
      claimedLabel: 'NotRealOwner', latitude: -37.83,
    });
    b.receive(spoofed, now);
    const marker = receiver.snapshot().remoteMarkers[0];
    expect(marker.claimedLabel).toBe('NotRealOwner');
    expect(marker.transportSourceDeviceId).toBeNull();
    expect(marker.sourceAuthentication).toBe('none-channel-key-only');
  });

  it('GPS loss, stale fix, simulation or poor accuracy cannot publish', async () => {
    const {sender, a, changeGpsA} = await pair();
    changeGpsA({...fix(now), providerId: 'simulated'});
    expect((await sender.shareLatestFix()).kind).toBe('suppressed');
    changeGpsA({...fix(now), fix: null});
    expect((await sender.shareLatestFix()).kind).toBe('suppressed');
    changeGpsA(fix(now - 35_000));
    expect((await sender.shareLatestFix()).kind).toBe('suppressed');
    changeGpsA(fix(now + 6_000));
    expect((await sender.shareLatestFix()).kind).toBe('suppressed');
    changeGpsA({...fix(now), fix: {...fix(now).fix!, accuracyMeters: 250}});
    expect((await sender.shareLatestFix()).kind).toBe('suppressed');
    expect(a.sent).toHaveLength(0);
    changeGpsA(fix(now));
    expect((await sender.shareLatestFix()).kind).toBe('submitted-to-meshcore');
  });

  it('limits rate, airtime, and never retries a failed/uncertain radio command', async () => {
    const {sender, a, changeGpsA} = await pair();
    expect((await sender.shareLatestFix()).kind).toBe('submitted-to-meshcore');
    expect((await sender.shareLatestFix()).kind).toBe('suppressed');
    for (let count = 0; count < 5; count++) {
      now += 60_001;
      changeGpsA(fix(now, -37.81 + count / 1000));
      const result = await sender.shareLatestFix();
      expect(result.kind).toBe('submitted-to-meshcore');
    }
    now += 60_001;
    changeGpsA(fix(now));
    expect(await sender.shareLatestFix()).toEqual({
      kind: 'suppressed', reason: 'rate-or-sequence-cap',
    });
    expect(a.sent).toHaveLength(6);
    now += 600_001;
    a.onSend = async () => {throw new Error('unknown firmware outcome');};
    changeGpsA(fix(now));
    expect((await sender.shareLatestFix()).kind).toBe('suppressed');
    expect(a.sent).toHaveLength(7);
    expect((await sender.shareLatestFix()).kind).toBe('suppressed');
    expect(a.sent).toHaveLength(7);
  });

  it('requires explicit consent, known private channel, modem and live radio', async () => {
    const radio = new TestChannelRadio();
    const session = makeSession(radio, () => fix(now), () => now);
    sessions.push(session);
    expect(await session.start({...consent, privacyWarningAccepted: false} as never)).toBe(false);
    radio.privateChannel = false;
    expect(await session.start(consent)).toBe(false);
    radio.privateChannel = true;
    radio.modem = null;
    expect(await session.start(consent)).toBe(false);
    radio.modem = MODEM;
    radio.connected = false;
    expect(await session.start(consent)).toBe(false);
    expect(radio.sent).toEqual([]);
  });

  it('disconnect stops immediately, reconnection never silently resumes sharing', async () => {
    const {sender, receiver, a} = await pair();
    await sender.shareLatestFix();
    expect(receiver.snapshot().remoteMarkers).toHaveLength(1);
    a.dropConnection();
    expect(sender.snapshot().sharingEnabled).toBe(false);
    expect(sender.snapshot().remoteMarkers).toEqual([]);
    a.reconnect();
    expect(sender.snapshot().sharingEnabled).toBe(false);
    expect(await sender.shareLatestFix()).toEqual({kind: 'suppressed', reason: 'disabled'});
  });

  it('manual stop removes markers immediately and prevents new commands', async () => {
    const {sender, receiver, b} = await pair();
    await sender.shareLatestFix();
    expect(receiver.snapshot().remoteMarkers).toHaveLength(1);
    receiver.stop();
    expect(receiver.snapshot().remoteMarkers).toEqual([]);
    b.receive(sender.snapshot().privacyWarning, now);
    expect(receiver.snapshot().remoteMarkers).toEqual([]);
    sender.stop();
    expect((await sender.shareLatestFix()).kind).toBe('suppressed');
  });

  it('expires unverified remote markers without persisting historical coordinates', async () => {
    const {sender, receiver} = await pair();
    await sender.shareLatestFix();
    now += 46_000;
    expect(receiver.snapshot().remoteMarkers[0].freshness).toBe('stale');
    now += 45_001;
    expect(receiver.snapshot().remoteMarkers).toHaveLength(0);
    receiver.stop();
    expect(receiver.snapshot().remoteMarkers).toHaveLength(0);
  });

  it('cannot claim a peer acknowledgement after MeshCore accepts command', async () => {
    const {sender} = await pair();
    const result = await sender.shareLatestFix();
    expect(result).toMatchObject({kind: 'submitted-to-meshcore'});
    expect(sender.snapshot().lastSubmission).toBe('submitted-to-meshcore');
    expect(JSON.stringify(sender.snapshot())).not.toContain('confirmed-by-peer');
  });

  it('stopping an in-flight send prevents post-stop state restoration', async () => {
    const {sender, a} = await pair();
    const pendingCommand: {complete?: () => void} = {};
    a.onSend = () => new Promise<void>(resolve => {pendingCommand.complete = resolve;});
    const pending = sender.shareLatestFix();
    await Promise.resolve();
    sender.stop();
    pendingCommand.complete?.();
    expect((await pending).kind).toBe('suppressed');
    expect(sender.snapshot().sharingEnabled).toBe(false);
    expect(sender.snapshot().lastSubmission).toBe('not-sent');
  });
});

describe('MeshCore durable inbox retains its original consumer alongside field listener', () => {
  it('does not replace, drop or acknowledge the app history consumer', async () => {
    const inbox = new MeshCoreInboundInbox();
    const observed: string[] = [];
    const persisted: string[] = [];
    const unobserve = inbox.subscribeObserved(envelope => {
      observed.push(envelope.message.text);
      throw new Error('field listener cannot interrupt history');
    });
    const unset = inbox.setConsumer(async envelope => {
      persisted.push(envelope.message.text);
    });
    inbox.publish({
      packetType: 'channel', channelIndex: '4', text: 'ordinary message',
      timestamp: Math.floor(START / 1000), pathLength: 0,
      textType: 0, snr: 5,
    });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(observed).toEqual(['ordinary message']);
    expect(persisted).toEqual(['ordinary message']);
    expect(inbox.pendingCount()).toBe(0);
    unobserve(); unset();
  });
});
