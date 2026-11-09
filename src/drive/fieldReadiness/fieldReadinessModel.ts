import {compassDirection, getConvoyFreshness} from '../../convoy/convoy';
import {getTripReadiness} from '../tripReadiness';
import {isValidMapCoordinate, selectRenderableMapPack} from '../../maps/convoyMapModel';
import type {BushMeshMapPackCatalogEntry} from '../../maps/mapPackCatalog';
import type {DriveDashboardModel} from '../dashboard/driveDashboardModel';
import type {DriveAlert} from '../../state/DriveContext';
import {BushMeshQuickActionCode} from '../../bushmesh/legacyProtocol';

export type FieldCapabilityState =
  | 'connected'
  | 'degraded'
  | 'unavailable'
  | 'stale'
  | 'awaiting-authorisation';

export type FieldCapability = {
  key: 'radio' | 'gps' | 'maps' | 'convoy';
  state: FieldCapabilityState;
  title: string;
  detail: string;
};

/**
 * Evidence must come from a real Image.onLoad in ConvoyMap (or an equivalent
 * verified image-render callback), never from pack installation/reader presence.
 */
export type MapImageryEvidence =
  | {
      kind: 'loaded' | 'failed';
      packId: string;
      packVersion: string;
      observedAtMs: number;
    }
  | null;

export type FieldReadinessInput = {
  dashboard: DriveDashboardModel;
  packCatalog: readonly BushMeshMapPackCatalogEntry[];
  mapPackInstallSupported: boolean;
  mapPersistenceStatus: 'restoring' | 'ready' | 'unsupported' | 'error';
  imageryEvidence?: MapImageryEvidence;
  /** From LocationSessionContext.latestFix; null is unknown, not stationary. */
  speedKmh?: number | null;
  /** Required for freshness/expiry, inject in tests. */
  nowMs: number;
};

export type FieldReadinessModel = {
  title: string;
  detail: string;
  allChecksReady: boolean;
  capabilities: readonly FieldCapability[];
  radio: FieldCapability;
  gps: FieldCapability & {
    latitude: string;
    longitude: string;
    heading: string;
    accuracy: string;
    positionAge: string;
    lastKnown: boolean;
  };
  maps: FieldCapability & {
    imagery: 'loaded' | 'failed' | 'not-confirmed';
    imageryLabel: string;
    inventoryLabel: string;
    downloadLabel: string;
  };
  convoy: FieldCapability & {
    name: string;
    remoteCount: number | null;
    live: number | null;
    recent: number | null;
    attention: number | null;
  };
  alerts: readonly DriveAlert[];
  alertsLabel: string;
  traffic: {
    carrierRxLast5Min: number;
    pending: number;
    failed: number;
  };
  /** Display/interaction policy. These controls never transmit. */
  moving: boolean;
  previewAvailable: boolean;
  previewReason: string;
};

function validTime(value: number, nowMs: number): boolean {
  return Number.isFinite(value) && value >= 0 &&
    value <= nowMs + 10_000;
}

function numericCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function radioCapability(
  dashboard: DriveDashboardModel,
): FieldCapability {
  if (dashboard.radioStatus === 'ready') {
    return {
      key: 'radio', state: 'connected',
      title: 'Radio connected',
      detail: 'Data transport ready. No other vehicle delivery is confirmed.',
    };
  }
  if (dashboard.radioStatus === 'connected') {
    return {
      key: 'radio', state: 'degraded',
      title: 'Radio link degraded',
      detail: 'Node is connected; data transport or identity is not ready.',
    };
  }
  return {
    key: 'radio', state: 'unavailable',
    title: 'Radio disconnected',
    detail: 'Connect the MeshCore companion before the trip.',
  };
}

