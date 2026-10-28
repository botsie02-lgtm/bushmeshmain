import {BushMeshOutboxEntry} from '../bushmesh/outbox';
import {ConvoyFormationMember} from './formation';
import {bushMeshRadioSession} from '../radio/BushMeshRadioSession';

export type QueueLocalFormationShareInput = {
  channelIndex: number;
  members: ConvoyFormationMember[];
  cautionGapMeters: number;
  criticalGapMeters: number;
  nowMs?: number;
};

export type QueuedFormationShare = {
  entry: BushMeshOutboxEntry;
  revision: number;
  sequence: number;
};

function normalizeRemoteIdentity(id: string): string {
  const normalized = id.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(normalized)) {
    throw new Error(
      `Formation member ${id} does not have a shareable Bushmesh identity yet.`,
    );
  }
  return normalized;
}

/**
 * Queues the current explicit formation through the normal Bushmesh outbox.
 * The returned entry being queued is not peer delivery confirmation. The radio
 * session owns retries, expiry and the eventual radio-accepted state.
 */
export function queueLocalFormationShare(
  input: QueueLocalFormationShareInput,
): QueuedFormationShare {
  const radio = bushMeshRadioSession.getSnapshot();
  if (radio.identityRef === null) {
    throw new Error(
      'Connect and identify a Bushmesh radio before sharing the formation.',
    );
  }
  if (!radio.transportReady) {
    throw new Error(
      'The Bushmesh radio transport is not ready. Formation sharing remains local.',
    );
  }
  if (!Number.isInteger(input.channelIndex) || input.channelIndex < 0 || input.channelIndex > 7) {
    throw new Error('Select a valid MeshCore channel before sharing the formation.');
  }
  if (input.members.length === 0) {
    throw new Error('Configure a convoy formation before sharing it.');
  }

  const senderId = radio.identityRef.toUpperCase();
  const memberIds = input.members.map(member =>
    member.kind === 'self' ? senderId : normalizeRemoteIdentity(member.id),
  );
  const selfCount = memberIds.filter(memberId => memberId === senderId).length;
  if (selfCount !== 1) {
    throw new Error(
      'The shared formation must contain this vehicle exactly once.',
    );
  }

  const nowMs = input.nowMs ?? Date.now();
  const timestampSeconds = Math.floor(nowMs / 1000);
  const sequence = timestampSeconds & 0xffff;
  const revision = sequence;
  const entry = bushMeshRadioSession.queueFormationShare({
    channelIndex: input.channelIndex,
    sequence,
    timestampSeconds,
    revision,
    cautionGapMeters: Math.round(input.cautionGapMeters),
    criticalGapMeters: Math.round(input.criticalGapMeters),
    memberIds,
  });

  // Best-effort foreground nudge. A higher-priority entry may drain first; the
  // outbox worker remains responsible for the formation entry after this call.
  bushMeshRadioSession.drainOnce().catch(() => undefined);

  return {entry, revision, sequence};
}
