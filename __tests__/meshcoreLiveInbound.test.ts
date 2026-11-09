import {Buffer} from 'buffer';
import type {BleManager, Device} from 'react-native-ble-plx';

import {MeshCoreClient} from '../src/meshcore/MeshCoreClient';
import {MeshCoreFrameTransport} from '../src/meshcore/MeshCoreFrameTransport';
import {NativeMeshCoreSession} from '../src/meshcore/NativeMeshCoreSession';
import {MeshCoreInboundInbox} from '../src/meshcore/meshcoreInboundInbox';
import {meshCoreInboundMessageId, meshCoreSha256Hex} from '../src/meshcore/meshcoreInboundIdentity';
import {meshCoreInboundDiagnostics} from '../src/meshcore/meshcoreInboundDiagnostics';
import {ParsedChannelMessage} from '../src/meshcore/meshcoreParsers';
import {recoverMeshCoreCarrierProfile} from '../src/convoy/recoveredCarrier';
import {createMessageSnapshot, decodeMessageSnapshot, encodeMessageSnapshot} from '../src/persistence/messageSnapshot';

type InboundVariant = 'standard' | 'v3';

function channelFrame(slot: number, text: string, timestamp: number, variant: InboundVariant): number[] {
  const header = variant === 'v3' ? [0x11, 8, 0, 0] : [0x08];
  return [
    ...header, slot, 0xff, 0,
    timestamp & 0xff, (timestamp >>> 8) & 0xff,
    (timestamp >>> 16) & 0xff, (timestamp >>> 24) & 0xff,
    ...Array.from(Buffer.from(text, 'utf8')),
  ];
}

function selfInfo(): number[] {
  const bytes = new Array(70).fill(0);
  bytes[0] = 0x05;
  bytes[2] = 20;
  bytes[3] = 22;
  for (let i = 0; i < 32; i += 1) bytes[4 + i] = i + 1;
  return bytes;
}
function deviceInfo(): number[] {
  const bytes = new Array(82).fill(0);
  bytes[0] = 0x0d;
  bytes[1] = 9;
  bytes[2] = 32;
  bytes[3] = 8;
  return bytes;
}
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
async function until(condition: () => boolean, label: string, limit = 1_500): Promise<void> {
  const end = Date.now() + limit;
  while (!condition() && Date.now() < end) await delay(10);
  if (!condition()) throw new Error(`Timed out waiting for ${label}`);
}

function nativeHarness() {
  let onFrame: ((bytes: number[]) => void) | undefined;
  let heldNext = false;
  const queued: number[][] = [];
  const writes: number[][] = [];
  const onChannelMessage = jest.fn();
  const onMessagesWaiting = jest.fn();
  const emit = (frame: number[]) => Promise.resolve().then(() => onFrame?.(frame));
  const transport: MeshCoreFrameTransport = {
    id: 'native-live-inbound-test',
    start: jest.fn(async handlers => {onFrame = handlers.onFrame;}),
    stop: jest.fn(async () => undefined),
    ensureReady: jest.fn(async () => 185),
    writeBase64: jest.fn(async data => {
      const bytes = Array.from(Buffer.from(data, 'base64'));
      writes.push(bytes);
      if (bytes[0] === 0x01) void emit(selfInfo());
      if (bytes[0] === 0x16) void emit(deviceInfo());
      if (bytes[0] === 0x0a && !heldNext) void emit(queued.shift() ?? [0x0a]);
      if (bytes[0] === 0x03) {
        void emit([0x83]); // unsolicited while command 0x03 awaits 0x00
        void emit([0x00]);
      }
    }),
  };
  const session = new NativeMeshCoreSession(transport, {
    onChannelMessage, onMessagesWaiting,
  });
  return {
    session, writes, queued, transport, onChannelMessage, onMessagesWaiting,
    notify: () => emit([0x83]),
    holdNext: (value: boolean) => {heldNext = value;},
  };
}

function jsGattHarness() {
  let notification: ((error: Error | null, c: {value: string} | null) => void) | null = null;
  const queued: number[][] = [];
  const writes: number[][] = [];
  const onChannelMessage = jest.fn();
  const onMessagesWaiting = jest.fn();
  const emit = (frame: number[]) => Promise.resolve().then(
    () => notification?.(null, {value: Buffer.from(frame).toString('base64')}),
  );
  const manager = {
    onDeviceDisconnected: jest.fn(() => ({remove: jest.fn()})),
    monitorCharacteristicForDevice: jest.fn(
      (_id: string, _s: string, _c: string, cb: typeof notification) => {
        notification = cb;
        return {remove: jest.fn()};
      },
    ),
    requestMTUForDevice: jest.fn(async () => ({mtu: 185})),
    writeCharacteristicWithResponseForDevice: jest.fn(
      async (_id: string, _s: string, _c: string, data: string) => {
        const bytes = Array.from(Buffer.from(data, 'base64'));
        writes.push(bytes);
        if (bytes[0] === 0x0a) void emit(queued.shift() ?? [0x0a]);
        if (bytes[0] === 0x03) {
          void emit([0x83]);
          void emit([0x00]);
        }
      },
    ),
  };
  const client = new MeshCoreClient(
    manager as unknown as BleManager,
    {id: 'js-gatt-node'} as Device,
    {
      onTxChunk: jest.fn(), onTxFrame: jest.fn(), onStatus: jest.fn(),
      onError: jest.fn(), onChannelMessage, onMessagesWaiting,
    },
  );
  client.start();
  return {client, manager, writes, queued, onChannelMessage, onMessagesWaiting, notify: () => emit([0x83])};
}

