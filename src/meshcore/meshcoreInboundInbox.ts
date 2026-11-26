import {ParsedChannelMessage} from './meshcoreParsers';
import {meshCoreInboundDiagnostics} from './meshcoreInboundDiagnostics';

/** Message content stays in the application inbox; diagnostics are metadata-only. */
/** Captures local radio context at decode time, not the packet's original key generation. */
export type MeshCoreInboundObservation = {
  version: 1;
  source: 'js-gatt' | 'native-session';
  origin: 'queued-generation-unknown';
  radio: string | null;
  configurationId: string | null;
  configurationName: string | null;
  timestamp: number | null;
  snr: number | null;
  pathLength: number | null;
  /** Local receive association, never original PSK or authenticated sender evidence. */
  association?: {version: 1; evidence: 'post-empty-local-observation'; incarnation: number};
  /** One locally observed serialized queue reply, not a firmware packet ID. */
  queueOccurrenceId?: string;
};

export type MeshCoreInboundEnvelope = {
  message: ParsedChannelMessage;
  receivedAtMs: number;
  observation?: MeshCoreInboundObservation;
};

type Consumer = (event: MeshCoreInboundEnvelope) => Promise<void>;
type Association = NonNullable<MeshCoreInboundObservation['association']>;
type PendingEnvelope = MeshCoreInboundEnvelope & {confirmAssociation?: () => Promise<Association | undefined>};

export const MESHCORE_INBOX_PENDING_LIMIT = 128;

export class MeshCoreInboundInbox {
  private pending: PendingEnvelope[] = [];
  private readonly occurrenceNamespace = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  private occurrenceSequence = 0;
  private consumer: Consumer | null = null;
  private readonly observers = new Set<(envelope: MeshCoreInboundEnvelope) => void>();
  private busy = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  publish(message: ParsedChannelMessage, observation?: MeshCoreInboundObservation,
    options?: {matchedQueueReply: boolean; confirmAssociation?: () => Promise<Association | undefined>}): void {
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
    const envelope: PendingEnvelope = {
      message: {...message}, receivedAtMs: Date.now(),
      ...(observation ? {observation: {...observation,
        ...(observation.association ? {association: {...observation.association}} : {}),
        ...(options?.matchedQueueReply && observation.radio ? {
          queueOccurrenceId: this.occurrenceNamespace + '-' + (++this.occurrenceSequence).toString(36),
        } : {})}} : {}),
      ...(options?.confirmAssociation ? {confirmAssociation: options.confirmAssociation} : {}),
    };
    this.pending.push(envelope);
    // Optional read-only observers never replace the single durable-history
    // consumer, never acknowledge its queue, and cannot block its delivery.
    this.observers.forEach(observer => {
      try {observer({message: {...envelope.message}, receivedAtMs: envelope.receivedAtMs,
        ...(envelope.observation ? {observation: {...envelope.observation,
          ...(envelope.observation.association ? {association: {...envelope.observation.association}} : {})}} : {})});}
      catch { /* A field-test observer is never an inbox persistence authority. */ }
    });
    meshCoreInboundDiagnostics.record('inbox-accepted', {channelIndex});
    this.flush();
  }

  subscribeObserved(listener: (envelope: MeshCoreInboundEnvelope) => void): () => void {
    this.observers.add(listener);
    return () => {this.observers.delete(listener);};
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
          // Freeze the evidence decision before the first persistence attempt.
          // Storage retry retains the same association and occurrence ID even
          // if the radio disconnects or changes configuration in the meantime.
          if (first.confirmAssociation) {
            const confirm = first.confirmAssociation;
            delete first.confirmAssociation;
            const association = await confirm().catch(() => undefined);
            if (association && first.observation) first.observation = {...first.observation, association};
          }
          if (!this.consumer) return;
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
