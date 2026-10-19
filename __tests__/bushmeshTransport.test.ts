import {Buffer} from 'buffer';

import {
  BushMeshCompressionProfile,
  decodeBushMeshTextCarrier,
  decodeBushMeshWire,
  decodeDictionaryText,
  encodeBushMeshTextMessage,
  encodeDictionaryText,
} from '../src/bushmesh/protocol';
import {
  MeshCoreBushMeshReassembler,
  buildBushMeshBinaryChannelCommands,
  prepareBushMeshTextChannelFrames,
  sendBushMeshTextSafeChannelMessage,
} from '../src/meshcore/meshcoreBushMeshBridge';

function makeMeshCoreChannelFrame(payloadBytes: number[]): number[] {
  return [
    0x08,
    0x02,
    0x00,
    0x00,
    0x78,
    0x56,
    0x34,
    0x12,
    ...payloadBytes,
  ];
}

describe('Bushmesh text compression and MeshCore transport bridge', () => {
  test('dictionary compression is lossless and shrinks common radio text', () => {
    const text = 'heading back to camp';
    const encoded = encodeDictionaryText(text);

    expect(decodeDictionaryText(encoded)).toBe(text);
    expect(encoded.length).toBeLessThan(Buffer.byteLength(text, 'utf8'));
  });

  test('selects dictionary compression only when it saves bytes', () => {
    const encoded = encodeBushMeshTextMessage(
      'heading back to camp',
      101,
    );

    expect(encoded.compression).toBe(
      BushMeshCompressionProfile.TextDictionary,
    );
    expect(encoded.payloadByteLength).toBeLessThan(encoded.originalByteLength);

    const decoded = decodeBushMeshWire(encoded.wireBytes);
    expect(decoded.renderedText).toBe('heading back to camp');
  });

  test('text-safe carrier round-trips the binary wire message', () => {
    const encoded = encodeBushMeshTextMessage('Need water at camp', 102);
    const wireBytes = decodeBushMeshTextCarrier(encoded.textSafeCarrier);
    const decoded = decodeBushMeshWire(wireBytes);

    expect(decoded.renderedText).toBe('Need water at camp');
  });

  test('fragments long text-safe messages under the MeshCore payload limit and reassembles them', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(8);
    const frames = prepareBushMeshTextChannelFrames(text, 103, {
      transport: 'text-safe',
      maxPayloadBytes: 133,
    });

    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every(frame => frame.payloadBytes.length <= 133)).toBe(true);
    expect(frames.every(frame => frame.fragmented)).toBe(true);

    const reassembler = new MeshCoreBushMeshReassembler();
    let completedText: string | undefined;

    for (const frame of frames) {
      const result = reassembler.acceptMeshCoreFrame(
        makeMeshCoreChannelFrame(frame.payloadBytes),
      );

      if (result?.complete) {
        completedText = result.decoded?.renderedText;
      }
    }

    expect(completedText).toBe(text);
  });

  test('can send text-safe frames through the existing MeshCore public client API', async () => {
    const sent: Array<{channelIndex: number; message: string}> = [];
    const fakeClient = {
      sendChannelMessage: async (channelIndex: number, message: string) => {
        sent.push({channelIndex, message});
        return {ok: true};
      },
    };

    await sendBushMeshTextSafeChannelMessage(
      fakeClient,
      3,
      'heading back to camp',
      104,
    );

    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every(item => item.channelIndex === 3)).toBe(true);
    expect(sent.every(item => item.message.startsWith('~BM1:'))).toBe(true);
  });

  test('builds raw binary MeshCore commands without converting the Bushmesh payload to text', () => {
    const commands = buildBushMeshBinaryChannelCommands(
      4,
      'heading back to camp',
      105,
      {timestampSeconds: 0x12345678},
    );

    expect(commands).toHaveLength(1);

    const commandBytes = Array.from(Buffer.from(commands[0], 'base64'));
    expect(commandBytes.slice(0, 7)).toEqual([
      0x03,
      0x00,
      0x04,
      0x78,
      0x56,
      0x34,
      0x12,
    ]);
    expect(commandBytes[7]).toBe(0xb5);
    expect(commandBytes[8]).toBe(0x4d);
  });
});
