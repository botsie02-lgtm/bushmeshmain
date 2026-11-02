import {FieldChecklist, FieldChecklistItem} from './fieldChecklist';

export type TriagePriority = 'first' | 'next' | 'later';

export type TriageStep = {
  id: string;
  priority: TriagePriority;
  title: string;
  why: string;
  action: string;
  blocks: string[];
};

export type FieldTriagePlan = {
  ready: boolean;
  steps: TriageStep[];
  summary: string;
};

const dependencyRank: Record<string, number> = {
  'radio-transport': 10,
  'rf-profile': 20,
  outbox: 30,
  gps: 40,
  'durable-storage': 50,
  'offline-maps': 60,
  'convoy-freshness': 70,
  'field-health': 80,
};

function blockedFunctions(item: FieldChecklistItem): string[] {
  switch (item.id) {
    case 'radio-transport':
      return ['LoRa transmit', 'LoRa receive', 'position requests', 'driver quick actions'];
    case 'rf-profile':
      return ['accurate airtime estimates'];
    case 'outbox':
      return ['truthful outbound delivery state'];
    case 'gps':
      return ['self position', 'located quick actions', 'convoy distance', 'navigation origin'];
    case 'durable-storage':
      return ['process-death recovery', 'store-and-forward durability'];
    case 'offline-maps':
      return ['offline trip navigation'];
    case 'convoy-freshness':
      return ['current convoy gap', 'navigate-to-mate confidence'];
    case 'field-health':
      return ['field-readiness declaration'];
    default:
      return [];
  }
}

function triagePriority(index: number, state: FieldChecklistItem['state']): TriagePriority {
  if (index === 0 && state === 'blocked') {
    return 'first';
  }
  if (state === 'blocked') {
    return 'next';
  }
  return index === 0 ? 'next' : 'later';
}

export function buildFieldTriagePlan(checklist: FieldChecklist): FieldTriagePlan {
  const unresolved = checklist.items
    .filter(item => item.state !== 'pass')
    .sort((left, right) => {
      if (left.state !== right.state) {
        return left.state === 'blocked' ? -1 : 1;
      }
      return (dependencyRank[left.id] ?? 999) - (dependencyRank[right.id] ?? 999);
    });

  if (unresolved.length === 0) {
    return {
      ready: true,
      steps: [],
      summary: 'Every field-verification item currently passes.',
    };
  }

  const steps = unresolved.map((item, index): TriageStep => ({
    id: item.id,
    priority: triagePriority(index, item.state),
    title: item.title,
    why:
      item.state === 'blocked'
        ? `${item.observed} This blocks one or more Bushmesh functions.`
        : `${item.observed} This should be checked before the final field run.`,
    action:
      item.nextAction ??
      `Verify the expected condition: ${item.expected}`,
    blocks: blockedFunctions(item),
  }));

  const blockedCount = unresolved.filter(item => item.state === 'blocked').length;
  const checkCount = unresolved.length - blockedCount;
  return {
    ready: blockedCount === 0,
    steps,
    summary:
      blockedCount > 0
        ? `Resolve ${blockedCount} blocked item${blockedCount === 1 ? '' : 's'} before relying on the affected field functions; ${checkCount} additional check${checkCount === 1 ? '' : 's'} remain.`
        : `${checkCount} check${checkCount === 1 ? '' : 's'} remain before the configuration is fully verified.`,
  };
}
