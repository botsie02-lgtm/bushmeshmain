import {BushMeshPriority, assertIntegerInRange} from './codec';

export type LoRaAirtimeConfig = {
  spreadingFactor: number;
  bandwidthHz: number;
  codingRateDenominator?: 5 | 6 | 7 | 8;
  preambleSymbols?: number;
  explicitHeader?: boolean;
  crcEnabled?: boolean;
  lowDataRateOptimization?: boolean;
};

export function estimateLoRaAirtimeMs(
  payloadBytes: number,
  config: LoRaAirtimeConfig,
): number {
  assertIntegerInRange(payloadBytes, 0, 255, 'LoRa payload bytes');
  assertIntegerInRange(config.spreadingFactor, 5, 12, 'Spreading factor');

  if (!Number.isFinite(config.bandwidthHz) || config.bandwidthHz <= 0) {
    throw new Error('LoRa bandwidth must be greater than zero.');
  }

  const codingRateDenominator = config.codingRateDenominator ?? 5;
  const preambleSymbols = config.preambleSymbols ?? 8;
  const explicitHeader = config.explicitHeader ?? true;
  const crcEnabled = config.crcEnabled ?? true;

  if (!Number.isFinite(preambleSymbols) || preambleSymbols < 0) {
    throw new Error('LoRa preamble symbol count cannot be negative.');
  }

  const sf = config.spreadingFactor;
  const symbolSeconds = Math.pow(2, sf) / config.bandwidthHz;
  const lowDataRateOptimization =
    config.lowDataRateOptimization ?? symbolSeconds >= 0.016;
  const de = lowDataRateOptimization ? 1 : 0;
  const ih = explicitHeader ? 0 : 1;
  const crc = crcEnabled ? 1 : 0;
  const codingRate = codingRateDenominator - 4;
  const numerator = 8 * payloadBytes - 4 * sf + 28 + 16 * crc - 20 * ih;
  const denominator = 4 * (sf - 2 * de);
  const payloadSymbols =
    8 + Math.max(Math.ceil(numerator / denominator) * (codingRate + 4), 0);
  const preambleSeconds = (preambleSymbols + 4.25) * symbolSeconds;
  const payloadSeconds = payloadSymbols * symbolSeconds;

  return Math.round((preambleSeconds + payloadSeconds) * 1000000) / 1000;
}

type AirtimeEvent = {
  at: number;
  airtimeMs: number;
  priority: number;
};

export class BushMeshAirtimeBudget {
  private readonly events: AirtimeEvent[] = [];

  constructor(
    private readonly windowMs: number,
    private readonly normalBudgetMs: number,
    private readonly emergencyReserveMs = 0,
  ) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error('Airtime budget window must be greater than zero.');
    }

    if (!Number.isFinite(normalBudgetMs) || normalBudgetMs < 0) {
      throw new Error('Normal airtime budget cannot be negative.');
    }

    if (!Number.isFinite(emergencyReserveMs) || emergencyReserveMs < 0) {
      throw new Error('Emergency airtime reserve cannot be negative.');
    }
  }

  canTransmit(
    airtimeMs: number,
    priority: BushMeshPriority | number,
    now = Date.now(),
  ): boolean {
    if (!Number.isFinite(airtimeMs) || airtimeMs < 0) {
      throw new Error('Airtime must be non-negative.');
    }

    assertIntegerInRange(priority, 0, 7, 'Priority');
    this.prune(now);
    const used = this.usedAirtimeMs(now);
    const limit =
      priority === BushMeshPriority.Emergency
        ? this.normalBudgetMs + this.emergencyReserveMs
        : this.normalBudgetMs;

    return used + airtimeMs <= limit;
  }

  record(
    airtimeMs: number,
    priority: BushMeshPriority | number,
    now = Date.now(),
  ): void {
    if (!this.canTransmit(airtimeMs, priority, now)) {
      throw new Error('Airtime budget would be exceeded.');
    }

    this.events.push({at: now, airtimeMs, priority});
  }

  usedAirtimeMs(now = Date.now()): number {
    this.prune(now);
    return this.events.reduce((sum, event) => sum + event.airtimeMs, 0);
  }

  remainingAirtimeMs(
    priority: BushMeshPriority | number,
    now = Date.now(),
  ): number {
    assertIntegerInRange(priority, 0, 7, 'Priority');
    const limit =
      priority === BushMeshPriority.Emergency
        ? this.normalBudgetMs + this.emergencyReserveMs
        : this.normalBudgetMs;
    return Math.max(0, limit - this.usedAirtimeMs(now));
  }

  prune(now = Date.now()): number {
    const cutoff = now - this.windowMs;
    let removed = 0;

    while (this.events.length > 0 && this.events[0].at <= cutoff) {
      this.events.shift();
      removed += 1;
    }

    return removed;
  }

  clear(): void {
    this.events.length = 0;
  }
}
