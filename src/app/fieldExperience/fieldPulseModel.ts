import type {AuthorizedConvoyMembership} from '../activeContext/operationalConvoy';
import type {BushMeshLocationFix} from '../../location/positionPlanner';
import {validateLocationFix} from '../../location/positionPlanner';
import {selectRenderableMapPack} from '../../maps/convoyMapModel';
import type {BushMeshMapPackCatalogEntry} from '../../maps/mapPackCatalog';
import type {LocationSessionStatus} from '../../state/LocationSessionContext';

export type FieldPulseKind = 'radio' | 'gps' | 'maps' | 'convoy';
export type FieldPulseState = 'ready' | 'attention' | 'unavailable';
export type FieldPulseItem = {
  key: FieldPulseKind;
  label: string;
  state: FieldPulseState;
  headline: string;
  detail: string;
};

export type FieldPulseInput = {
  nowMs: number;
  radioConnected: boolean;
  channelSendAvailable: boolean;
  channelName: string | null;
  protocolTransportReady: boolean;
  locationStatus: LocationSessionStatus;
  locationProvider: string | null;
  fix: BushMeshLocationFix | null;
  packCatalog: readonly BushMeshMapPackCatalogEntry[];
  tilesReaderAvailable: boolean;
  mapRestore: 'restoring' | 'ready' | 'unsupported' | 'error';
  requiredTripPoints: number;
  coveredTripPoints: number;
  activeConvoy: AuthorizedConvoyMembership | null;
  convoyStatus: 'checking' | 'ready' | 'error';
};

function safeNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Displays only evidence that existing production providers have actually
 * observed. This is a navigation overview, not an authorisation decision.
 * It never converts carrier contacts, PSKs or raw locations into members.
 */
export function deriveFieldPulse(input: FieldPulseInput): readonly FieldPulseItem[] {
  const radio: FieldPulseItem = !input.radioConnected
    ? {
      key: 'radio', label: 'Radio', state: 'unavailable',
      headline: 'Companion offline',
      detail: 'Connect the MeshCore radio in Device.',
    } : !input.channelSendAvailable || !input.channelName
      ? {
        key: 'radio', label: 'Radio', state: 'attention',
        headline: 'Link only',
        detail: 'Companion connected; channel messaging is not ready.',
      } : !input.protocolTransportReady
        ? {
          key: 'radio', label: 'Radio', state: 'attention',
          headline: 'Carrier ready',
          detail: 'Channel TX available; BushMesh data runtime not ready. Delivery unconfirmed.',
        } : {
          key: 'radio', label: 'Radio', state: 'ready',
          headline: 'Carrier ready',
          detail: input.channelName + ' · peer delivery is never assumed.',
        };

  const fix = input.fix;
  const validFix = fix !== null &&
    validateLocationFix(fix) === null &&
    safeNumber(input.nowMs) &&
    fix.timestampMs <= input.nowMs + 10_000;
  const age = validFix ? Math.max(0, input.nowMs - fix.timestampMs) : null;
  const nativeGps = input.locationProvider === 'Android GPS' &&
    (input.locationStatus === 'tracking' ||
      input.locationStatus === 'tracking-no-link');
  let gps: FieldPulseItem;
  if (age === null) {
    gps = {
      key: 'gps', label: 'GPS', state: 'unavailable',
      headline: 'Fix unavailable',
      detail: 'No validated GPS fix yet.',
    };
  } else if (age > 120_000) {
    gps = {
      key: 'gps', label: 'GPS', state: 'attention',
      headline: 'Last known only',
      detail: Math.floor(age / 1000) + ' s old · not current navigation.',
    };
  } else if (!nativeGps || age > 30_000 ||
    fix!.accuracyMeters == null || fix!.accuracyMeters! > 100) {
    gps = {
      key: 'gps', label: 'GPS', state: 'attention',
      headline: age > 30_000 ? 'Fix aging' : 'GPS needs checking',
      detail: !nativeGps
        ? 'Native Android GPS tracking not active.'
        : 'Check fix age and reported accuracy in Device.',
    };
  } else {
    gps = {
      key: 'gps', label: 'GPS', state: 'ready',
      headline: 'Live GPS',
      detail: Math.floor(age / 1000) + ' s old · ±' +
        Math.round(fix!.accuracyMeters!) + ' m reported.',
    };
  }

  const pack = selectRenderableMapPack(input.packCatalog, null);
  let maps: FieldPulseItem;
  if (input.mapRestore === 'restoring') {
    maps = {
      key: 'maps', label: 'Maps', state: 'attention',
      headline: 'Checking packs',
      detail: 'Verifying restored offline archive records.',
    };
  } else if (input.mapRestore === 'error') {
    maps = {
      key: 'maps', label: 'Maps', state: 'attention',
      headline: 'Pack check failed',
      detail: 'Open Device to verify the local map inventory.',
    };
  } else if (!pack) {
    maps = {
      key: 'maps', label: 'Maps', state: 'unavailable',
      headline: 'Pack needed',
      detail: 'No installed, verified raster archive.',
    };
  } else if (!input.tilesReaderAvailable) {
    maps = {
      key: 'maps', label: 'Maps', state: 'attention',
      headline: 'Reader unavailable',
      detail: 'Archive verified; raster reader is unavailable.',
    };
  } else {
    const countsOk = safeNumber(input.requiredTripPoints) &&
      safeNumber(input.coveredTripPoints) &&
      input.coveredTripPoints <= input.requiredTripPoints;
    const coverage = countsOk && input.requiredTripPoints > 0
      ? input.coveredTripPoints + '/' + input.requiredTripPoints +
        ' trip points covered.'
      : 'Trip coverage not checked.';
    maps = {
      key: 'maps', label: 'Maps', state: 'attention',
      headline: countsOk && input.requiredTripPoints > 0 &&
        input.coveredTripPoints < input.requiredTripPoints
        ? 'Coverage incomplete' : 'Pack verified',
      detail: coverage + ' Actual imagery not confirmed here.',
    };
  }

  const membership = input.activeConvoy;
  const verified = input.convoyStatus === 'ready' &&
    membership?.authorizationState === 'authorized' &&
    membership.verifiedBy === 'security-v1' &&
    !!membership.localIdentityRef && !!membership.membershipRecordRef;
  const convoy: FieldPulseItem = verified ? {
    key: 'convoy', label: 'Convoy', state: 'ready',
    headline: membership!.displayName,
    detail: 'Local membership verified · member positions not supplied.',
  } : input.convoyStatus === 'checking' ? {
    key: 'convoy', label: 'Convoy', state: 'attention',
    headline: 'Checking access',
    detail: 'Restoring and revalidating Security membership.',
  } : {
    key: 'convoy', label: 'Convoy', state: 'unavailable',
    headline: 'No verified convoy',
    detail: input.convoyStatus === 'error'
      ? 'Security directory could not be checked.'
      : 'Invitations and carrier channels do not grant membership.',
  };
  return [radio, gps, maps, convoy];
}
