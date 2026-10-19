import {InMemoryBushMeshOutbox} from '../src/bushmesh/outbox';

describe('Bushmesh outbound queue', () => {
  test('safety traffic is selected before lower-priority traffic', () => {
    const outbox = new InMemoryBushMeshOutbox();
    outbox.enqueue({
      channelIndex: 0,
      dataType: 0xff00,
      payload: Uint8Array.from([1]),
      priority: 'position',
      description: 'position',
      createdAtMs: 1_000,
    });
    const safety = outbox.enqueue({
      channelIndex: 0,
      dataType: 0xff00,
      payload: Uint8Array.from([2]),
      priority: 'safety',
      description: 'stop',
      createdAtMs: 1_001,
    });

    expect(outbox.nextReady(2_000)?.id).toBe(safety.id);
  });

  test('same-priority traffic stays FIFO', () => {
    const outbox = new InMemoryBushMeshOutbox();
    const first = outbox.enqueue({
      channelIndex: 0,
      dataType: 0xff00,
      payload: Uint8Array.from([1]),
      priority: 'control',
      description: 'first',
      createdAtMs: 100,
    });
    outbox.enqueue({
      channelIndex: 0,
      dataType: 0xff00,
      payload: Uint8Array.from([2]),
      priority: 'control',
      description: 'second',
      createdAtMs: 101,
    });

    expect(outbox.nextReady(1_000)?.id).toBe(first.id);
  });

  test('failed sends are requeued with exponential backoff', () => {
    const outbox = new InMemoryBushMeshOutbox();
    const entry = outbox.enqueue({
      channelIndex: 0,
      dataType: 0xff00,
      payload: Uint8Array.from([1]),
      priority: 'message',
      description: 'message',
      createdAtMs: 1_000,
    });

    outbox.markAttempt(entry.id, 1_000);
    const failed = outbox.markFailed(entry.id, 'link down', 1_100);

    expect(failed.state).toBe('queued');
    expect(failed.attempts).toBe(1);
    expect(failed.nextAttemptAtMs).toBe(3_100);
    expect(outbox.nextReady(3_099)).toBeNull();
    expect(outbox.nextReady(3_100)?.id).toBe(entry.id);
  });

  test('entries fail terminally after max attempts', () => {
    const outbox = new InMemoryBushMeshOutbox();
    const entry = outbox.enqueue({
      channelIndex: 0,
      dataType: 0xff00,
      payload: Uint8Array.from([1]),
      priority: 'safety',
      description: 'help',
      createdAtMs: 1_000,
      maxAttempts: 2,
    });

    outbox.markAttempt(entry.id, 1_000);
    outbox.markFailed(entry.id, 'one', 1_100);
    outbox.markAttempt(entry.id, 3_100);
    const terminal = outbox.markFailed(entry.id, 'two', 3_200);

    expect(terminal.state).toBe('failed');
    expect(terminal.attempts).toBe(2);
    expect(outbox.nextReady(100_000)).toBeNull();
  });

  test('accepted entries remain distinguishable from peer delivery', () => {
    const outbox = new InMemoryBushMeshOutbox();
    const entry = outbox.enqueue({
      channelIndex: 0,
      dataType: 0xff00,
      payload: Uint8Array.from([1]),
      priority: 'safety',
      description: 'stop',
      createdAtMs: 1_000,
    });

    outbox.markAttempt(entry.id, 1_000);
    const accepted = outbox.markAccepted(entry.id, 1_050);

    expect(accepted.state).toBe('accepted');
    expect(accepted.acceptedAtMs).toBe(1_050);
  });
});
