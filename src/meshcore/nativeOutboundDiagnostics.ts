/**
 * Bounded, metadata-only trace of Android-owned MeshCore outgoing commands.
 * Never record plaintext, BLE addresses, channel names, PSKs, keys or raw frames.
 * Native "queued" and "GATT write confirmed" are deliberately separate stages;
 * neither of them constitutes radio acceptance or peer reception.
 */
export type NativeOutboundStage =
  | 'command-queued' | 'transport-ready' | 'native-write-queued'
  | 'gatt-write-confirmed' | 'response-observed' | 'response-matched'
  | 'firmware-rejected' | 'response-timeout' | 'write-failed'
  | 'session-disconnected' | 'stop-requested' | 'stop-confirmed' | 'stop-failed';

export type NativeOutboundFailure =
  'timeout' | 'firmware-error' | 'disconnected' | 'write-error' | 'shutdown-error' | 'unknown';

export type NativeOutboundEvent = {
  stage: NativeOutboundStage;
  atMs: number;
  command: 'channel-text' | 'other' | 'radio-stop';
  channelSlot?: number;
  packetType?: number;
  firmwareCode?: number;
  reason?: NativeOutboundFailure;
};
type Listener = () => void;
const LIMIT = 40;

class NativeOutboundDiagnostics {
  private events: NativeOutboundEvent[] = [];
  private counters: Partial<Record<NativeOutboundStage, number>> = {};
  private listeners = new Set<Listener>();

  record(
    stage: NativeOutboundStage,
    command: NativeOutboundEvent['command'],
    details: Omit<NativeOutboundEvent, 'stage' | 'command' | 'atMs'> = {},
  ): void {
    const event: NativeOutboundEvent = {stage, command, atMs: Date.now()};
    if (Number.isInteger(details.channelSlot) &&
        (details.channelSlot as number) >= 0 && (details.channelSlot as number) <= 255) {
      event.channelSlot = details.channelSlot;
    }
    if (Number.isInteger(details.packetType) &&
        (details.packetType as number) >= 0 && (details.packetType as number) <= 255) {
      event.packetType = details.packetType;
    }
    if (Number.isInteger(details.firmwareCode) &&
        (details.firmwareCode as number) >= 0 && (details.firmwareCode as number) <= 255) {
      event.firmwareCode = details.firmwareCode;
    }
    if (details.reason) event.reason = details.reason;
    this.events = [event, ...this.events].slice(0, LIMIT);
    this.counters[stage] = (this.counters[stage] ?? 0) + 1;
    for (const listener of this.listeners) listener();
  }

  snapshot(): {
    events: NativeOutboundEvent[];
    counts: Partial<Record<NativeOutboundStage, number>>;
  } {
    return {events: this.events.map(e => ({...e})), counts: {...this.counters}};
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.events = [];
    this.counters = {};
    for (const listener of this.listeners) listener();
  }
}
export const nativeOutboundDiagnostics = new NativeOutboundDiagnostics();
