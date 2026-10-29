import React, {useEffect, useRef} from 'react';

import {
  getBushMeshConvoyState,
  nextBushMeshConvoyStatus,
  recommendedBushMeshConvoyHeartbeatMs,
  updateBushMeshConvoyTelemetry,
} from '../bushmesh/runtime/BushMeshConvoyHub';
import {getBushMeshConvoyPersistence} from '../bushmesh/runtime/BushMeshConvoyPersistence';
import {
  getBushMeshNativePosition,
  isBushMeshNativeLocationAvailable,
} from '../bushmesh/runtime/BushMeshNativeLocation';
import {sendActiveBushMeshConvoyStatus} from '../bushmesh/runtime/BushMeshRuntimeHub';
import {useBushMesh} from './BushMeshContext';
import {useBushMeshConvoyState} from './useBushMeshConvoyState';

function mixHeartbeatSeed(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d) >>> 0;
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b) >>> 0;
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

/**
 * Adds deterministic per-node jitter so multiple convoy vehicles do not settle
 * into the same repeating transmit slot. Hazard traffic keeps a much narrower
 * spread so urgency is not meaningfully delayed.
 */
function staggeredHeartbeatDelay(
  baseIntervalMs: number,
  nodeId: number,
  now = Date.now(),
): number {
  const base = Math.max(2000, Math.round(baseIntervalMs));
  const spreadRatio = base <= 4000 ? 0.04 : 0.12;
  const timeBucket = Math.floor(now / base) >>> 0;
  const seed = mixHeartbeatSeed((nodeId ^ timeBucket) >>> 0);
  const unit = seed / 0xffffffff;
  const multiplier = 1 + (unit * 2 - 1) * spreadRatio;
  return Math.max(2000, Math.round(base * multiplier));
}

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
  const refreshingLocationRef = useRef(false);
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

    const refreshLocalPosition = async () => {
      if (
        refreshingLocationRef.current ||
        !isBushMeshNativeLocationAvailable()
      ) {
        return;
      }

      refreshingLocationRef.current = true;
      try {
        const state = getBushMeshConvoyState();
        const baseIntervalMs = recommendedBushMeshConvoyHeartbeatMs();
        const position = await getBushMeshNativePosition({
          // Reuse a reasonably fresh fix so hazard cadence does not force GPS
          // hardware to produce a brand-new location every three seconds.
          maxAgeMs: Math.max(
            5000,
            Math.min(30_000, state.config.heartbeatIntervalMs),
          ),
          // Automatic GPS refresh is opportunistic. It must never occupy more
          // than roughly half of an urgent heartbeat interval.
          timeoutMs: Math.max(
            1000,
            Math.min(5000, Math.round(baseIntervalMs * 0.5)),
          ),
        });

        if (cancelled) {
          return;
        }

        updateBushMeshConvoyTelemetry({
          location: position.location,
          locationCapturedAtMs: position.timestampMs,
          speedKph: position.speedKph,
          headingDegrees: position.headingDegrees,
        });
      } catch {
        // Location is opportunistic. A denied permission, tunnel/no-fix state,
        // or timeout must not prevent the radio heartbeat from being sent. The
        // convoy hub independently expires old fixes so a stale coordinate is
        // never rebroadcast forever after GPS disappears.
      } finally {
        refreshingLocationRef.current = false;
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

      // Start GPS work for the next heartbeat, but never block this heartbeat on
      // permission prompts, a tunnel/no-fix state, or a slow location provider.
      void refreshLocalPosition();

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

      const baseInterval = recommendedBushMeshConvoyHeartbeatMs();
      timerRef.current = setTimeout(
        run,
        staggeredHeartbeatDelay(baseInterval, localBushMeshNodeId),
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
