import React, {useEffect, useRef} from 'react';

import {subscribeBushMeshInboundMessages} from '../bushmesh/inboundBus';
import {
  BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE,
  BUSHMESH_POSITION_RESPONSE_FLAG,
  getPositionRequestTemporalDecision,
} from '../bushmesh/positionRequestProtocol';
import {BushMeshMessageType} from '../bushmesh/protocol';
import {recordRecoveryPositionResponse} from '../convoy/recoveryPositionRequest';
import {useLocationSession} from '../state/LocationSessionContext';
import {useRadioSession} from '../state/RadioSessionContext';

const REQUEST_DEDUPE_RETENTION_MS = 10 * 60 * 1000;

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
 * This bridge deliberately refuses simulated GPS, expired/replayed requests,
 * requests for another radio identity, and stale local fixes. A request is not
 * an instruction to fabricate a location or make an old fix appear current.
 */
export function PositionRequestResponder(): null {
  const {snapshot} = useRadioSession();
  const {providerLabel, respondToPositionRequest} = useLocationSession();
  const identityRef = normalizeIdentity(snapshot.identityRef);
  const seenRequestsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    return subscribeBushMeshInboundMessages(message => {
      if (message.type === BushMeshMessageType.Position) {
        const requestDriven =
          ((message.position.flags ?? 0) & BUSHMESH_POSITION_RESPONSE_FLAG) !== 0;
        if (requestDriven) {
          recordRecoveryPositionResponse(message.position.senderId, Date.now());
        }
        return;
      }

      if (message.type !== BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE) {
        return;
      }

      const request = message.request;
      const targetId = normalizeIdentity(request.targetId);
      if (!identityRef || !targetId || targetId !== identityRef) {
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
      }
    });
  }, [identityRef, providerLabel, respondToPositionRequest]);

  return null;
}
