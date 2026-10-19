import {
  BushMeshAirtimeBudget,
  BushMeshPriority,
  LoRaAirtimeConfig,
  estimateLoRaAirtimeMs,
} from '../protocol';

export type BushMeshAirtimeDecision = {
  allowed: boolean;
  estimatedAirtimeMs: number;
  remainingAirtimeMs: number;
  priority: BushMeshPriority | number;
};

export type BushMeshAirtimeSnapshot = {
  usedAirtimeMs: number;
  normalRemainingMs: number;
  emergencyRemainingMs: number;
};

/**
 * Runtime admission policy around the protocol airtime estimator. The caller
 * supplies real radio configuration and policy budgets; this class deliberately
 * contains no regional/legal duty-cycle defaults.
 */
export class BushMeshAirtimeController {
  private readonly budget: BushMeshAirtimeBudget;

  constructor(
    readonly radio: LoRaAirtimeConfig,
    options: {
      windowMs: number;
      normalBudgetMs: number;
      emergencyReserveMs?: number;
    },
  ) {
    this.budget = new BushMeshAirtimeBudget(
      options.windowMs,
      options.normalBudgetMs,
      options.emergencyReserveMs ?? 0,
    );
  }

  evaluate(
    payloadBytes: number,
    priority: BushMeshPriority | number,
    now = Date.now(),
  ): BushMeshAirtimeDecision {
    const estimatedAirtimeMs = estimateLoRaAirtimeMs(payloadBytes, this.radio);
    return {
      allowed: this.budget.canTransmit(estimatedAirtimeMs, priority, now),
      estimatedAirtimeMs,
      remainingAirtimeMs: this.budget.remainingAirtimeMs(priority, now),
      priority,
    };
  }

  record(
    payloadBytes: number,
    priority: BushMeshPriority | number,
    now = Date.now(),
  ): BushMeshAirtimeDecision {
    const decision = this.evaluate(payloadBytes, priority, now);

    if (!decision.allowed) {
      throw new Error(
        `BushMesh airtime budget would be exceeded by ${decision.estimatedAirtimeMs.toFixed(1)} ms.`,
      );
    }

    this.budget.record(decision.estimatedAirtimeMs, priority, now);
    return {
      ...decision,
      remainingAirtimeMs: this.budget.remainingAirtimeMs(priority, now),
    };
  }

  snapshot(now = Date.now()): BushMeshAirtimeSnapshot {
    return {
      usedAirtimeMs: this.budget.usedAirtimeMs(now),
      normalRemainingMs: this.budget.remainingAirtimeMs(
        BushMeshPriority.Background,
        now,
      ),
      emergencyRemainingMs: this.budget.remainingAirtimeMs(
        BushMeshPriority.Emergency,
        now,
      ),
    };
  }

  clear(): void {
    this.budget.clear();
  }
}
