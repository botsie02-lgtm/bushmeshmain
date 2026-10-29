import {useEffect, useMemo, useRef} from 'react';

import {subscribeBushMeshInboundMessages} from '../bushmesh/inboundBus';
import {
  BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE,
  BUSHMESH_POSITION_RESPONSE_FLAG,
  getPositionRequestTemporalDecision,
} from '../bushmesh/positionRequestProtocol';
import {BushMeshMessageType} from '../bushmesh/protocol';
import {recordRecoveryPositionResponse} from '../convoy/recoveryPositionRequest';
import {useBushMesh} from '../state/BushMeshContext';
import {useConvoy} from '../state/ConvoyContext';
import {useLocationSession} from '../state/LocationSessionContext';
import {useRadioSession} from '../state/RadioSessionContext';

const REQUEST_DEDUPE_RETENTION_MS = 10 * 60 * 1000;
const REQUESTER_RESPONSE_COOLDOWN_MS = 30_000;
const MAX_AUTO_RESPONSE_FIX_AGE_MS = 15_000;

function normalizeIdentity(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(normalized) ? normalized : null;
}

/**
 * Answers a targeted recovery position request with the latest already-accepted
 * local GPS fix. The response uses the normal POSITION wire format, flagged as
 * request-driven, so convoy receivers do not need a second location model.
 *
 * The same always-mounted bridge records flagged responses observed on the
 * channel, allowing the requester UI to distinguish a response from a request
 * that merely expired without a fresh fix.
 *
 * Current Bushmesh identity refs are compact identifiers, not cryptographic
 * authentication. Therefore auto-response fails closed unless the requester is
 * an actually observed, non-simulated convoy member in this app session, is
 * asking on the selected channel, and has not triggered the responder rate
 * limit. A saved contact alone is intentionally not enough to disclose GPS.
 */
export function PositionRequestResponder(): null {
  const {activeChannel} = useBushMesh();
  const {vehicles} = useConvoy();
  const {snapshot} = useRadioSession();
  const {latestFix, providerLabel, respondToPositionRequest} = useLocationSession();
  const identityRef = normalizeIdentity(snapshot.identityRef);
  const seenRequestsRef = useRef<Map<string, number>>(new Map());
  const lastResponseAtByRequesterRef = useRef<Map<string, number>>(new Map());

  const observedRequesterIds = useMemo(() => {
    const ids = new Set<string>();
    vehicles.forEach(vehicle => {
      if (vehicle.simulated) {
        return;
      }
      const id = normalizeIdentity(vehicle.id);
      if (id) {
        ids.add(id);
      }
    });
    return ids;
  }, [vehicles]);

  const activeChannelIndex = Number(activeChannel?.channelIndex);
  const hasValidActiveChannel =
    Number.isInteger(activeChannelIndex) &&
    activeChannelIndex >= 0 &&
    activeChannelIndex <= 7;

  useEffect(() => {
    return subscribeBushMeshInboundMessages(message => {
      if (message.type === BushMeshMessageType.Position) {
        const requestDriven =
          ((message.position.flags ?? 0) & BUSHMESH_POSITION_RESPONSE_FLAG) !== 0;
        if (requestDriven) {
          recordRecoveryPositionResponse(
            message.position.senderId,
            message.channelIndex,
            Date.now(),
          );
        }
        return;
      }

      if (message.type !== BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE) {
        return;
      }

      const request = message.request;
      const targetId = normalizeIdentity(request.targetId);
      const requesterId = normalizeIdentity(request.senderId);
      if (
        !identityRef ||
        !targetId ||
        !requesterId ||
        targetId !== identityRef ||
        requesterId === identityRef
      ) {
        return;
      }

      if (
        !hasValidActiveChannel ||
        message.channelIndex !== activeChannelIndex ||
        !observedRequesterIds.has(requesterId)
      ) {
        return;
      }

      // Development simulation must never answer a real mesh recovery request.
      if (providerLabel?.toLowerCase().includes('simulated')) {
        return;
      }

      const nowMs = Date.now();
      const temporal = getPositionRequestTemporalDecision(request, nowMs);
      if (!temporal.active) {
        return;
      }

      // Auto-response is deliberately stricter than the generic location API:
      // a recovery request may only disclose a fix that is genuinely current.
      if (
        !latestFix ||
        nowMs - latestFix.timestampMs < -10_000 ||
        nowMs - latestFix.timestampMs > MAX_AUTO_RESPONSE_FIX_AGE_MS
      ) {
        return;
      }

      const lastResponseAt = lastResponseAtByRequesterRef.current.get(requesterId);
      if (
        lastResponseAt !== undefined &&
        nowMs - lastResponseAt < REQUESTER_RESPONSE_COOLDOWN_MS
      ) {
        return;
      }

      const requestKey = `${request.senderId}:${request.timestampSeconds}:${request.sequence}`;
      const seen = seenRequestsRef.current;
      for (const [key, seenAtMs] of seen) {
        if (nowMs - seenAtMs > REQUEST_DEDUPE_RETENTION_MS) {
          seen.delete(key);
        }
      }
      if (seen.has(requestKey)) {
        return;
      }

      const response = respondToPositionRequest(message.channelIndex, nowMs);
      if (response.queued) {
        // Only mark the request handled after a real response entered the
        // outbox. If GPS was unavailable/stale, a later retransmission may be
        // answered once a trustworthy fix exists.
        seen.set(requestKey, nowMs);
        lastResponseAtByRequesterRef.current.set(requesterId, nowMs);
      }
    });
  }, [
    activeChannelIndex,
    hasValidActiveChannel,
    identityRef,
    latestFix,
    observedRequesterIds,
    providerLabel,
    respondToPositionRequest,
  ]);

  return null;
}