describe('MeshCore live inbound queue drain / serial command paths', () => {
  beforeEach(() => meshCoreInboundDiagnostics.reset());

  it('Android native: 0x83 coalesces, two queued messages and both channel formats reach callbacks', async () => {
    const h = nativeHarness();
    await h.session.start();
    await until(() => h.writes.some(x => x[0] === 0x0a), 'startup queue empty');
    h.queued.push(
      channelFrame(4, 'B TO A RF 101', 1001, 'standard'),
      channelFrame(2, 'B TO A RF 102', 1002, 'v3'),
    );
    await h.notify();
    await h.notify();
    await h.notify();
    await until(() => h.onChannelMessage.mock.calls.length === 2, 'native two messages');
    await until(() => meshCoreInboundDiagnostics.snapshot().counts['queue-empty']! >= 2, 'queue empty');
    expect(h.onMessagesWaiting).toHaveBeenCalled();
    expect(h.onChannelMessage.mock.calls.map(([m]) => m.channelIndex)).toEqual(['4', '2']);
    expect(h.onChannelMessage.mock.calls.map(([m]) => m.text)).toEqual([
      'B TO A RF 101', 'B TO A RF 102',
    ]);
    const counts = meshCoreInboundDiagnostics.snapshot().counts;
    expect(counts['received-0x08']).toBe(1);
    expect(counts['received-0x11']).toBe(1);
    expect((counts['sync-submitted'] ?? 0)).toBeLessThan(10);
    await h.session.stop();
  });

  it('native: incoming 0x83 while a send awaits PACKET_OK cannot steal the send response', async () => {
    const h = nativeHarness();
    await h.session.start();
    h.queued.push(channelFrame(4, 'B TO A RF 103', 1003, 'v3'));
    const submitted = await h.session.sendChannelMessage(4, 'A TO B RF 103');
    expect(submitted.packetType).toBe(0x00);
    await until(() => h.onChannelMessage.mock.calls.length > 0, 'native receive during send');
    expect(h.writes.filter(x => x[0] === 0x03)).toHaveLength(1);
    expect(h.onChannelMessage.mock.calls[0][0].channelIndex).toBe('4');
    await h.session.stop();
  });

  it('native: bounded batch yields then continues past 20 to queue empty', async () => {
    const h = nativeHarness();
    await h.session.start();
    await until(() => h.writes.some(x => x[0] === 0x0a), 'initial sync');
    for (let i = 0; i < 23; i += 1) {
      h.queued.push(channelFrame(4, `Message ${i}`, 4000 + i, 'standard'));
    }
    await h.notify();
    await until(() => h.onChannelMessage.mock.calls.length === 23, 'all 23 native messages', 3_000);
    expect(meshCoreInboundDiagnostics.snapshot().counts['batch-continued']).toBeGreaterThan(0);
    await h.session.stop();
  });

  it('native: stop cancels in-flight drain; restart can resume with one native transport', async () => {
    const h = nativeHarness();
    await h.session.start();
    await until(() => h.writes.some(x => x[0] === 0x0a), 'initial sync');
    h.holdNext(true);
    await h.notify();
    await until(() => h.writes.filter(x => x[0] === 0x0a).length >= 2, 'in-flight read');
    await h.session.stop();
    h.holdNext(false);
    await h.session.start();
    h.queued.push(channelFrame(4, 'after restart', 5000, 'standard'));
    await h.notify();
    await until(() => h.onChannelMessage.mock.calls.length > 0, 'receive after restart');
    expect(h.transport.start).toHaveBeenCalledTimes(2);
    await h.session.stop();
  });

  it('JS GATT: 0x83 drains standard + V3 messages without a second BLE owner', async () => {
    const h = jsGattHarness();
    await until(() => h.writes.some(x => x[0] === 0x0a), 'JS initial sync');
    h.queued.push(
      channelFrame(4, 'B TO A RF 201', 2001, 'standard'),
      channelFrame(3, 'B TO A RF 202', 2002, 'v3'),
    );
    await h.notify();
    await until(() => h.onChannelMessage.mock.calls.length === 2, 'two JS GATT messages');
    expect(h.onChannelMessage.mock.calls.map(([m]) => m.channelIndex)).toEqual(['4', '3']);
    expect(h.manager.monitorCharacteristicForDevice).toHaveBeenCalledTimes(1);
    expect(h.writes.some(bytes => bytes[0] === 0x0a)).toBe(true);
    h.client.stop();
  });

  it('JS GATT: send response 0x00 remains correct while 0x83 is delivered', async () => {
    const h = jsGattHarness();
    h.queued.push(channelFrame(4, 'received in send', 3001, 'standard'));
    await expect(h.client.sendChannelMessage(4, 'submitted while inbound')).resolves.toMatchObject({
      label: 'CHANNEL_MESSAGE_ACCEPTED',
    });
    await until(() => h.onChannelMessage.mock.calls.length > 0, 'JS receive while send');
    expect(h.onChannelMessage.mock.calls[0][0].channelIndex).toBe('4');
    h.client.stop();
  });
});

