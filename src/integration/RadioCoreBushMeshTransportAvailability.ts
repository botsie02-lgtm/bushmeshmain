import type {
  BushMeshTransportAvailability,
  BushMeshTransportAvailabilityPort,
} from '../bushmesh/runtime/public';
import {
  BushMeshRadioSession,
  bushMeshRadioSession,
} from '../radio/BushMeshRadioSession';

type RadioSessionAvailabilityPort = Pick<
  BushMeshRadioSession,
  'getSnapshot' | 'subscribe'
>;

/**
 * Read-only canonical runtime view of the radio-core carrier lifecycle.
 * It does not connect, disconnect or send; radio-core remains the lifecycle
 * owner. No MTU is invented here because the current carrier contract does not
 * expose a measured payload ceiling yet.
 */
export class RadioCoreBushMeshTransportAvailability
  implements BushMeshTransportAvailabilityPort
{
  constructor(private readonly radioSession: RadioSessionAvailabilityPort) {}

  getAvailability(): BushMeshTransportAvailability {
    const snapshot = this.radioSession.getSnapshot();
    if (!snapshot.transportReady) {
      return {
        transport: 'meshcore',
        available: false,
        reason: snapshot.runtimeRequested
          ? 'carrier-disconnected'
          : 'carrier-not-started',
      };
    }

    if (!snapshot.identityRef) {
      return {
        transport: 'meshcore',
        available: false,
        reason: 'radio-identity-pending',
      };
    }

    return {
      transport: 'meshcore',
      available: true,
    };
  }

  subscribe(
    listener: (value: BushMeshTransportAvailability) => void,
  ): () => void {
    return this.radioSession.subscribe(() => listener(this.getAvailability()));
  }
}

export const bushMeshTransportAvailability =
  new RadioCoreBushMeshTransportAvailability(bushMeshRadioSession);
