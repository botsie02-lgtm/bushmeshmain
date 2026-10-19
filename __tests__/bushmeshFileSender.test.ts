import {
  BushMeshFileReceiver,
  BushMeshFileSender,
  prepareFileTransfer,
} from '../src/bushmesh/protocol';

describe('Bushmesh file sender state', () => {
  test('uses receiver ACK windows to resend only missing chunks', () => {
    const data = Array.from({length: 180}, (_, index) => index & 0xff);
    const transfer = prepareFileTransfer(800, data, {chunkSize: 30});
    const sender = new BushMeshFileSender(transfer);
    const receiver = new BushMeshFileReceiver();
    receiver.begin(sender.startFrame());

    transfer.chunkFrames.forEach((frame, index) => {
      if (index !== 2 && index !== 5) {
        receiver.acceptChunk(frame);
      }
    });

    const missing = sender.framesForAck(receiver.buildAckWindow(0, 6));
    expect(missing.map(item => item.chunkIndex)).toEqual([2, 5]);
    expect(sender.progress().pendingChunkIndexes).toEqual([2, 5]);
  });

  test('resumes from the first missing chunk while skipping chunks already ACKed', () => {
    const data = Array.from({length: 200}, (_, index) => (index * 3) & 0xff);
    const transfer = prepareFileTransfer(801, data, {chunkSize: 25});
    const sender = new BushMeshFileSender(transfer);
    const receiver = new BushMeshFileReceiver();
    receiver.begin(transfer.startFrame);

    for (let index = 0; index < 4; index += 1) {
      receiver.acceptChunk(transfer.chunkFrames[index]);
    }

    sender.applyAckFrame(receiver.buildAckWindow(0, 8));
    const resumeFrames = sender.framesForResumeRequest(
      receiver.buildResumeRequest(),
      2,
    );

    expect(resumeFrames.map(item => item.chunkIndex)).toEqual([4, 5]);
  });
});
