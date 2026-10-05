import {SerialTaskQueue} from '../src/meshcore/serialTaskQueue';

describe('SerialTaskQueue', () => {
  test('runs tasks one at a time in enqueue order', async () => {
    const queue = new SerialTaskQueue();
    const order: string[] = [];

    let releaseFirst: (() => void) | null = null;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue('first', async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
      return 1;
    });

    const second = queue.enqueue('second', async () => {
      order.push('second-start');
      order.push('second-end');
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(['first-start']);

    releaseFirst?.();

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(order).toEqual([
      'first-start',
      'first-end',
      'second-start',
      'second-end',
    ]);
  });

  test('cancelPending prevents queued work from starting', async () => {
    const queue = new SerialTaskQueue();

    let releaseFirst: (() => void) | null = null;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue('first', async () => {
      await firstGate;
      return 'done';
    });

    const second = queue.enqueue('second', async () => 'should-not-run');

    await Promise.resolve();
    queue.cancelPending();
    releaseFirst?.();

    await expect(first).resolves.toBe('done');
    await expect(second).rejects.toThrow('second cancelled.');
  });
});
