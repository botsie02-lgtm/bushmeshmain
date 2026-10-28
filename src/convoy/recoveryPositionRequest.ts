import {
  BUSHMESH_POSITION_REQUEST_DEFAULT_TTL_SECONDS,
} from '../bushmesh/positionRequestProtocol';
import {BushMeshOutboxEntry} from '../bushmesh/outbox';
import {bushMeshRadioSession} from '../radio/BushMeshRadioSession';

export type QueueRecoveryPositionRequestInput = {
  channelIndex: number;
  targetId: string;
  sequence: number;
  ttlSeconds?: number;
  nowMs?: number;
};

export type QueuedRecoveryPositionRequest = {
  entry: BushMeshOutboxEntry;
  requestedAtMs: number;
  nextAllowedAtMs: number;
};

const REQUEST_COOLDOWN_MS = 30_000;
const lastRequestedAtByTarget = new Map<string, number>();

function normalizeTarget(targetId: string): string {
  return targetId.replace(/[^0-9a-f]/gi, '').toUpperCase();
}

export function queueRecoveryPositionRequest(
  input: QueueRecoveryPositionRequestInput,
): QueuedRecoveryPositionRequest {
  const nowMs = input.nowMs ?? Date.now();
  const targetId = normalizeTarget(input.targetId);
  const previous = lastRequestedAtByTarget.get(targetId);

  if (previous !== undefined && nowMs - previous < REQUEST_COOLDOWN_MS) {
    const remainingSeconds = Math.ceil(
      (REQUEST_COOLDOWN_MS - (nowMs - previous)) / 1000,
    );
    throw new Error(
      `Wait ${remainingSeconds}s before requesting another fix from this vehicle.`,
    );
  }

  const entry = bushMeshRadioSession.queuePositionRequest({
    channelIndex: input.channelIndex,
    targetId,
    sequence: input.sequence,
    timestampSeconds: Math.floor(nowMs / 1000),
    ttlSeconds:
      input.ttlSeconds ?? BUSHMESH_POSITION_REQUEST_DEFAULT_TTL_SECONDS,
  });

  lastRequestedAtByTarget.set(targetId, nowMs);
  return {
    entry,
    requestedAtMs: nowMs,
    nextAllowedAtMs: nowMs + REQUEST_COOLDOWN_MS,
  };
}