describe('MeshCore inbound app inbox and restart idempotency', () => {
  it('has a SHA-256 digest and stable id across V3/legacy and link-quality changes', () => {
    expect(meshCoreSha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const base: ParsedChannelMessage = {
      packetType: 'channel', channelIndex: '4', text: 'B TO A RF 301',
      timestamp: 12345, textType: 0, pathLength: 255, snr: null,
    };
    const id = meshCoreInboundMessageId(base);
    expect(meshCoreInboundMessageId({...base, snr: 6.25, pathLength: 2})).toBe(id);
    expect(meshCoreInboundMessageId({...base, channelIndex: '3'})).not.toBe(id);
    expect(meshCoreInboundMessageId({...base, timestamp: 12346})).not.toBe(id);
    expect(id).not.toContain('B TO A');
  });

  it('does not claim-before-persist: a failed write keeps the inbox event and later retries', async () => {
    const inbox = new MeshCoreInboundInbox();
    const base: ParsedChannelMessage = {
      packetType: 'channel', channelIndex: '4', text: 'B TO A RF 302',
      timestamp: 302, textType: 0, pathLength: 255, snr: null,
    };
    let durableSaveAttempts = 0;
    const stored = new Set<string>();
    const unsubscribe = inbox.setConsumer(async ({message}) => {
      durableSaveAttempts += 1;
      if (durableSaveAttempts === 1) throw new Error('encrypted store unavailable');
      stored.add(meshCoreInboundMessageId(message)); // only after successful save
    });
    inbox.publish(base);
    await until(() => durableSaveAttempts === 1, 'first failing storage attempt');
    expect(inbox.pendingCount()).toBe(1);
    expect(stored.size).toBe(0);
    await until(() => stored.size === 1, 'retry and successful persistence', 3_500);
    expect(inbox.pendingCount()).toBe(0);
    unsubscribe();
  }, 5_500);

  it('restored encrypted history retains the same dedupe id after process restart', () => {
    const base: ParsedChannelMessage = {
      packetType: 'channel', channelIndex: '4', text: 'B TO A RF 303',
      timestamp: 303, textType: 0, pathLength: 255, snr: null,
    };
    const message = {
      id: meshCoreInboundMessageId(base),
      channelIndex: '4', channelName: 'Existing private convoy',
      text: base.text, direction: 'received' as const, status: 'confirmed' as const,
      createdAt: new Date(303000).toISOString(),
    };
    const encryptedStorePayload = encodeMessageSnapshot(createMessageSnapshot([message]));
    const restarted = decodeMessageSnapshot(encryptedStorePayload);
    const duplicate = {...message, createdAt: new Date(304000).toISOString()};
    expect(createMessageSnapshot([duplicate, ...restarted.messages]).messages).toHaveLength(1);
    expect(restarted.messages[0].channelIndex).toBe('4');
  });

  it('recovers configured carrier slot after restart without promoting to convoy enrollment', () => {
    const slots = [
      {channelIndex: '4', channelName: 'Existing private convoy', secret: 'Configured (redacted)'},
      {channelIndex: '5', channelName: 'Other private', secret: 'Configured (redacted)'},
      {channelIndex: '6', channelName: 'Empty', secret: 'Empty / Public'},
    ];
    const recovered = recoverMeshCoreCarrierProfile(slots, '4');
    expect(recovered).toEqual({
      origin: 'recovered', convoyId: '', convoyName: 'Configured MeshCore channel',
      channelName: 'Existing private convoy', channelIndex: 4,
    });
    expect(recoverMeshCoreCarrierProfile(slots, '5')?.channelIndex).toBe(5);
    expect(recoverMeshCoreCarrierProfile(slots.slice(2), '4')).toBeNull();
    expect(JSON.stringify(recovered)).not.toContain('PSK');
  });
});
