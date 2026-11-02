import {useLayoutEffect} from 'react';

import {subscribeLegacyBushMeshInboundCompatibility} from '../radio/LegacyBushMeshInboundAdapter';

/**
 * Temporary application bridge that keeps the pre-canonical BushMesh inbound
 * decoder alive while radio-core publishes only neutral ReceivedDatagram values.
 * useLayoutEffect installs the subscriber before provider passive effects can
 * replay the Android background inbox.
 */
export function LegacyBushMeshInboundBridge(): null {
  useLayoutEffect(() => {
    return subscribeLegacyBushMeshInboundCompatibility();
  }, []);

  return null;
}
