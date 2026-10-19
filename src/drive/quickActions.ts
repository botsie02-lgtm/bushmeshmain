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
