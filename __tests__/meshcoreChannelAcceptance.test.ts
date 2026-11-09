import {Buffer} from 'buffer';
import type {BleManager, Device} from 'react-native-ble-plx';

import {MeshCoreClient} from '../src/meshcore/MeshCoreClient';
import type {MeshCoreFrameTransport} from '../src/meshcore/MeshCoreFrameTransport';
import {NativeMeshCoreSession} from '../src/meshcore/NativeMeshCoreSession';
import {parseMeshCoreSendAccepted} from '../src/meshcore/meshcoreDelivery';
import {
  classifyChannelSubmissionFailure,
  formatChannelSubmissionFailure,
} from '../src/meshcore/channelSendDiagnostics';
import {
  createMessageSnapshot,
  decodeMessageSnapshot,
  encodeMessageSnapshot,
} from '../src/persistence/messageSnapshot';

type Reply = 'ok' | 'error' | 'missing' | 'sent-instead' | 'sent-then-ok';

function makeSelfInfo(): number[] {
  const bytes = new Array<number>(70).fill(0);
  bytes[0] = 0x05;
  bytes[2] = 20;
  bytes[3] = 22;
  for (let i = 0; i < 32; i += 1) bytes[4 + i] = i + 1;
  return bytes;
}

function makeDeviceInfo(): number[] {
  const bytes = new Array<number>(82).fill(0);
  bytes[0] = 0x0d;
  bytes[1] = 9;
  bytes[2] = 32;
  bytes[3] = 8;
  return bytes;
}

function replyFrames(reply: Reply): number[][] {
  switch (reply) {
    case 'ok': return [[0x00]];
    case 'error': return [[0x01, 0x06]];
    case 'missing': return [];
    case 'sent-instead': return [[0x06, 0, 1, 2, 3, 4, 0, 0, 0, 0]];
    case 'sent-then-ok': return [[0x06, 0, 1, 2, 3, 4, 0, 0, 0, 0], [0x00]];
  }
}

function nativeHarness(initial: Reply) {
  let reply = initial;
  let onFrame: ((bytes: number[]) => void) | undefined;
  const writes: number[][] = [];
  const emit = (bytes: number[]) => {
    Promise.resolve().then(() => onFrame?.(bytes));
  };
  const transport: MeshCoreFrameTransport = {
    id: 'native-channel-test',
    start: jest.fn(async events => {
      onFrame = events.onFrame;
    }),
    stop: jest.fn(async () => undefined),
    ensureReady: jest.fn(async () => 185),
    writeBase64: jest.fn(async data => {
      const bytes = Array.from(Buffer.from(data, 'base64'));
      writes.push(bytes);
      if (bytes[0] === 0x01) emit(makeSelfInfo());
      else if (bytes[0] === 0x16) emit(makeDeviceInfo());
      else if (bytes[0] === 0x0a) emit([0x0a]);
      else if (bytes[0] === 0x03) replyFrames(reply).forEach(emit);
    }),
  };
  const onStatus = jest.fn();
  const session = new NativeMeshCoreSession(transport, {onStatus});
  return {session, onStatus, writes, setReply: (next: Reply) => {reply = next;}};
}

function jsGattHarness(initial: Reply) {
  let reply = initial;
  let onNotification: ((error: Error | null, characteristic: {value: string} | null) => void) | null = null;
  const writes: number[][] = [];
  const emit = (bytes: number[]) => {
    Promise.resolve().then(() => onNotification?.(null, {
      value: Buffer.from(bytes).toString('base64'),
    }));
  };
  const manager = {
    onDeviceDisconnected: jest.fn(() => ({remove: jest.fn()})),
    monitorCharacteristicForDevice: jest.fn(
      (_id: string, _service: string, _tx: string, cb: typeof onNotification) => {
        onNotification = cb;
        return {remove: jest.fn()};
      },
    ),
    requestMTUForDevice: jest.fn(async () => ({mtu: 185})),
    writeCharacteristicWithResponseForDevice: jest.fn(
      async (_id: string, _service: string, _rx: string, data: string) => {
        const bytes = Array.from(Buffer.from(data, 'base64'));
        writes.push(bytes);
        if (bytes[0] === 0x0a) emit([0x0a]);
        if (bytes[0] === 0x03) replyFrames(reply).forEach(emit);
        return {};
      },
    ),
  };
  const events = {
    onTxChunk: jest.fn(),
    onTxFrame: jest.fn(),
    onStatus: jest.fn(),
    onError: jest.fn(),
  };
  const client = new MeshCoreClient(
    manager as unknown as BleManager,
    {id: 'ble-channel-test'} as Device,
    events,
  );
  client.start();
  return {client, events, writes, setReply: (next: Reply) => {reply = next;}};
}