function gpsCapability(
  dashboard: DriveDashboardModel,
  nowMs: number,
): FieldReadinessModel['gps'] {
  const gps = dashboard.gps;
  const fix = gps.fix;
  const hasFix = fix !== null &&
    isValidMapCoordinate(fix) &&
    validTime(fix.receivedAtMs, nowMs);
  const ageSeconds = hasFix
    ? Math.max(0, Math.floor((nowMs - fix.receivedAtMs) / 1_000))
    : null;
  const ageLabel = ageSeconds === null
    ? 'No valid position'
    : ageSeconds < 60 ? ageSeconds + ' s ago'
      : ageSeconds < 3_600 ? Math.floor(ageSeconds / 60) + ' min ago'
        : Math.floor(ageSeconds / 3_600) + ' h ago';
  const freshness = hasFix
    ? getConvoyFreshness(fix.receivedAtMs, nowMs)
    : 'lost';
  const actualGps = gps.nativeSource && !gps.simulated;
  const currentFix = actualGps && gps.tracking && freshness === 'live';
  let state: FieldCapabilityState;
  let title: string;
  let detail: string;
  if (!hasFix) {
    state = 'unavailable';
    title = 'GPS unavailable';
    detail = 'No validated local GPS position. Accuracy and heading are unknown.';
  } else if (freshness === 'stale' || freshness === 'lost') {
    state = 'stale';
    title = 'GPS position stale';
    detail = 'Last-known coordinates only. Do not navigate from this fix.';
  } else if (!currentFix) {
    state = 'degraded';
    title = gps.simulated ? 'Simulated location' : 'GPS not operational';
    detail = !gps.tracking
      ? 'Tracking stopped. The displayed fix is last known.'
      : !actualGps
        ? 'Only an Android GPS source can satisfy field readiness.'
        : 'Position is recent, but not live.';
  } else {
    state = 'connected';
    title = 'GPS current';
    detail = 'Live native GPS fix. Verify surroundings before relying on it.';
  }
  const heading = hasFix && fix.headingDegrees !== null &&
    Number.isFinite(fix.headingDegrees)
    ? ((fix.headingDegrees % 360) + 360) % 360
    : null;
  const accuracy = hasFix && typeof fix.accuracyMeters === 'number' &&
    Number.isFinite(fix.accuracyMeters) && fix.accuracyMeters >= 0
    ? '±' + Math.round(fix.accuracyMeters) + ' m' : 'Unknown';
  return {
    key: 'gps', state, title, detail,
    latitude: hasFix ? fix.latitude.toFixed(5) : '—',
    longitude: hasFix ? fix.longitude.toFixed(5) : '—',
    heading: heading === null ? 'Unknown'
      : compassDirection(heading) + ' · ' + Math.round(heading) + '°',
    accuracy,
    positionAge: ageLabel,
    lastKnown: !currentFix && hasFix,
  };
}

