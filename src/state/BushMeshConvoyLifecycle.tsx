import React, {useEffect, useRef} from 'react';

import {
  getBushMeshConvoyState,
  nextBushMeshConvoyStatus,
  updateBushMeshConvoyTelemetry,
} from '../bushmesh/runtime/BushMeshConvoyHub';
import {sendActiveBushMeshConvoyStatus} from '../bushmesh/runtime/BushMeshRuntimeHub';
import {useBushMesh} from './BushMeshContext';

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
    deviceStatus,
    bushMeshNetworkStatus,
  } = useBushMesh();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (deviceStatus?.batteryMv) {
      // MeshCore currently exposes millivolts rather than battery percent in
      // this state surface, so do not invent a percentage here. The field can
      // be populated later when firmware provides a reliable percentage.
      updateBushMeshConvoyTelemetry({});
    }
  }, [deviceStatus?.batteryMv]);

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

      const interval = Math.max(2000, state.config.heartbeatIntervalMs);
      timerRef.current = setTimeout(run, interval);
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
  ]);

  return null;
}
