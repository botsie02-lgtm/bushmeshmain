import {createIdleReassembler} from '../src/meshcore/meshcoreReassembler';

describe('MeshCore BLE frame handling', () => {
  test('forwards every BLE notification as its own frame', () => {
    const frames: number[][] = [];
    const reassembler = createIdleReassembler(frame => frames.push(frame));

    reassembler.pushChunk([0x05, 0x01, 0x02]);
    reassembler.pushChunk([0x0d, 0x03, 0x04]);

    expect(frames).toEqual([
      [0x05, 0x01, 0x02],
      [0x0d, 0x03, 0x04],
    ]);
  });

  test('ignores empty notifications', () => {
    const frames: number[][] = [];
    const reassembler = createIdleReassembler(frame => frames.push(frame));

    reassembler.pushChunk([]);

    expect(frames).toEqual([]);
  });

  test('copies notification bytes before publishing them', () => {
    const frames: number[][] = [];
    const bytes = [0x12, 0x01, 0x02];
    const reassembler = createIdleReassembler(frame => frames.push(frame));

    reassembler.pushChunk(bytes);
    bytes[0] = 0xff;

    expect(frames[0]).toEqual([0x12, 0x01, 0x02]);
  });
});