function mapCapability(input: FieldReadinessInput): FieldReadinessModel['maps'] {
  const {dashboard, packCatalog, nowMs} = input;
  const verified = selectRenderableMapPack(packCatalog, null);
  const installed = packCatalog.filter(entry =>
    selectRenderableMapPack([entry], null) !== null,
  ).length;
  const downloading = packCatalog.some(entry =>
    entry.installState === 'installing',
  );
  const damaged = packCatalog.some(entry => entry.installState === 'invalid');
  const remoteAvailable = packCatalog.some(entry =>
    entry.installState === 'not-installed' &&
    entry.manifest.source.kind === 'remote',
  );
  const inventoryLabel = installed + ' verified local pack' +
    (installed === 1 ? '' : 's') + ' / ' + packCatalog.length + ' registered';
  let downloadLabel = 'No downloadable regional pack is registered.';
  if (input.mapPersistenceStatus === 'restoring') {
    downloadLabel = 'Checking saved map-pack inventory…';
  } else if (input.mapPersistenceStatus === 'error') {
    downloadLabel = 'Saved map-pack inventory could not be restored.';
  } else if (downloading) {
    downloadLabel = 'Map-pack installation in progress; check Device.';
  } else if (damaged) {
    downloadLabel = 'An archive failed verification; manage or replace it.';
  } else if (remoteAvailable && input.mapPackInstallSupported) {
    downloadLabel = 'Regional pack available for download in Device.';
  } else if (remoteAvailable) {
    downloadLabel = 'Pack registered; installation is unavailable on this device.';
  } else if (installed > 0) {
    downloadLabel = 'Verified local archive present; manage packs in Device.';
  }

  const evidence = input.imageryEvidence;
  const matchingEvidence = !!verified && !!evidence &&
    dashboard.maps.status !== 'no-tiles' &&
    dashboard.maps.status !== 'no-pack' &&
    evidence.packId === verified.manifest.id &&
    evidence.packVersion === verified.manifest.version &&
    validTime(evidence.observedAtMs, nowMs) &&
    nowMs - evidence.observedAtMs <= 60_000;
  const imagery = matchingEvidence && evidence
    ? evidence.kind : 'not-confirmed';
  const imageryLabel = imagery === 'loaded'
    ? 'Raster image loaded in map view (recently confirmed)'
    : imagery === 'failed'
      ? 'Offline map tile failed to render'
      : 'Offline map imagery NOT confirmed loaded';

  let state: FieldCapabilityState = 'degraded';
  let title = 'Offline maps need checking';
  let detail = 'A verified pack alone does not prove coverage or raster rendering.';
  if (input.mapPersistenceStatus === 'restoring') {
    state = 'degraded';
    title = 'Checking map inventory';
    detail = 'Saved map-pack verification is still in progress.';
  } else if (input.mapPersistenceStatus === 'error') {
    state = 'degraded';
    title = 'Map inventory needs repair';
    detail = 'Map storage could not be restored reliably; verify packs in Device.';
  } else if (!verified) {
    state = 'unavailable';
    title = 'No verified offline map';
    detail = 'Install and verify a real regional map pack before departure.';
  } else if (dashboard.maps.status === 'no-tiles') {
    title = 'Map tile reader unavailable';
    detail = 'Archive is verified, but raster tiles cannot be read.';
  } else if (dashboard.maps.status === 'uncovered') {
    title = 'Trip coverage incomplete';
    detail = 'Required trip points are not all covered by verified packs.';
  } else if (dashboard.maps.status === 'no-route') {
    title = 'Trip coverage not checked';
    detail = 'Select trip points before treating the route as covered.';
  } else if (imagery === 'failed') {
    title = 'Offline imagery failed';
    detail = 'A map image failed to render; do not rely on the basemap.';
  } else if (dashboard.maps.status === 'ready' && imagery === 'loaded') {
    state = 'connected';
    title = 'Offline map checks passed';
    detail = 'Pack coverage and a recent raster image load confirmed. Routing is not guaranteed.';
  } else {
    title = 'Map imagery not confirmed';
    detail = 'Pack/coverage checks do not prove an image appeared on screen.';
  }

  return {
    key: 'maps', state, title, detail,
    imagery, imageryLabel, inventoryLabel, downloadLabel,
  };
}

function convoyCapability(
  dashboard: DriveDashboardModel,
): FieldReadinessModel['convoy'] {
  const convoy = dashboard.convoy;
  const verified = convoy.id !== null &&
    convoy.memberRosterVerified &&
    convoy.verifiedMemberCount !== null &&
    Number.isSafeInteger(convoy.verifiedMemberCount) &&
    convoy.verifiedMemberCount >= 0;
  if (!verified) {
    return {
      key: 'convoy',
      state: convoy.id === null ? 'awaiting-authorisation' : 'degraded',
      title: convoy.id === null
        ? 'Awaiting convoy authorisation'
        : 'Verified roster unavailable',
      detail: convoy.id === null
        ? 'No active authorised convoy. Public MeshCore contacts do not count.'
        : 'Operational convoy selected, but remote membership has not been verified.',
      name: convoy.id === null ? 'No active convoy' : convoy.name,
      remoteCount: null, live: null, recent: null, attention: null,
    };
  }
  const attention = numericCount(convoy.stale) +
    numericCount(convoy.lost) + numericCount(convoy.noPosition);
  const recent = numericCount(convoy.recent);
  const state: FieldCapabilityState = attention > 0
    ? 'stale' : recent > 0 ? 'degraded' : 'connected';
  return {
    key: 'convoy', state,
    title: attention > 0 ? 'Member positions need checking'
      : recent > 0 ? 'Member positions aging' : 'Verified convoy roster',
    detail: 'Verified remote membership only; position reception is not delivery proof.',
    name: convoy.name,
    remoteCount: convoy.verifiedMemberCount,
    live: numericCount(convoy.live),
    recent,
    attention,
  };
}

