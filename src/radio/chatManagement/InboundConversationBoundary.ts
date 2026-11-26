import type {ChatConfiguration, ChatPreferenceSnapshot} from './chatPreferences';

type Binding = {radio: string; epoch: number; configs: readonly ChatConfiguration[]; incarnations: Readonly<Record<string, number>>; empty: boolean};

/** A queue-empty response after verified catalogue storage establishes only a
 * local observation boundary. No firmware key generation or peer identity is implied. */
export class InboundConversationBoundary {
  private binding: Binding | null = null;
  private read: Binding | null = null;
  private revision = 0;

  clear(): void { this.binding = null; this.read = null; this.revision += 1; }
  loseEvidence(): void {
    if (this.binding) this.binding.empty = false;
    this.read = null;
    this.revision += 1;
  }
  install(radio: string, epoch: number, configs: readonly ChatConfiguration[], entries: ChatPreferenceSnapshot): void {
    const incarnations: Record<string, number> = {};
    for (const c of configs) {
      const p = entries[c.id];
      if (p?.configuration?.id === c.id && p.configuration.radio === radio &&
          p.configuration.slot === c.slot && p.configuration.name === c.name &&
          p.retired === false && Number.isSafeInteger(p.incarnation) && p.incarnation! > 0) {
        incarnations[c.id] = p.incarnation!;
      }
    }
    this.binding = {radio, epoch, configs, incarnations, empty: false};
    this.read = null;
    this.revision += 1;
  }
  startRead(radio: string | null, epoch: number): void {
    this.read = this.binding?.radio === radio && this.binding.epoch === epoch ? this.binding : null;
  }
  emptyReply(radio: string | null, epoch: number): void {
    if (this.read && this.read === this.binding && this.read.radio === radio && this.read.epoch === epoch) this.read.empty = true;
    this.read = null;
  }
  observe(radio: string | null, epoch: number, slot: string, matched: boolean, current: boolean) {
    const b = this.binding;
    if (!b || b.radio !== radio || b.epoch !== epoch || !current) return undefined;
    const config = b.configs.find(c => String(c.slot) === slot);
    if (!config) return undefined;
    const incarnation = b.incarnations[config.id];
    const associated = matched && this.read === b && b.empty && incarnation !== undefined;
    return {config, incarnation: associated ? incarnation : undefined, revision: this.revision};
  }
  isCurrent(radio: string, epoch: number, id: string, incarnation: number, revision: number): boolean {
    const b = this.binding;
    return revision === this.revision && !!b && b.radio === radio && b.epoch === epoch &&
      b.empty && b.incarnations[id] === incarnation;
  }
}
