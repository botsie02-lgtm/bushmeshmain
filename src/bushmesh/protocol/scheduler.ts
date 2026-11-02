import {BushMeshAirtimeBudget, LoRaAirtimeConfig, estimateLoRaAirtimeMs} from './airtime';
import {assertBytes, assertIntegerInRange} from './codec';

export enum BushMeshTrafficClass {
  Emergency = 0,
  Direct = 1,
  Acknowledgement = 2,
  Retransmission = 3,
  Location = 4,
  Telemetry = 5,
  File = 6,
  Background = 7,
}

export type BushMeshScheduledTransmission = {
  id: string;
  bytes: number[];
  trafficClass: BushMeshTrafficClass | number;
  createdAt: number;
  notBefore: number;
  expiresAt: number | null;
  attempts: number;
  maxAttempts: number;
  airtimeMs: number | null;
};

export type BushMeshScheduleOptions = {
  now?: number;
  notBefore?: number;
  expiresAt?: number | null;
  maxAttempts?: number;
  airtimeMs?: number;
};

function transmissionRank(trafficClass: BushMeshTrafficClass | number): number {
  switch (trafficClass) {
    case BushMeshTrafficClass.Emergency:
      return 0;
    case BushMeshTrafficClass.Direct:
      return 1;
    case BushMeshTrafficClass.Acknowledgement:
    case BushMeshTrafficClass.Retransmission:
      return 2;
    case BushMeshTrafficClass.Location:
      return 3;
    case BushMeshTrafficClass.Telemetry:
      return 4;
    case BushMeshTrafficClass.File:
      return 5;
    default:
      return 6;
  }
}

function cloneTransmission(
  transmission: BushMeshScheduledTransmission,
): BushMeshScheduledTransmission {
  return {...transmission, bytes: [...transmission.bytes]};
}

export class BushMeshTransmissionScheduler {
  private readonly pending = new Map<string, BushMeshScheduledTransmission>();

  constructor(
    private readonly airtimeBudget?: BushMeshAirtimeBudget,
    private readonly airtimeConfig?: LoRaAirtimeConfig,
  ) {}

  enqueue(
    id: string,
    bytes: number[],
    trafficClass: BushMeshTrafficClass | number,
    options?: BushMeshScheduleOptions,
  ): BushMeshScheduledTransmission {
    if (!id) {
      throw new Error('Scheduled transmission ID cannot be empty.');
    }

    assertBytes(bytes, 'scheduled transmission bytes');
    assertIntegerInRange(trafficClass, 0, 7, 'Traffic class');

    const existing = this.pending.get(id);
    if (existing) {
      return cloneTransmission(existing);
    }

    const now = options?.now ?? Date.now();
    const notBefore = options?.notBefore ?? now;
    const expiresAt = options?.expiresAt ?? null;
    const maxAttempts = options?.maxAttempts ?? 8;

    if (!Number.isFinite(now) || now < 0) {
      throw new Error('Scheduler time must be non-negative and finite.');
    }

    if (!Number.isFinite(notBefore) || notBefore < 0) {
      throw new Error('Scheduler not-before time must be non-negative and finite.');
    }

    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt < now)) {
      throw new Error('Scheduler expiry must be null or at/after creation time.');
    }

    assertIntegerInRange(maxAttempts, 1, 255, 'Scheduler max attempts');

    let airtimeMs = options?.airtimeMs ?? null;
    if (airtimeMs === null && this.airtimeConfig) {
      airtimeMs = estimateLoRaAirtimeMs(bytes.length, this.airtimeConfig);
    }

    if (airtimeMs !== null && (!Number.isFinite(airtimeMs) || airtimeMs < 0)) {
      throw new Error('Scheduled airtime must be non-negative and finite.');
    }

    const transmission: BushMeshScheduledTransmission = {
      id,
      bytes: [...bytes],
      trafficClass,
      createdAt: now,
      notBefore,
      expiresAt,
      attempts: 0,
      maxAttempts,
      airtimeMs,
    };

    this.pending.set(id, transmission);
    return cloneTransmission(transmission);
  }

  ready(now = Date.now()): BushMeshScheduledTransmission[] {
    this.prune(now);

    return Array.from(this.pending.values())
      .filter(item => item.notBefore <= now && item.attempts < item.maxAttempts)
      .sort((a, b) => {
        const rankDifference = transmissionRank(a.trafficClass) - transmissionRank(b.trafficClass);
        if (rankDifference !== 0) {
          return rankDifference;
        }
        if (a.createdAt !== b.createdAt) {
          return a.createdAt - b.createdAt;
        }
        return a.id.localeCompare(b.id);
      })
      .map(cloneTransmission);
  }

  next(now = Date.now()): BushMeshScheduledTransmission | null {
    for (const candidate of this.ready(now)) {
      if (!this.airtimeBudget || candidate.airtimeMs === null) {
        return candidate;
      }

      const budgetPriority =
        candidate.trafficClass === BushMeshTrafficClass.Emergency ? 0 : 4;
      if (this.airtimeBudget.canTransmit(candidate.airtimeMs, budgetPriority, now)) {
        return candidate;
      }
    }

    return null;
  }

  markSent(
    id: string,
    options?: {now?: number; retryDelayMs?: number; remove?: boolean},
  ): BushMeshScheduledTransmission | null {
    const item = this.pending.get(id);
    if (!item) {
      return null;
    }

    const now = options?.now ?? Date.now();
    const retryDelayMs = options?.retryDelayMs ?? 0;

    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
      throw new Error('Scheduler retry delay cannot be negative.');
    }

    if (this.airtimeBudget && item.airtimeMs !== null) {
      const budgetPriority =
        item.trafficClass === BushMeshTrafficClass.Emergency ? 0 : 4;
      this.airtimeBudget.record(item.airtimeMs, budgetPriority, now);
    }

    item.attempts += 1;
    item.notBefore = now + retryDelayMs;

    const result = cloneTransmission(item);
    if (options?.remove === true || item.attempts >= item.maxAttempts) {
      this.pending.delete(id);
    }

    return result;
  }

  defer(id: string, notBefore: number): boolean {
    const item = this.pending.get(id);
    if (!item) {
      return false;
    }
    if (!Number.isFinite(notBefore) || notBefore < 0) {
      throw new Error('Scheduler defer time must be non-negative and finite.');
    }
    item.notBefore = notBefore;
    return true;
  }

  acknowledge(id: string): boolean {
    return this.pending.delete(id);
  }

  prune(now = Date.now()): string[] {
    const removed: string[] = [];
    for (const [id, item] of this.pending.entries()) {
      if (
        (item.expiresAt !== null && item.expiresAt <= now) ||
        item.attempts >= item.maxAttempts
      ) {
        this.pending.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  snapshot(): BushMeshScheduledTransmission[] {
    return Array.from(this.pending.values()).map(cloneTransmission);
  }

  clear(): void {
    this.pending.clear();
  }
}
