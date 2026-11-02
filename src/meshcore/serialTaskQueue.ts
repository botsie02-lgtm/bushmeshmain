export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;

  enqueue<T>(label: string, task: () => Promise<T>): Promise<T> {
    const generation = this.generation;

    const result = this.tail.then(async () => {
      if (generation !== this.generation) {
        throw new Error(`${label} cancelled.`);
      }

      return task();
    });

    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  cancelPending(): void {
    this.generation += 1;
  }
}