describe('MeshCore channel text 0x03 accepts only firmware PACKET_OK 0x00', () => {
  it('native: resolves PACKET_OK for channel #4 and emits no peer-delivered claim', async () => {
    const h = nativeHarness('ok');
    await h.session.start();
    const response = await h.session.sendChannelMessage(4, 'A TO B RF 003');
    expect(response.packetType).toBe(0x00);
    expect(response.label).toBe('PACKET_OK');
    expect(h.writes.filter(bytes => bytes[0] === 0x03)).toHaveLength(1);
    expect(h.writes.find(bytes => bytes[0] === 0x03)?.[2]).toBe(4);
    expect(h.onStatus.mock.calls.flat().join(' ')).toContain('PACKET_OK');
    await h.session.stop();
  });

  it('native: preserves PACKET_ERROR firmware code and clears pending state', async () => {
    const h = nativeHarness('error');
    await h.session.start();
    await expect(h.session.sendChannelMessage(4, 'test')).rejects.toThrow(/PACKET_ERROR.*6/);
    h.setReply('ok');
    await expect(h.session.sendChannelMessage(4, 'next')).resolves.toMatchObject({
      packetType: 0x00,
    });
    await h.session.stop();
  });

  it('native: ignores RESP_CODE_SENT 0x06 for channel text, then accepts 0x00', async () => {
    const h = nativeHarness('sent-then-ok');
    await h.session.start();
    expect((await h.session.sendChannelMessage(4, 'test')).packetType).toBe(0x00);
    await h.session.stop();
  });

  it('native: missing response times out and does not auto-resend', async () => {
    const h = nativeHarness('missing');
    await h.session.start();
    await expect(h.session.sendChannelMessage(4, 'only once')).rejects.toThrow(/timed out/i);
    expect(h.writes.filter(bytes => bytes[0] === 0x03)).toHaveLength(1);
    h.setReply('ok');
    await expect(h.session.sendChannelMessage(4, 'explicit next send')).resolves.toMatchObject({
      packetType: 0x00,
    });
    await h.session.stop();
  }, 8_000);

  it('JS-GATT: resolves PACKET_OK and preserves carrier-not-peer semantics', async () => {
    const h = jsGattHarness('ok');
    const result = await h.client.sendChannelMessage(4, 'A TO B RF 003');
    expect(result.label).toBe('CHANNEL_MESSAGE_ACCEPTED');
    expect(result.detail).toMatch(/Peer delivery is not yet confirmed/i);
    expect(h.events.onStatus.mock.calls.flat().join(' ')).toContain('PACKET_OK');
    expect(h.writes.filter(bytes => bytes[0] === 0x03)).toHaveLength(1);
    h.client.stop();
  });

  it('JS-GATT: PACKET_ERROR code 6 is rejected and next queued command succeeds', async () => {
    const h = jsGattHarness('error');
    await expect(h.client.sendChannelMessage(4, 'test')).rejects.toThrow(/PACKET_ERROR.*error code 6/i);
    h.setReply('ok');
    await expect(h.client.sendChannelMessage(4, 'next')).resolves.toMatchObject({
      label: 'CHANNEL_MESSAGE_ACCEPTED',
    });
    h.client.stop();
  });

  it('JS-GATT: ignores 0x06 for channel send and waits for the correct 0x00', async () => {
    const h = jsGattHarness('sent-then-ok');
    await expect(h.client.sendChannelMessage(4, 'test')).resolves.toMatchObject({
      label: 'CHANNEL_MESSAGE_ACCEPTED',
    });
    h.client.stop();
  });

  it('JS-GATT: missing response times out with no automatic duplicate write', async () => {
    const h = jsGattHarness('missing');
    await expect(h.client.sendChannelMessage(4, 'only once')).rejects.toThrow(/timed out waiting for PACKET_OK/i);
    expect(h.writes.filter(bytes => bytes[0] === 0x03)).toHaveLength(1);
    h.setReply('ok');
    await expect(h.client.sendChannelMessage(4, 'explicit next send')).resolves.toMatchObject({
      label: 'CHANNEL_MESSAGE_ACCEPTED',
    });
    h.client.stop();
  }, 8_000);

  it('direct/contact RESP_CODE_SENT 0x06 still carries an expected ACK tag', () => {
    const sent = parseMeshCoreSendAccepted([0x06, 0, 0xaa, 0xbb, 0xcc, 0xdd, 0xf4, 0x01, 0, 0]);
    expect(sent).toEqual({
      route: 'direct',
      expectedAckHex: 'AABBCCDD',
      suggestedTimeoutMs: 500,
    });
    expect(parseMeshCoreSendAccepted([0x00])).toBeNull();
  });

  it('Radio History retains only bounded diagnostic reason and numeric error code', () => {
    const failure = classifyChannelSubmissionFailure(
      new Error('CMD_SEND_CHANNEL_MESSAGE_4 returned PACKET_ERROR (error code 6). PSK SENSITIVE-SECRET'),
    );
    expect(failure).toEqual({reason: 'firmware-error', firmwareCode: 6});
    expect(formatChannelSubmissionFailure(failure)).toMatch(/PACKET_ERROR \(0x01\).*code 6/);
    expect(JSON.stringify(failure)).not.toContain('SENSITIVE-SECRET');

    const message = {
      id: 'm1',
      channelIndex: '4',
      channelName: 'Private Convoy',
      text: 'A TO B RF 003',
      direction: 'sent' as const,
      status: 'failed' as const,
      submissionFailure: failure,
      createdAt: new Date(0).toISOString(),
    };
    const encoded = encodeMessageSnapshot(createMessageSnapshot([message], 1));
    const restored = decodeMessageSnapshot(encoded);
    expect(restored.messages[0].submissionFailure).toEqual(failure);
    expect(encoded).not.toContain('SENSITIVE-SECRET');
    expect(formatChannelSubmissionFailure(classifyChannelSubmissionFailure(
      new Error('CMD_SEND_CHANNEL_MESSAGE_4 timed out waiting for PACKET_OK'),
    ))).toMatch(/may have transmitted.*Do not automatically resend/i);
  });
});
