import {SupportBundleTraceEvent} from './supportBundle';

export type DiagnosticCorrelationConfidence = 'low' | 'medium';

export type DiagnosticEventCorrelation = {
  id: string;
  confidence: DiagnosticCorrelationConfidence;
  title: string;
  detail: string;
  eventCodes: string[];
  windowMs: number;
};

function newestFirst(events: SupportBundleTraceEvent[]): SupportBundleTraceEvent[] {
  return [...events]
    .filter(event => Number.isFinite(event.occurredAtMs))
    .sort((left, right) => right.occurredAtMs - left.occurredAtMs);
}

function findPair(
  events: SupportBundleTraceEvent[],
  firstCode: string,
  secondCode: string,
  maxGapMs: number,
): [SupportBundleTraceEvent, SupportBundleTraceEvent] | null {
  const chronological = [...events].sort(
    (left, right) => left.occurredAtMs - right.occurredAtMs,
  );

  for (let firstIndex = 0; firstIndex < chronological.length; firstIndex += 1) {
    const first = chronological[firstIndex];
    if (first.code !== firstCode) {
      continue;
    }

    for (
      let secondIndex = firstIndex + 1;
      secondIndex < chronological.length;
      secondIndex += 1
    ) {
      const second = chronological[secondIndex];
      const gapMs = second.occurredAtMs - first.occurredAtMs;
      if (gapMs > maxGapMs) {
        break;
      }
      if (second.code === secondCode) {
        return [first, second];
      }
    }
  }

  return null;
}

/**
 * Finds timing relationships that may help a field engineer choose what to
 * inspect next. These results are intentionally correlations, not causal
 * diagnoses: radio/GPS/Android behavior can share symptoms for many reasons.
 */
export function correlateFieldEvents(
  events: SupportBundleTraceEvent[],
): DiagnosticEventCorrelation[] {
  const recent = newestFirst(events).slice(0, 80);
  const correlations: DiagnosticEventCorrelation[] = [];

  const ownershipDrop = findPair(
    recent,
    'radio-ownership-changed',
    'radio-transport-lost',
    60_000,
  );
  if (ownershipDrop) {
    correlations.push({
      id: 'ownership-then-transport-loss',
      confidence: 'medium',
      title: 'Transport loss followed a radio ownership change',
      detail:
        'A transport loss occurred within one minute of Android radio ownership changing. Inspect BLE handoff/reconnect logs first, but do not assume the ownership change caused the loss.',
      eventCodes: ownershipDrop.map(event => event.code),
      windowMs: ownershipDrop[1].occurredAtMs - ownershipDrop[0].occurredAtMs,
    });
  }

  const offlineFailures = findPair(
    recent,
    'radio-transport-lost',
    'outbox-failure-increased',
    300_000,
  );
  if (offlineFailures) {
    correlations.push({
      id: 'transport-loss-then-outbox-failure',
      confidence: 'medium',
      title: 'Outbound failures followed transport loss',
      detail:
        'The failed-outbox count increased within five minutes of the radio transport dropping. Check reconnect duration, retry timing and whether safety/control TTLs expired while offline.',
      eventCodes: offlineFailures.map(event => event.code),
      windowMs: offlineFailures[1].occurredAtMs - offlineFailures[0].occurredAtMs,
    });
  }

  const gpsMap = findPair(
    recent,
    'gps-fix-lost',
    'trip-map-coverage-incomplete',
    300_000,
  );
  if (gpsMap) {
    correlations.push({
      id: 'gps-loss-near-map-coverage-change',
      confidence: 'low',
      title: 'GPS and trip-coverage problems occurred close together',
      detail:
        'A GPS loss and an offline map-coverage change occurred within five minutes. They may be unrelated; inspect location permissions/provider state separately from map-pack verification.',
      eventCodes: gpsMap.map(event => event.code),
      windowMs: gpsMap[1].occurredAtMs - gpsMap[0].occurredAtMs,
    });
  }

  const transportReacquire = findPair(
    recent,
    'radio-transport-ready',
    'convoy-reacquired',
    180_000,
  );
  if (transportReacquire) {
    correlations.push({
      id: 'transport-restored-before-reacquisition',
      confidence: 'low',
      title: 'Convoy reacquisition followed transport recovery',
      detail:
        'A vehicle was reacquired shortly after the local radio transport became ready. This is consistent with a local link outage, but peer-side RF conditions may also have changed.',
      eventCodes: transportReacquire.map(event => event.code),
      windowMs:
        transportReacquire[1].occurredAtMs - transportReacquire[0].occurredAtMs,
    });
  }

  return correlations;
}
