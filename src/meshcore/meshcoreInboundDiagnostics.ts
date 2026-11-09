/**
 * Runtime-only bounded diagnostics. No channel text, PSKs, raw frames, identity
 * material, transport error strings, or payloads enter these records.
 */
export type MeshCoreInboundStage =
  | 'push-0x83' | 'drain-scheduled' | 'sync-submitted'
  | 'received-0x08' | 'received-0x11' | 'channel-parsed'
  | 'inbox-accepted' | 'persisted' | 'history-visible'
  | 'queue-empty' | 'batch-continued' | 'drain-error'
  | 'persistence-error' | 'duplicate';

export type MeshCoreInboundDiagnostic = {
  stage: MeshCoreInboundStage;
  timeMs: number;
  channelIndex?: number;
  reason?: 'timeout' | 'disconnected' | 'firmware-error' | 'unknown' | 'storage' | 'capacity';
};
type Listener = () => void;

class MeshCoreInboundDiagnostics {
  private events: MeshCoreInboundDiagnostic[] = [];
  private listeners = new Set<Listener>();
  private counts = {} as Partial<Record<MeshCoreInboundStage, number>>;

  record(stage: MeshCoreInboundStage, details: Omit<MeshCoreInboundDiagnostic, 'stage' | 'timeMs'> = {}): void {
    const item = {stage, timeMs: Date.now(), ...details};
    this.counts[stage] = (this.counts[stage] ?? 0) + 1;
    this.events = [item, ...this.events].slice(0, 32);
    this.listeners.forEach(listener => listener());
  }

  snapshot(): {events: MeshCoreInboundDiagnostic[]; counts: Partial<Record<MeshCoreInboundStage, number>>} {
    return {events: [...this.events], counts: {...this.counts}};
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.events = [];
    this.counts = {};
    this.listeners.forEach(listener => listener());
  }
}
export const meshCoreInboundDiagnostics = new MeshCoreInboundDiagnostics();
