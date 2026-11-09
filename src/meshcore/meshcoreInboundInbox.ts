import {ParsedChannelMessage} from './meshcoreParsers';
import {meshCoreInboundDiagnostics} from './meshcoreInboundDiagnostics';

/** Message content stays in the application inbox; diagnostics are metadata-only. */
export type MeshCoreInboundEnvelope = {
  message: ParsedChannelMessage;
  receivedAtMs: number;
};

type Consumer = (event: MeshCoreInboundEnvelope) => Promise<void>;

export const MESHCORE_INBOX_PENDING_LIMIT = 128;

export class MeshCoreInboundInbox {
  private pending: MeshCoreInboundEnvelope[] = [];
  private consumer: Consumer | null = null;
  private busy = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  publish(message: ParsedChannelMessage): void {
    const channelIndex = Number(message.channelIndex);
    if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 255 ||
        !message.text.trim()) return;
    meshCoreInboundDiagnostics.record(
      'channel-parsed', {channelIndex},
    );
    // Never record text in diagnostics. Retain all receive events until
    // persistence acknowledges them, rather than dropping a mutable lastFrame.
    if (this.pending.length >= MESHCORE_INBOX_PENDING_LIMIT) {
      meshCoreInboundDiagnostics.record('persistence-error', {reason: 'capacity'});
      throw new Error('MeshCore application inbox is full; radio queue drain must pause.');
    }
    this.pending.push({message: {...message}, receivedAtMs: Date.now()});
    meshCoreInboundDiagnostics.record('inbox-accepted', {channelIndex});
    this.flush();
  }

  setConsumer(consumer: Consumer | null): () => void {
    this.consumer = consumer;
    this.flush();
    return () => {
      if (this.consumer === consumer) this.consumer = null;
    };
  }

  pendingCount(): number {
    return this.pending.length;
  }

  private flush(): void {
    if (this.busy || !this.consumer || this.retryTimer !== null) return;
    this.busy = true;
    this.process().catch(() => undefined);
  }

  private async process(): Promise<void> {
    try {
      while (this.consumer && this.pending.length > 0) {
        const first = this.pending[0];
        try {
          await this.consumer(first);
        } catch {
          meshCoreInboundDiagnostics.record('persistence-error', {reason: 'storage'});
          if (this.retryTimer === null) {
            this.retryTimer = setTimeout(() => {
              this.retryTimer = null;
              this.flush();
            }, 2_000);
          }
          return;
        }
        this.pending.shift();
      }
    } finally {
      this.busy = false;
      if (this.consumer && this.pending.length > 0 && this.retryTimer === null) this.flush();
    }
  }
}
export const meshCoreInboundInbox = new MeshCoreInboundInbox();
