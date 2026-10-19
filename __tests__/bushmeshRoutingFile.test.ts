import {
  BushMeshFileContentType,
  BushMeshFileReceiver,
  BushMeshRoutingTable,
  decodeFileAck,
  decodeFileResumeRequest,
  prepareFileTransfer,
} from '../src/bushmesh/protocol';

describe('Bushmesh routing and file transfer', () => {
  test('selects the best route while accounting for hop count and freshness', () => {
    const routes = new BushMeshRoutingTable();

    routes.learn({
      destinationNodeId: 50,
      nextHopNodeId: 2,
      hopCount: 2,
      linkScore: 85,
      now: 1000,
      ttlMs: 10000,
    });
    routes.learn({
      destinationNodeId: 50,
      nextHopNodeId: 3,
      hopCount: 1,
      linkScore: 82,
      now: 1500,
      ttlMs: 10000,
    });

    expect(routes.bestRoute(50, 2000)?.nextHopNodeId).toBe(3);
    expect(routes.bestRoute(50, 2000, [3])?.nextHopNodeId).toBe(2);
  });

  test('expires stale routes and removes routes through a failed neighbor', () => {
    const routes = new BushMeshRoutingTable();
    routes.learn({
      destinationNodeId: 80,
      nextHopNodeId: 4,
      hopCount: 1,
      linkScore: 90,
      now: 1000,
      ttlMs: 1000,
    });
    routes.learn({
      destinationNodeId: 81,
      nextHopNodeId: 4,
      hopCount: 2,
      linkScore: 75,
      now: 1500,
      ttlMs: 5000,
    });

    expect(routes.prune(2000)).toBe(1);
    expect(routes.removeVia(4)).toBe(1);
    expect(routes.bestRoute(81, 2001)).toBeNull();
  });

  test('prepares chunks, ACKs missing chunks, resumes, and reconstructs the file', () => {
    const data = Array.from({length: 271}, (_, index) => (index * 17) & 0xff);
    const transfer = prepareFileTransfer(700, data, {
      chunkSize: 40,
      contentType: BushMeshFileContentType.GpsRoute,
      fileName: 'track.bin',
    });
    const receiver = new BushMeshFileReceiver();

    const metadata = receiver.begin(transfer.startFrame);
    expect(metadata.fileSize).toBe(271);
    expect(transfer.chunkFrames).toHaveLength(7);

    // Deliberately skip chunk 3 on the first pass.
    transfer.chunkFrames.forEach((frame, index) => {
      if (index !== 3) {
        receiver.acceptChunk(frame);
      }
    });

    const progress = receiver.progress();
    expect(progress.complete).toBe(false);
    expect(progress.missingChunkIndexes).toEqual([3]);

    const ack = decodeFileAck(receiver.buildAckWindow(0, 7));
    expect(ack.missingChunkIndexes).toEqual([3]);

    const resume = decodeFileResumeRequest(receiver.buildResumeRequest());
    expect(resume.nextMissingChunkIndex).toBe(3);

    receiver.acceptChunk(transfer.chunkFrames[3]);
    expect(receiver.progress().complete).toBe(true);
    expect(receiver.finish(transfer.endFrame)).toEqual(data);
  });

  test('rejects corrupted file chunks before storing them', () => {
    const transfer = prepareFileTransfer(701, [1, 2, 3, 4, 5], {chunkSize: 5});
    const receiver = new BushMeshFileReceiver();
    receiver.begin(transfer.startFrame);

    const corrupted = [...transfer.chunkFrames[0]];
    corrupted[corrupted.length - 1] ^= 0xff;

    expect(() => receiver.acceptChunk(corrupted)).toThrow('CRC mismatch');
  });
});
