import {SupportBundleTraceEvent} from './supportBundle';

export type FieldTestRunState = 'active' | 'completed';

export type FieldTestRunSummary = {
  state: FieldTestRunState;
  startedAtMs: number;
  endedAtMs: number | null;
  durationMs: number;
  eventCount: number;
  actionEventCount: number;
  watchEventCount: number;
  infoEventCount: number;
  markerCodes: string[];
  firstEventAtMs: number | null;
  lastEventAtMs: number | null;
};

const TEST_START_CODE = 'test-marker-test-start';
const TEST_END_CODE = 'test-marker-test-end';

function chronological(events: SupportBundleTraceEvent[]): SupportBundleTraceEvent[] {
  return [...events]
    .filter(event => Number.isFinite(event.occurredAtMs) && event.occurredAtMs >= 0)
    .sort((left, right) => left.occurredAtMs - right.occurredAtMs);
}

/**
 * Summarises only the most recent explicitly marked field test. The trace may
 * contain older runs, but support exports should not silently merge unrelated
 * tests into one duration or event count.
 */
export function summarizeLatestFieldTestRun(
  events: SupportBundleTraceEvent[],
  nowMs = Date.now(),
): FieldTestRunSummary | null {
  const ordered = chronological(events);
  let startIndex = -1;

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (ordered[index].code === TEST_START_CODE) {
      startIndex = index;
      break;
    }
  }

  if (startIndex < 0) {
    return null;
  }

  const start = ordered[startIndex];
  let end: SupportBundleTraceEvent | null = null;
  for (let index = startIndex + 1; index < ordered.length; index += 1) {
    if (ordered[index].code === TEST_END_CODE) {
      end = ordered[index];
      break;
    }
  }

  const boundaryMs = end?.occurredAtMs ?? Math.max(nowMs, start.occurredAtMs);
  const runEvents = ordered.filter(
    event => event.occurredAtMs >= start.occurredAtMs && event.occurredAtMs <= boundaryMs,
  );
  const nonMarkerEvents = runEvents.filter(
    event => !event.code.startsWith('test-marker-'),
  );
  const timestamps = nonMarkerEvents.map(event => event.occurredAtMs);

  return {
    state: end ? 'completed' : 'active',
    startedAtMs: start.occurredAtMs,
    endedAtMs: end?.occurredAtMs ?? null,
    durationMs: Math.max(0, boundaryMs - start.occurredAtMs),
    eventCount: nonMarkerEvents.length,
    actionEventCount: nonMarkerEvents.filter(event => event.severity === 'action').length,
    watchEventCount: nonMarkerEvents.filter(event => event.severity === 'watch').length,
    infoEventCount: nonMarkerEvents.filter(event => event.severity === 'info').length,
    markerCodes: runEvents
      .filter(event => event.code.startsWith('test-marker-'))
      .map(event => event.code),
    firstEventAtMs: timestamps.length > 0 ? Math.min(...timestamps) : null,
    lastEventAtMs: timestamps.length > 0 ? Math.max(...timestamps) : null,
  };
}
