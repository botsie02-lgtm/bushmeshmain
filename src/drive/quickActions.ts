import {BushMeshQuickActionCode} from '../bushmesh/protocol';

export type QuickActionPriority = 'safety' | 'control' | 'status';

export type QuickActionDefinition = {
  code: BushMeshQuickActionCode;
  label: string;
  shortLabel: string;
  description: string;
  priority: QuickActionPriority;
  defaultTtlSeconds: number;
  includesLocation: boolean;
};

export type QuickActionTemporalState = 'active' | 'expired' | 'future';

export type QuickActionTemporalDecision = {
  state: QuickActionTemporalState;
  expiresAtMs: number;
  effectiveTtlSeconds: number;
};

const DEFINITIONS: Record<number, QuickActionDefinition> = {
  [BushMeshQuickActionCode.Stop]: {
    code: BushMeshQuickActionCode.Stop,
    label: 'STOP',
    shortLabel: 'STOP',
    description: 'Stop the convoy as soon as it is safe.',
    priority: 'safety',
    defaultTtlSeconds: 120,
    includesLocation: true,
  },
  [BushMeshQuickActionCode.Hazard]: {
    code: BushMeshQuickActionCode.Hazard,
    label: 'HAZARD',
    shortLabel: 'HAZARD',
    description: 'Hazard at or near the sender location.',
    priority: 'safety',
    defaultTtlSeconds: 900,
    includesLocation: true,
  },
  [BushMeshQuickActionCode.Regroup]: {
    code: BushMeshQuickActionCode.Regroup,
    label: 'REGROUP HERE',
    shortLabel: 'REGROUP',
    description: 'Use the sender location as the convoy regroup point.',
    priority: 'control',
    defaultTtlSeconds: 1800,
    includesLocation: true,
  },
  [BushMeshQuickActionCode.Fuel]: {
    code: BushMeshQuickActionCode.Fuel,
    label: 'FUEL STOP',
    shortLabel: 'FUEL',
    description: 'Fuel stop requested.',
    priority: 'control',
    defaultTtlSeconds: 1800,
    includesLocation: false,
  },
  [BushMeshQuickActionCode.Ok]: {
    code: BushMeshQuickActionCode.Ok,
    label: 'ALL OK',
    shortLabel: 'OK',
    description: 'Status check acknowledged; no assistance required.',
    priority: 'status',
    defaultTtlSeconds: 120,
    includesLocation: false,
  },
  [BushMeshQuickActionCode.Help]: {
    code: BushMeshQuickActionCode.Help,
    label: 'HELP',
    shortLabel: 'HELP',
    description: 'Assistance requested at the sender location.',
    priority: 'safety',
    defaultTtlSeconds: 1800,
    includesLocation: true,
  },
};

export const DRIVER_QUICK_ACTIONS: QuickActionDefinition[] = [
  DEFINITIONS[BushMeshQuickActionCode.Stop],
  DEFINITIONS[BushMeshQuickActionCode.Hazard],
  DEFINITIONS[BushMeshQuickActionCode.Regroup],
  DEFINITIONS[BushMeshQuickActionCode.Fuel],
  DEFINITIONS[BushMeshQuickActionCode.Ok],
  DEFINITIONS[BushMeshQuickActionCode.Help],
];

export function getQuickActionDefinition(
  code: BushMeshQuickActionCode,
): QuickActionDefinition {
  const definition = DEFINITIONS[code];
  if (!definition) {
    throw new Error(`Unknown Bushmesh quick action ${code}.`);
  }
  return definition;
}

export function isSafetyQuickAction(code: BushMeshQuickActionCode): boolean {
  return getQuickActionDefinition(code).priority === 'safety';
}

/**
 * Evaluates whether an inbound control packet is still actionable.
 *
 * A packet with ttlSeconds=0 uses the action's default TTL. Packets too far in
 * the future are withheld instead of trusting a bad peer clock and extending
 * their lifetime indefinitely.
 */
export function getQuickActionTemporalDecision(input: {
  action: BushMeshQuickActionCode;
  packetTimestampSeconds: number;
  ttlSeconds: number;
  nowMs?: number;
  futureToleranceSeconds?: number;
}): QuickActionTemporalDecision {
  const nowMs = input.nowMs ?? Date.now();
  const futureToleranceSeconds = Math.max(0, input.futureToleranceSeconds ?? 120);
  const definition = getQuickActionDefinition(input.action);
  const effectiveTtlSeconds =
    input.ttlSeconds > 0 ? input.ttlSeconds : definition.defaultTtlSeconds;
  const packetTimestampMs = input.packetTimestampSeconds * 1000;
  const expiresAtMs = packetTimestampMs + effectiveTtlSeconds * 1000;

  if (packetTimestampMs > nowMs + futureToleranceSeconds * 1000) {
    return {
      state: 'future',
      expiresAtMs,
      effectiveTtlSeconds,
    };
  }

  if (expiresAtMs <= nowMs) {
    return {
      state: 'expired',
      expiresAtMs,
      effectiveTtlSeconds,
    };
  }

  return {
    state: 'active',
    expiresAtMs,
    effectiveTtlSeconds,
  };
}
