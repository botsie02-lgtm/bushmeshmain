import {SupportBundleTraceEvent} from './supportBundle';

export type FieldScenarioId =
  | 'radio-handoff-recovery'
  | 'node-power-cycle-recovery'
  | 'airplane-offline-drill';

export type FieldScenarioState =
  | 'not-started'
  | 'in-progress'
  | 'evidence-complete'
  | 'incomplete';

export type FieldScenarioResult = {
  id: FieldScenarioId;
  title: string;
  state: FieldScenarioState;
  markerAtMs: number | null;
  evidenceCodes: string[];
  missingEvidence: string[];
  detail: string;
};

function ordered(events: SupportBundleTraceEvent[]): SupportBundleTraceEvent[] {
  return [...events]
    .filter(event => Number.isFinite(event.occurredAtMs) && event.occurredAtMs >= 0)
    .sort((left, right) => left.occurredAtMs - right.occurredAtMs);
}

function lastEvent(
  events: SupportBundleTraceEvent[],
  code: string,
): SupportBundleTraceEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].code === code) {
      return events[index];
    }
  }
  return null;
}

function after(
  events: SupportBundleTraceEvent[],
  timestampMs: number,
  code: string,
): SupportBundleTraceEvent | null {
  return (
    events.find(
      event => event.occurredAtMs >= timestampMs && event.code === code,
    ) ?? null
  );
}

function radioHandoffScenario(
  events: SupportBundleTraceEvent[],
): FieldScenarioResult {
  const marker = lastEvent(events, 'test-marker-radio-handoff');
  if (!marker) {
    return {
      id: 'radio-handoff-recovery',
      title: 'Radio handoff recovery',
      state: 'not-started',
      markerAtMs: null,
      evidenceCodes: [],
      missingEvidence: ['radio ownership change', 'radio transport ready'],
      detail: 'Add a RADIO HANDOFF marker when deliberately transferring radio ownership.',
    };
  }

  const ownership = after(events, marker.occurredAtMs, 'radio-ownership-changed');
  const ready = after(events, marker.occurredAtMs, 'radio-transport-ready');
  const evidenceCodes = [ownership?.code, ready?.code].filter(
    (value): value is string => value !== undefined,
  );
  const missingEvidence = [
    ownership ? null : 'radio ownership change',
    ready ? null : 'radio transport ready',
  ].filter((value): value is string => value !== null);

  return {
    id: 'radio-handoff-recovery',
    title: 'Radio handoff recovery',
    state: missingEvidence.length === 0 ? 'evidence-complete' : 'in-progress',
    markerAtMs: marker.occurredAtMs,
    evidenceCodes,
    missingEvidence,
    detail:
      missingEvidence.length === 0
        ? 'The trace contains an ownership change and a ready transport after the deliberate handoff marker.'
        : `Waiting for: ${missingEvidence.join(', ')}.`,
  };
}

function nodePowerCycleScenario(
  events: SupportBundleTraceEvent[],
): FieldScenarioResult {
  const marker = lastEvent(events, 'test-marker-node-power-cycle');
  if (!marker) {
    return {
      id: 'node-power-cycle-recovery',
      title: 'Node power-cycle recovery',
      state: 'not-started',
      markerAtMs: null,
      evidenceCodes: [],
      missingEvidence: ['radio transport lost', 'radio transport ready'],
      detail: 'Add a NODE POWER CYCLE marker immediately before cycling the MeshCore node.',
    };
  }

  const lost = after(events, marker.occurredAtMs, 'radio-transport-lost');
  const ready = lost
    ? after(events, lost.occurredAtMs, 'radio-transport-ready')
    : null;
  const evidenceCodes = [lost?.code, ready?.code].filter(
    (value): value is string => value !== undefined,
  );
  const missingEvidence = [
    lost ? null : 'radio transport lost',
    ready ? null : 'radio transport ready after loss',
  ].filter((value): value is string => value !== null);

  return {
    id: 'node-power-cycle-recovery',
    title: 'Node power-cycle recovery',
    state: missingEvidence.length === 0 ? 'evidence-complete' : 'in-progress',
    markerAtMs: marker.occurredAtMs,
    evidenceCodes,
    missingEvidence,
    detail:
      missingEvidence.length === 0
        ? 'The trace shows transport loss followed by transport recovery after the deliberate power-cycle marker.'
        : `Waiting for: ${missingEvidence.join(', ')}.`,
  };
}

function airplaneOfflineScenario(
  events: SupportBundleTraceEvent[],
): FieldScenarioResult {
  const on = lastEvent(events, 'test-marker-airplane-mode-on');
  if (!on) {
    return {
      id: 'airplane-offline-drill',
      title: 'Airplane/offline drill',
      state: 'not-started',
      markerAtMs: null,
      evidenceCodes: [],
      missingEvidence: ['airplane mode on marker', 'airplane mode off marker'],
      detail: 'Mark AIRPLANE ON before beginning an offline-only verification window.',
    };
  }

  const off = after(events, on.occurredAtMs, 'test-marker-airplane-mode-off');
  const eventsDuringWindow = events.filter(
    event =>
      event.occurredAtMs >= on.occurredAtMs &&
      (off === null || event.occurredAtMs <= off.occurredAtMs),
  );
  const observedCodes = eventsDuringWindow
    .filter(event => !event.code.startsWith('test-marker-'))
    .map(event => event.code);

  if (!off) {
    return {
      id: 'airplane-offline-drill',
      title: 'Airplane/offline drill',
      state: 'in-progress',
      markerAtMs: on.occurredAtMs,
      evidenceCodes: observedCodes,
      missingEvidence: ['airplane mode off marker'],
      detail: 'Offline window is still open. Mark AIRPLANE OFF when the deliberate offline period ends.',
    };
  }

  return {
    id: 'airplane-offline-drill',
    title: 'Airplane/offline drill',
    state: 'evidence-complete',
    markerAtMs: on.occurredAtMs,
    evidenceCodes: observedCodes,
    missingEvidence: [],
    detail:
      observedCodes.length > 0
        ? `Offline window is bounded and contains ${observedCodes.length} recorded automatic state transition${observedCodes.length === 1 ? '' : 's'}. Review them rather than assuming offline operation was healthy.`
        : 'Offline window is bounded but no automatic state transitions were recorded. This is evidence of the test window only, not proof that every offline function worked.',
  };
}

export function evaluateFieldScenarios(
  traceEvents: SupportBundleTraceEvent[],
): FieldScenarioResult[] {
  const events = ordered(traceEvents);
  return [
    radioHandoffScenario(events),
    nodePowerCycleScenario(events),
    airplaneOfflineScenario(events),
  ];
}
