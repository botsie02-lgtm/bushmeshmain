export type LoRaModemParams = {
  spreadingFactor: number;
  bandwidthKhz: number;
  codingRate: 5 | 6 | 7 | 8;
  preambleSymbols?: number;
  crcEnabled?: boolean;
  implicitHeader?: boolean;
  lowDataRateOptimize?: boolean;
};

export type LoRaAirtimeEstimate = {
  payloadBytes: number;
  symbolDurationMs: number;
  preambleDurationMs: number;
  payloadSymbolCount: number;
  payloadDurationMs: number;
  totalDurationMs: number;
  lowDataRateOptimize: boolean;
};

export type AirtimeBudgetPolicy = {
  windowMs: number;
  maxAirtimeMs: number;
};

export type AirtimeSpend = {
  timestampMs: number;
  airtimeMs: number;
};

function assertFinitePositive(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

/**
 * Estimates physical LoRa time-on-air using the Semtech packet-time formula.
 *
 * This is an engineering estimate for Bushmesh scheduling/UI. The caller must
 * provide the modem parameters actually in use by the radio. It is not a
 * regulatory compliance calculator and deliberately does not embed a legal
 * duty-cycle limit.
 */
export function estimateLoRaAirtimeMs(
  payloadBytes: number,
  params: LoRaModemParams,
): LoRaAirtimeEstimate {
  if (!Number.isInteger(payloadBytes) || payloadBytes < 0) {
    throw new Error('LoRa payloadBytes must be a non-negative integer.');
  }

  if (
    !Number.isInteger(params.spreadingFactor) ||
    params.spreadingFactor < 5 ||
    params.spreadingFactor > 12
  ) {
    throw new Error('LoRa spreading factor must be an integer from 5 to 12.');
  }

  assertFinitePositive('LoRa bandwidthKhz', params.bandwidthKhz);

  if (![5, 6, 7, 8].includes(params.codingRate)) {
    throw new Error('LoRa codingRate must be 5, 6, 7 or 8 (representing 4/5 to 4/8).');
  }

  const preambleSymbols = params.preambleSymbols ?? 8;
  assertFinitePositive('LoRa preambleSymbols', preambleSymbols);

  const bandwidthHz = params.bandwidthKhz * 1000;
  const symbolDurationSeconds =
    Math.pow(2, params.spreadingFactor) / bandwidthHz;
  const symbolDurationMs = symbolDurationSeconds * 1000;
  const lowDataRateOptimize =
    params.lowDataRateOptimize ?? symbolDurationMs >= 16;
  const de = lowDataRateOptimize ? 1 : 0;
  const ih = params.implicitHeader ? 1 : 0;
  const crc = params.crcEnabled === false ? 0 : 1;
  const codingRateOffset = params.codingRate - 4;

  const numerator =
    8 * payloadBytes -
    4 * params.spreadingFactor +
    28 +
    16 * crc -
    20 * ih;
  const denominator = 4 * (params.spreadingFactor - 2 * de);
  const payloadBlocks = Math.max(0, Math.ceil(numerator / denominator));
  const payloadSymbolCount =
    8 + payloadBlocks * (codingRateOffset + 4);

  const preambleDurationMs =
    (preambleSymbols + 4.25) * symbolDurationMs;
  const payloadDurationMs = payloadSymbolCount * symbolDurationMs;
  const totalDurationMs = preambleDurationMs + payloadDurationMs;

  return {
    payloadBytes,
    symbolDurationMs,
    preambleDurationMs,
    payloadSymbolCount,
    payloadDurationMs,
    totalDurationMs,
    lowDataRateOptimize,
  };
}

export class RollingAirtimeBudget {
  private readonly policy: AirtimeBudgetPolicy;
  private spends: AirtimeSpend[] = [];

  constructor(policy: AirtimeBudgetPolicy) {
    assertFinitePositive('Airtime budget windowMs', policy.windowMs);
    assertFinitePositive('Airtime budget maxAirtimeMs', policy.maxAirtimeMs);

    if (policy.maxAirtimeMs > policy.windowMs) {
      throw new Error('Airtime budget cannot exceed the length of its rolling window.');
    }

    this.policy = {...policy};
  }

  getPolicy(): AirtimeBudgetPolicy {
    return {...this.policy};
  }

  getUsedAirtimeMs(nowMs = Date.now()): number {
    this.prune(nowMs);
    return this.spends.reduce((sum, spend) => sum + spend.airtimeMs, 0);
  }

  getRemainingAirtimeMs(nowMs = Date.now()): number {
    return Math.max(
      0,
      this.policy.maxAirtimeMs - this.getUsedAirtimeMs(nowMs),
    );
  }

  canSpend(airtimeMs: number, nowMs = Date.now()): boolean {
    assertFinitePositive('Airtime spend', airtimeMs);
    return airtimeMs <= this.getRemainingAirtimeMs(nowMs);
  }

  record(airtimeMs: number, timestampMs = Date.now()): AirtimeSpend {
    assertFinitePositive('Airtime spend', airtimeMs);
    if (!Number.isFinite(timestampMs) || timestampMs < 0) {
      throw new Error('Airtime timestamp must be a non-negative finite number.');
    }

    this.prune(timestampMs);
    const spend = {timestampMs, airtimeMs};
    this.spends.push(spend);
    return {...spend};
  }

  snapshot(nowMs = Date.now()): AirtimeSpend[] {
    this.prune(nowMs);
    return this.spends.map(spend => ({...spend}));
  }

  reset(): void {
    this.spends = [];
  }

  private prune(nowMs: number): void {
    const windowStart = nowMs - this.policy.windowMs;
    this.spends = this.spends.filter(
      spend => spend.timestampMs > windowStart && spend.timestampMs <= nowMs,
    );
  }
}
