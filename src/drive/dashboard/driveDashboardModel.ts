import {getConvoyFreshness, formatPositionAge} from '../../convoy/convoy';
import {getTripReadiness} from '../tripReadiness';
import {validateLocationFix} from '../../location/positionPlanner';
import {
  isValidMapCoordinate,
  normalizedHeading,
  selectRenderableMapPack,
} from '../../maps/convoyMapModel';
import type {AuthorizedConvoyMembership} from '../../app/activeContext/operationalConvoy';
import type {BushMeshChannelMessage} from '../../state/BushMeshContext';
import type {DriveAlert} from '../../state/DriveContext';
import type {LocationSessionStatus} from '../../state/LocationSessionContext';
import type {BushMeshLocationFix} from '../../location/positionPlanner';
import type {ConvoyMapFix, ConvoyMapMember} from '../../maps/convoyMapModel';
import type {BushMeshMapPackCatalogEntry} from '../../maps/mapPackCatalog';
import type {TripMapCoverage} from '../../maps/offlineMapPacks';
import type {BushMeshRadioSessionSnapshot} from '../../radio/BushMeshRadioSession';

export type VerifiedConvoyRoster = {
  convoyId: string;
  localIdentityRef: string;
  /** MUST originate in the authenticated membership store, not public discovery. */
  verifiedBy: 'security-v1';
  /** Authorised REMOTE members only; no broad radio vehicles. */
  members: readonly ConvoyMapMember[];
};

export type VerifiedConvoyAlerts = {
  convoyId: string;
  localIdentityRef: string;
  verifiedBy: 'security-v1';
  /** Already authenticated, authorised and scoped by the integration worker. */
  alerts: readonly DriveAlert[];
};

export type AuthorisedCarrierBinding = {
  convoyId: string;
  localIdentityRef: string;
  channelIndex: number;
  /** Must be established by trusted integration, never inferred from a PSK. */
  verifiedBy: 'security-v1';
};

export type DriveDashboardInput = {
  nowMs: number;
  activeConvoy: AuthorizedConvoyMembership | null;
  roster: VerifiedConvoyRoster | null;
  verifiedAlerts: VerifiedConvoyAlerts | null;
  carrierBinding: AuthorisedCarrierBinding | null;
  radioConnectionStatus: 'Connected' | 'Disconnected';
  activeCarrierChannelIndex: string | null;
  radioSession: Pick<
    BushMeshRadioSessionSnapshot,
    'transportReady' | 'identityRef' | 'queuedCount' | 'inflightCount' | 'failedCount'
  >;
  locationStatus: LocationSessionStatus;
  locationProviderLabel: string | null;
  latestFix: BushMeshLocationFix | null;
  mapCoverage: TripMapCoverage;
  requiredTripPointCount: number;
  packCatalog: readonly BushMeshMapPackCatalogEntry[];
  offlineTilesAvailable: boolean;
  channelMessages: readonly Pick<BushMeshChannelMessage,
    'id' | 'direction' | 'createdAt' | 'channelIndex'
  >[];
};

export type DashboardFreshness = 'live' | 'recent' | 'stale' | 'lost' | 'unknown';

export type DriveDashboardModel = {
  status: 'ready' | 'attention';
  statusTitle: string;
  statusDetail: string;
  radioStatus: 'ready' | 'connected' | 'offline';
  connectionDetail: string;
  convoy: {
    id: string | null;
    name: string;
    memberRosterVerified: boolean;
    verifiedMemberCount: number | null;
    live: number;
    recent: number;
    stale: number;
    lost: number;
    noPosition: number;
  };
  gps: {
    fix: ConvoyMapFix | null;
    freshness: DashboardFreshness;
    ageLabel: string;
    latitudeLabel: string;
    longitudeLabel: string;
    headingLabel: string;
    accuracyLabel: string;
    simulated: boolean;
    nativeSource: boolean;
    tracking: boolean;
  };
  maps: {
    status: 'ready' | 'no-route' | 'no-pack' | 'no-tiles' | 'uncovered';
    label: string;
    detail: string;
  };
  incomingCarrierMessages: number;
  outgoingPending: number;
  outgoingFailed: number;
  alerts: readonly DriveAlert[];
  alertsAvailable: boolean;
  actionAvailability: {
    canTransmit: boolean;
    reason: string;
    channelIndex: number | null;
  };
  /** Already scoped to the authorised convoy, or empty when unverified. */
  mapMembers: readonly ConvoyMapMember[];
};

const FIVE_MINUTES = 5 * 60_000;
const FUTURE_TOLERANCE_MS = 10_000;

function validNow(nowMs: number): boolean {
  return Number.isFinite(nowMs) && nowMs >= 0;
}

function verifiedContext(input: DriveDashboardInput): AuthorizedConvoyMembership | null {
  const active = input.activeConvoy;
  if (
    !active ||
    active.authorizationState !== 'authorized' ||
    active.verifiedBy !== 'security-v1' ||
    !active.convoyId ||
    !active.localIdentityRef ||
    !active.membershipRecordRef ||
    input.radioSession.identityRef !== active.localIdentityRef
  ) {
    return null;
  }
  return active;
}

