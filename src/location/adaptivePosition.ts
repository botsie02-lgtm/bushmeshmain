export type AdaptivePositionReason =
  | 'urgent'
  | 'large-gap'
  | 'turning'
  | 'moving'
  | 'creeping'
  | 'stationary';

export type AdaptivePositionInput = {
  speedKmh: number | null;
  headingChangeDegrees?: number | null;
  convoyGapMeters?: number | null;
  urgent?: boolean;
};

export type AdaptivePositionDecision = {
  intervalMs: number;
  reason: AdaptivePositionReason;
};

const FIVE_SECONDS = 5_000;
const EIGHT_SECONDS = 8_000;
const FIFTEEN_SECONDS = 15_000;
const THIRTY_SECONDS = 30_000;
const NINETY_SECONDS = 90_000;

/**
 * Air-time aware position policy for normal convoy operation.
 *
 * The radio service can call this after every location update. It deliberately
 * avoids a fixed GPS/LoRa transmit cadence: urgent events and growing convoy
 * gaps get fast updates, while stopped vehicles back off heavily.
 */
export function getAdaptivePositionDecision(
  input: AdaptivePositionInput,
): AdaptivePositionDecision {
  if (input.urgent) {
    return {intervalMs: FIVE_SECONDS, reason: 'urgent'};
  }

  if ((input.convoyGapMeters ?? 0) >= 1_000) {
    return {intervalMs: FIVE_SECONDS, reason: 'large-gap'};
  }

  if ((input.headingChangeDegrees ?? 0) >= 30) {
    return {intervalMs: EIGHT_SECONDS, reason: 'turning'};
  }

  const speedKmh = input.speedKmh ?? 0;

  if (speedKmh >= 8) {
    return {intervalMs: FIFTEEN_SECONDS, reason: 'moving'};
  }

  if (speedKmh > 0.5) {
    return {intervalMs: THIRTY_SECONDS, reason: 'creeping'};
  }

  return {intervalMs: NINETY_SECONDS, reason: 'stationary'};
}

export function shouldTransmitPosition(
  lastTransmittedAtMs: number | null,
  nowMs: number,
  input: AdaptivePositionInput,
): boolean {
  if (lastTransmittedAtMs === null) {
    return true;
  }

  const decision = getAdaptivePositionDecision(input);
  return nowMs - lastTransmittedAtMs >= decision.intervalMs;
}
