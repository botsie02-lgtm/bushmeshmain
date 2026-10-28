import React, {useEffect, useRef} from 'react';

import {subscribeBushMeshInboundMessages} from '../bushmesh/inboundBus';
import {
  BUSHMESH_POSITION_REQUEST_MESSAGE_TYPE,
  getPositionRequestTemporalDecision,
} from '../bushmesh/positionRequestProtocol';
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
    return subscribeBushMeshInboundMessages((message, metadata) => {
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

      const temporal = getPositionRequestTemporalDecision(
        request,
        metadata.receivedAtMs,
      );
      if (!temporal.active) {
        return;
      }

      const requestKey = `${request.senderId}:${request.timestampSeconds}:${request.sequence}`;
      const nowMs = Date.now();
      const seen = seenRequestsRef.current;
      for (const [key, seenAtMs] of seen) {
        if (nowMs - seenAtMs > REQUEST_DEDUPE_RETENTION_MS) {
          seen.delete(key);
        }
      }
      if (seen.has(requestKey)) {
        return;
      }
      seen.set(requestKey, nowMs);

      respondToPositionRequest(message.channelIndex, nowMs);
    });
  }, [identityRef, providerLabel, respondToPositionRequest]);

  return null;
}