function sameVerifiedScope(
  value: {convoyId: string; localIdentityRef: string; verifiedBy: 'security-v1'} | null,
  active: AuthorizedConvoyMembership | null,
): boolean {
  return !!active && !!value && value.verifiedBy === 'security-v1' &&
    value.convoyId === active.convoyId &&
    value.localIdentityRef === active.localIdentityRef;
}

function scopedBinding(
  input: DriveDashboardInput,
  active: AuthorizedConvoyMembership | null,
): number | null {
  const binding = input.carrierBinding;
  if (!sameVerifiedScope(binding, active) || !binding) {
    return null;
  }
  const selectedIndex = input.activeCarrierChannelIndex;
  const parsedIndex = selectedIndex === null || selectedIndex.trim() === ''
    ? NaN
    : Number(selectedIndex);
  return Number.isInteger(binding.channelIndex) &&
    binding.channelIndex >= 0 && binding.channelIndex <= 7 &&
    parsedIndex === binding.channelIndex
    ? binding.channelIndex
    : null;
}

function safeFix(input: DriveDashboardInput): {
  fix: ConvoyMapFix | null;
  simulated: boolean;
  freshness: DashboardFreshness;
} {
  const simulated = /simulat/i.test(input.locationProviderLabel ?? '');
  const source = input.latestFix;
  if (
    !source ||
    validateLocationFix(source) !== null ||
    !validNow(input.nowMs) ||
    source.timestampMs > input.nowMs + FUTURE_TOLERANCE_MS
  ) {
    return {fix: null, simulated, freshness: 'unknown'};
  }
  const freshness = getConvoyFreshness(source.timestampMs, input.nowMs);
  return {
    fix: {
      latitude: source.latitude,
      longitude: source.longitude,
      receivedAtMs: source.timestampMs,
      headingDegrees: normalizedHeading(source.headingDegrees),
      accuracyMeters: source.accuracyMeters ?? null,
    },
    simulated,
    freshness,
  };
}

function mapReadiness(input: DriveDashboardInput): DriveDashboardModel['maps'] {
  const verifiedPack = selectRenderableMapPack(input.packCatalog, null);
  if (!verifiedPack) {
    return {
      status: 'no-pack',
      label: 'No verified map archive',
      detail: 'Download and verify a regional offline map pack.',
    };
  }
  if (!input.offlineTilesAvailable) {
    return {
      status: 'no-tiles',
      label: 'Offline tiles unavailable',
      detail: 'Archive verified, but native archive tile reading is not available.',
    };
  }
  if (input.requiredTripPointCount === 0) {
    return {
      status: 'no-route',
      label: 'No trip coverage check',
      detail: 'Offline pack is present; select a route to verify coverage.',
    };
  }
  if (!input.mapCoverage.complete ||
    input.mapCoverage.totalPointCount !== input.requiredTripPointCount) {
    return {
      status: 'uncovered',
      label: 'Trip not fully covered',
      detail: 'Some required trip locations are outside verified offline packs.',
    };
  }
  return {
    status: 'ready',
    label: 'Trip pack coverage verified',
    detail: 'Archive coverage and tile reader are available; actual tiles and routing still need verification in the map.'
  };
}

