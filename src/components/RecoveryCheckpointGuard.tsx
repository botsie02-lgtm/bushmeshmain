import {useEffect} from 'react';

import {getConvoyFreshness} from '../convoy/convoy';
import {useConvoy} from '../state/ConvoyContext';

/**
 * A recovery checkpoint is historical evidence, not a destination that should
 * survive a trustworthy reacquisition. Once the referenced vehicle is LIVE or
 * RECENT again with a fix newer than the checkpoint, clear the old anchor.
 *
 * We deliberately do not auto-follow the vehicle: changing a driver's moving
 * destination still requires the explicit FOLLOW action on the reacquisition
 * banner.
 */
export function RecoveryCheckpointGuard(): null {
  const {
    vehicles,
    navigationFieldTarget,
    clearNavigationTarget,
  } = useConvoy();

  useEffect(() => {
    if (navigationFieldTarget?.type !== 'recovery-checkpoint') {
      return;
    }

    const vehicle = vehicles.find(
      item => item.id.toUpperCase() === navigationFieldTarget.senderId.toUpperCase(),
    );
    if (!vehicle || vehicle.receivedAtMs <= navigationFieldTarget.createdAtMs) {
      return;
    }

    const freshness = getConvoyFreshness(vehicle.receivedAtMs);
    if (freshness === 'live' || freshness === 'recent') {
      clearNavigationTarget();
    }
  }, [clearNavigationTarget, navigationFieldTarget, vehicles]);

  return null;
}