function relevantAlerts(
  dashboard: DriveDashboardModel,
  nowMs: number,
  authorised: boolean,
): readonly DriveAlert[] {
  if (!authorised || !dashboard.alertsAvailable) {
    return [];
  }
  const priority = (code: BushMeshQuickActionCode) =>
    code === BushMeshQuickActionCode.Stop ||
    code === BushMeshQuickActionCode.Help ? 0 : 1;
  return dashboard.alerts.filter(alert =>
    alert.source === 'radio' &&
    validTime(alert.receivedAtMs, nowMs) &&
    (alert.expiresAtMs === null || alert.expiresAtMs > nowMs),
  ).slice().sort((a, b) =>
    priority(a.action) - priority(b.action) ||
    b.receivedAtMs - a.receivedAtMs,
  ).slice(0, 3);
}

/** Read-only projection. Never confers Security v1 membership or radio authority. */
export function deriveFieldReadiness(input: FieldReadinessInput): FieldReadinessModel {
  const {dashboard} = input;
  const radio = radioCapability(dashboard);
  const gps = gpsCapability(dashboard, input.nowMs);
  const maps = mapCapability(input);
  const convoy = convoyCapability(dashboard);
  const capabilities = [radio, gps, maps, convoy];
  const trip = getTripReadiness({
    radioConnected: radio.state === 'connected',
    radioTransportReady: radio.state === 'connected',
    radioIdentityReady: radio.state === 'connected',
    channelSelected: dashboard.actionAvailability.canTransmit &&
      dashboard.actionAvailability.channelIndex !== null,
    localPositionReady: gps.state === 'connected',
    convoyMembersKnown: convoy.remoteCount !== null,
    offlineMapReady: maps.state === 'connected',
    navigationRequired: true,
  });
  const allChecksReady = capabilities.every(item => item.state === 'connected') &&
    dashboard.actionAvailability.canTransmit &&
    trip.canStartConvoy && trip.canNavigateOffline;
  const moving = typeof input.speedKmh === 'number' &&
    Number.isFinite(input.speedKmh) && input.speedKmh > 5 &&
    gps.state === 'connected';
  const alerts = relevantAlerts(
    dashboard, input.nowMs, convoy.remoteCount !== null,
  );

  return {
    title: allChecksReady ? 'FIELD CHECKS COMPLETE' : 'PRE-TRIP CHECK NEEDED',
    detail: allChecksReady
      ? 'Radio, location, authorised convoy and offline imagery checks passed. Driving safety and route guidance are not guaranteed.'
      : 'Review unavailable, degraded or stale capabilities before departure.',
    allChecksReady,
    capabilities,
    radio, gps, maps, convoy,
    alerts,
    alertsLabel: convoy.remoteCount === null || !dashboard.alertsAvailable
      ? 'Verified convoy alert feed unavailable'
      : alerts.length === 0
        ? 'No current verified convoy alerts'
        : alerts.length + ' verified alert' + (alerts.length === 1 ? '' : 's'),
    traffic: {
      carrierRxLast5Min: numericCount(dashboard.incomingCarrierMessages),
      pending: numericCount(dashboard.outgoingPending),
      failed: numericCount(dashboard.outgoingFailed),
    },
    moving,
    previewAvailable: !moving,
    previewReason: moving
      ? 'Stop in a safe place before using preview controls.'
      : 'LOCAL PREVIEW ONLY. This screen cannot transmit quick actions.',
  };
}
