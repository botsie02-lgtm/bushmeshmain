import React, {useEffect, useRef} from 'react';

import {
  getBushMeshConvoyState,
  nextBushMeshConvoyStatus,
  recommendedBushMeshConvoyHeartbeatMs,
} from '../bushmesh/runtime/BushMeshConvoyHub';
import {getBushMeshConvoyPersistence} from '../bushmesh/runtime/BushMeshConvoyPersistence';
import {sendActiveBushMeshConvoyStatus} from '../bushmesh/runtime/BushMeshRuntimeHub';
import {useBushMesh} from './BushMeshContext';
import {useBushMeshConvoyState} from './useBushMeshConvoyState';

/**
 * Periodically emits compact convoy heartbeats while the feature is enabled.
 * It deliberately reuses the active BushMesh transport instead of creating a
 * second radio loop, so normal message/retry scheduling remains authoritative.
 */
export function BushMeshConvoyLifecycle(): React.JSX.Element | null {
  const {
    connectionStatus,
    activeChannelIndex,
    localBushMeshNodeId,
    bushMeshNetworkStatus,
  } = useBushMesh();
  const convoyState = useBushMeshConvoyState();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);
  const restoredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void getBushMeshConvoyPersistence()
      .restore()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          restoredRef.current = true;
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!restoredRef.current) {
      return;
    }

    void getBushMeshConvoyPersistence().persist().catch(() => undefined);
  }, [
    convoyState.config.convoyId,
    convoyState.config.heartbeatIntervalMs,
    convoyState.config.orderIndex,
    convoyState.config.role,
  ]);

  useEffect(() => {
    let cancelled = false;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const run = async () => {
      clearTimer();
      const state = getBushMeshConvoyState();
      const channelIndex =
        activeChannelIndex === null ? NaN : Number(activeChannelIndex);

      if (
        cancelled ||
        !state.config.enabled ||
        connectionStatus !== 'Connected' ||
        !bushMeshNetworkStatus.active ||
        localBushMeshNodeId === null ||
        !Number.isInteger(channelIndex) ||
        channelIndex < 0 ||
        channelIndex > 255
      ) {
        timerRef.current = setTimeout(run, 2000);
        return;
      }

      if (!sendingRef.current) {
        sendingRef.current = true;
        try {
          const status = nextBushMeshConvoyStatus(localBushMeshNodeId);
          await sendActiveBushMeshConvoyStatus(channelIndex, status);
        } catch {
          // Runtime/network status surfaces already report transport errors.
          // Convoy heartbeats are best-effort and should never crash the app.
        } finally {
          sendingRef.current = false;
        }
      }

      timerRef.current = setTimeout(
        run,
        Math.max(2000, recommendedBushMeshConvoyHeartbeatMs()),
      );
    };

    void run();

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [
    activeChannelIndex,
    bushMeshNetworkStatus.active,
    connectionStatus,
    localBushMeshNodeId,
    convoyState.config.enabled,
    convoyState.config.heartbeatIntervalMs,
    convoyState.telemetry.hazard,
    convoyState.telemetry.stopped,
  ]);

  return null;
}
