/**
 * MeshCore 0x83 is a hint that CMD_SYNC_NEXT_MESSAGE (0x0A) should be sent.
 * The command queue remains the sole serializer. One command per iteration,
 * bounded batches and a yield between batches let foreground commands proceed.
 */
export type MeshCoreQueuedReply = {packetType: number | null};
export type MeshCoreQueueStage =
  | 'push-0x83' | 'drain-scheduled' | 'sync-submitted' | 'queue-empty'
  | 'batch-continued' | 'drain-error';
export type MeshCoreQueueFailure = 'timeout' | 'disconnected' | 'firmware-error' | 'unknown';

const BATCH_LIMIT = 20;
const CONTINUE_DELAY_MS = 75;
const FAILURE_RETRY_MS = 2_000;

export function classifyMeshCoreQueueError(error: unknown): MeshCoreQueueFailure {
  const message = error instanceof Error ? error.message : '';
  if (/PACKET_ERROR/i.test(message)) return 'firmware-error';
  if (/timed out/i.test(message)) return 'timeout';
  if (/disconnect|cancel|stop|not started|not active/i.test(message)) return 'disconnected';
  return 'unknown';
}

export class MeshCoreLiveQueueDrain {
  private active = false;
  private running = false;
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private generation = 0;

  constructor(
    private readonly readNext: () => Promise<MeshCoreQueuedReply>,
    private readonly stage: (stage: MeshCoreQueueStage, detail?: MeshCoreQueueFailure) => void,
  ) {}

  start(): void {
    this.active = true;
    this.generation += 1;
    this.trigger();
  }

  stop(): void {
    this.active = false;
    this.dirty = false;
    this.generation += 1;
    if (this.scheduled !== null) clearTimeout(this.scheduled);
    this.scheduled = null;
  }

  notifyWaiting(): void {
    this.stage('push-0x83');
    this.trigger();
  }

  private trigger(): void {
    this.dirty = true;
    if (this.active && !this.running && this.scheduled === null) {
      this.schedule(0);
    }
  }

  private schedule(delayMs: number): void {
    const generation = this.generation;
    this.stage('drain-scheduled');
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      if (!this.active || generation !== this.generation) return;
      this.drain(generation).catch(() => undefined);
    }, delayMs);
  }

  private async drain(generation: number): Promise<void> {
    if (this.running || !this.active || generation !== this.generation) return;
    this.running = true;
    this.dirty = false;
    let continued = false;
    let failed = false;
    try {
      for (let index = 0; index < BATCH_LIMIT; index += 1) {
        if (!this.active || generation !== this.generation) return;
        this.stage('sync-submitted');
        const reply = await this.readNext();
        if (!this.active || generation !== this.generation) return;
        if (reply.packetType === 0x0a) {
          this.stage('queue-empty');
          continued = this.dirty;
          return;
        }
      }
      continued = true;
      this.stage('batch-continued');
    } catch (error) {
      if (this.active && generation === this.generation) {
        failed = true;
        this.stage('drain-error', classifyMeshCoreQueueError(error));
      }
    } finally {
      this.running = false;
      if (this.active && generation === this.generation && (continued || failed || this.dirty)) {
        this.schedule(failed ? FAILURE_RETRY_MS : CONTINUE_DELAY_MS);
      }
    }
  }
}
