export type TripReadinessState = 'ready' | 'warning' | 'blocked';

export type TripReadinessInput = {
  radioConnected: boolean;
  radioTransportReady: boolean;
  radioIdentityReady: boolean;
  channelSelected: boolean;
  localPositionReady: boolean;
  convoyMembersKnown: boolean;
  offlineMapReady?: boolean;
  navigationRequired?: boolean;
};

export type TripReadinessItem = {
  key:
    | 'radio'
    | 'identity'
    | 'channel'
    | 'position'
    | 'convoy'
    | 'offline-map';
  label: string;
  state: TripReadinessState;
  detail: string;
};

export type TripReadinessReport = {
  canStartConvoy: boolean;
  canNavigateOffline: boolean;
  items: TripReadinessItem[];
  blockers: TripReadinessItem[];
  warnings: TripReadinessItem[];
};

/**
 * Keeps driver readiness explicit rather than hiding missing capabilities.
 * Radio, identity, channel and local position are mandatory for a real convoy
 * session. Known remote members and offline maps can warn without blocking
 * basic radio operation.
 */
export function getTripReadiness(
  input: TripReadinessInput,
): TripReadinessReport {
  const items: TripReadinessItem[] = [
    {
      key: 'radio',
      label: 'Radio',
      state:
        input.radioConnected && input.radioTransportReady ? 'ready' : 'blocked',
      detail:
        input.radioConnected && input.radioTransportReady
          ? 'Mesh radio transport is ready.'
          : input.radioConnected
            ? 'Radio connected, but Bushmesh data transport is not ready.'
            : 'Connect a MeshCore radio.',
    },
    {
      key: 'identity',
      label: 'Identity',
      state: input.radioIdentityReady ? 'ready' : 'blocked',
      detail: input.radioIdentityReady
        ? 'Radio identity is available.'
        : 'Waiting for the radio public identity.',
    },
    {
      key: 'channel',
      label: 'Channel',
      state: input.channelSelected ? 'ready' : 'blocked',
      detail: input.channelSelected
        ? 'Convoy channel selected.'
        : 'Select a convoy channel.',
    },
    {
      key: 'position',
      label: 'Position',
      state: input.localPositionReady ? 'ready' : 'blocked',
      detail: input.localPositionReady
        ? 'Local position is available.'
        : 'Waiting for a local GPS fix.',
    },
    {
      key: 'convoy',
      label: 'Convoy',
      state: input.convoyMembersKnown ? 'ready' : 'warning',
      detail: input.convoyMembersKnown
        ? 'Remote convoy members are known.'
        : 'No remote convoy positions have been heard yet.',
    },
    {
      key: 'offline-map',
      label: 'Offline map',
      state: input.offlineMapReady
        ? 'ready'
        : input.navigationRequired
          ? 'blocked'
          : 'warning',
      detail: input.offlineMapReady
        ? 'Offline map data is available.'
        : input.navigationRequired
          ? 'Offline map data is required for this trip.'
          : 'No offline map pack is confirmed yet.',
    },
  ];

  const blockers = items.filter(item => item.state === 'blocked');
  const warnings = items.filter(item => item.state === 'warning');
  const coreBlockerKeys = new Set(['radio', 'identity', 'channel', 'position']);
  const canStartConvoy = !blockers.some(item => coreBlockerKeys.has(item.key));
  const canNavigateOffline = canStartConvoy && Boolean(input.offlineMapReady);

  return {
    canStartConvoy,
    canNavigateOffline,
    items,
    blockers,
    warnings,
  };
}
