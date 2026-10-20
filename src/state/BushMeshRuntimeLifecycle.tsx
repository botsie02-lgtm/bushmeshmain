import React, {useCallback, useEffect, useRef} from 'react';
import {AppState, AppStateStatus} from 'react-native';

import {pruneBushMeshLiveState} from '../bushmesh/runtime/BushMeshLiveStateHub';
import {useBushMesh} from './BushMeshContext';

const MIN_AUTO_FLUSH_INTERVAL_MS = 1500;

/**
 * Bridges React Native app lifecycle events into BushMesh runtime maintenance.
 * It deliberately renders nothing: screens remain responsible for presentation,
 * while this component makes persistent delivery react quickly to reconnects and
 * foreground transitions instead of waiting solely for its periodic retry timer.
 */
export function BushMeshRuntimeLifecycle(): React.JSX.Element | null {
  const {
    connectionStatus,
    bushMeshNetworkStatus,
    bushMeshDeliveryStatus,
    flushBushMeshQueuedMessages,
  } = useBushMesh();
  const flushInProgressRef = useRef(false);
  const lastFlushAtRef = useRef(0);

  const runMaintenance = useCallback(async () => {
    pruneBushMeshLiveState(Date.now());

    if (
      connectionStatus !== 'Connected' ||
      !bushMeshNetworkStatus.active ||
      bushMeshDeliveryStatus.queuedMessages < 1 ||
      flushInProgressRef.current
    ) {
      return;
    }

    const now = Date.now();
    if (now - lastFlushAtRef.current < MIN_AUTO_FLUSH_INTERVAL_MS) {
      return;
    }

    flushInProgressRef.current = true;
    lastFlushAtRef.current = now;

    try {
      await flushBushMeshQueuedMessages();
    } catch {
      // The persistent delivery runtime owns retry/backoff state. A failed
      // foreground/reconnect flush must not create a second retry loop here.
    } finally {
      flushInProgressRef.current = false;
    }
  }, [
    connectionStatus,
    bushMeshNetworkStatus.active,
    bushMeshDeliveryStatus.queuedMessages,
    flushBushMeshQueuedMessages,
  ]);

  useEffect(() => {
    void runMaintenance();
  }, [runMaintenance]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          void runMaintenance();
        }
      },
    );

    return () => subscription.remove();
  }, [runMaintenance]);

  return null;
}