/** Pure, deterministic projection; NEVER derives authorisation from discovery. */
export function deriveDriveDashboard(input: DriveDashboardInput): DriveDashboardModel {
  const active = verifiedContext(input);
  const rosterValid = sameVerifiedScope(input.roster, active);
  const alertFeedValid = sameVerifiedScope(input.verifiedAlerts, active);
  const fix = safeFix(input);
  const bindingChannel = scopedBinding(input, active);
  const linkReady = input.radioConnectionStatus === 'Connected' &&
    input.radioSession.transportReady && !!input.radioSession.identityRef;
  const nativeSource = input.locationProviderLabel === 'Android GPS';
  const gpsTracking = input.locationStatus === 'tracking' ||
    input.locationStatus === 'tracking-no-link';
  const selfFresh = gpsTracking && !!fix.fix &&
    fix.freshness === 'live' && nativeSource;
  const map = mapReadiness(input);

  const members: ConvoyMapMember[] = [];
  const ids = new Set<string>();
  const summary = {live: 0, recent: 0, stale: 0, lost: 0, noPosition: 0};
  if (rosterValid && input.roster) {
    for (const member of input.roster.members) {
      if (!member.id || ids.has(member.id) || ids.size >= 256) {
        continue;
      }
      ids.add(member.id);
      const position = member.position;
      if (!position || !isValidMapCoordinate(position) ||
        !validNow(position.receivedAtMs) ||
        position.receivedAtMs > input.nowMs + FUTURE_TOLERANCE_MS) {
        summary.noPosition += 1;
        members.push({
          id: member.id,
          label: typeof member.label === 'string' && member.label.trim()
            ? member.label.trim() : member.id,
          position: null,
        });
        continue;
      }
      const freshness = getConvoyFreshness(position.receivedAtMs, input.nowMs);
      summary[freshness] += 1;
      members.push({
        id: member.id,
        label: typeof member.label === 'string' && member.label.trim()
          ? member.label.trim() : member.id,
        position,
      });
    }
  }

  const authorisedAlerts = alertFeedValid && input.verifiedAlerts
    ? input.verifiedAlerts.alerts.filter(alert =>
      alert.source === 'radio' &&
      validNow(alert.receivedAtMs) &&
      alert.receivedAtMs <= input.nowMs + FUTURE_TOLERANCE_MS &&
      (alert.expiresAtMs === null || alert.expiresAtMs > input.nowMs),
    ).sort((a, b) => b.receivedAtMs - a.receivedAtMs).slice(0, 3)
    : [];

  const carrierMessages = input.channelMessages.filter(message => {
    const timestamp = Date.parse(message.createdAt);
    return message.direction === 'received' &&
      input.activeCarrierChannelIndex !== null &&
      message.channelIndex === input.activeCarrierChannelIndex &&
      Number.isFinite(timestamp) &&
      timestamp <= input.nowMs + FUTURE_TOLERANCE_MS &&
      timestamp >= input.nowMs - FIVE_MINUTES;
  }).length;

  const actionReason = !active
    ? 'Choose an authorised operational convoy.'
    : !rosterValid
      ? 'Waiting for a verified convoy roster.'
      : bindingChannel === null
        ? 'No authorised binding to the selected MeshCore carrier.'
        : !linkReady
          ? 'Radio transport and identity are not ready.'
          : !selfFresh
            ? 'Active Android GPS tracking with a fresh fix is required for location-based actions.'
            : '';

  const readiness = getTripReadiness({
    radioConnected: input.radioConnectionStatus === 'Connected',
    radioTransportReady: input.radioSession.transportReady,
    radioIdentityReady: !!input.radioSession.identityRef,
    channelSelected: bindingChannel !== null,
    localPositionReady: selfFresh,
    convoyMembersKnown: rosterValid,
    offlineMapReady: map.status === 'ready',
    navigationRequired: input.requiredTripPointCount > 0,
  });
  const driveReady = !!active && rosterValid && readiness.canStartConvoy &&
    (input.requiredTripPointCount === 0 || map.status === 'ready');
  const gpsAge = fix.fix
    ? formatPositionAge(Math.floor(Math.max(0, input.nowMs - fix.fix.receivedAtMs) / 1000))
    : 'No valid fix';

  return {
    status: driveReady ? 'ready' : 'attention',
    statusTitle: driveReady ? 'DRIVE SETUP READY' : 'DRIVE SETUP INCOMPLETE',
    statusDetail: driveReady
      ? 'Operational identity, local GPS, authorised roster and radio carrier binding are ready. Driving safety is not guaranteed.'
      : actionReason || (map.status !== 'ready' && input.requiredTripPointCount > 0
        ? map.detail
        : 'Check radio, GPS and convoy prerequisites.'),
    radioStatus: linkReady ? 'ready' :
      input.radioConnectionStatus === 'Connected' ? 'connected' : 'offline',
    connectionDetail: linkReady
      ? 'MeshCore transport ready; peer delivery is not confirmed.'
      : input.radioConnectionStatus === 'Connected'
        ? 'Node connected; data transport or identity unavailable.'
        : 'Connect your MeshCore companion.',
    convoy: {
      id: active?.convoyId ?? null,
      name: active?.displayName ?? 'No active convoy',
      memberRosterVerified: rosterValid,
      verifiedMemberCount: rosterValid ? members.length : null,
      ...summary,
    },
    gps: {
      fix: fix.fix,
      freshness: fix.freshness,
      ageLabel: gpsAge,
      latitudeLabel: fix.fix ? fix.fix.latitude.toFixed(5) : '—',
      longitudeLabel: fix.fix ? fix.fix.longitude.toFixed(5) : '—',
      headingLabel: fix.fix?.headingDegrees == null
        ? '—' : Math.round(fix.fix.headingDegrees) + '°',
      accuracyLabel: fix.fix?.accuracyMeters == null
        ? '—' : '±' + Math.round(fix.fix.accuracyMeters) + ' m',
      simulated: fix.simulated,
      nativeSource,
      tracking: gpsTracking,
    },
    maps: map,
    incomingCarrierMessages: carrierMessages,
    outgoingPending: input.radioSession.queuedCount + input.radioSession.inflightCount,
    outgoingFailed: input.radioSession.failedCount,
    alerts: authorisedAlerts,
    alertsAvailable: alertFeedValid,
    actionAvailability: {
      canTransmit: actionReason === '',
      reason: actionReason,
      channelIndex: bindingChannel,
    },
    mapMembers: members,
  };
}
