import {ConvoyFormationSnapshot} from '../convoy/formation';
import {ConvoyGapState} from '../convoy/gapMonitor';
import {BushMeshGeoJsonPosition} from './operationalPictureGeoJson';

export type FormationLinkProperties = {
  id: string;
  aheadId: string;
  aheadLabel: string;
  behindId: string;
  behindLabel: string;
  gapState: Extract<ConvoyGapState, 'good' | 'caution' | 'critical'>;
  distanceMeters: number;
  cautionGapMeters: number;
  criticalGapMeters: number;
  configuredOrder: true;
};

export type FormationLinkFeature = {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'LineString';
    coordinates: [BushMeshGeoJsonPosition, BushMeshGeoJsonPosition];
  };
  properties: FormationLinkProperties;
};

export type FormationLinkFeatureCollection = {
  type: 'FeatureCollection';
  features: FormationLinkFeature[];
};

/**
 * Renders only adjacent links from the driver's explicit formation order.
 * Missing, stale and lost positions intentionally produce no line: a renderer
 * must not connect old coordinates and make the formation look current.
 */
export function formationSnapshotToGeoJson(
  snapshot: ConvoyFormationSnapshot,
  cautionGapMeters: number,
  criticalGapMeters: number,
): FormationLinkFeatureCollection {
  const byId = new Map(snapshot.members.map(member => [member.id, member]));
  const features: FormationLinkFeature[] = [];

  snapshot.members.forEach(behind => {
    const ahead = behind.aheadId ? byId.get(behind.aheadId) ?? null : null;
    const gap = behind.gapToAhead;
    if (
      !ahead ||
      !ahead.position ||
      !behind.position ||
      !gap ||
      gap.distanceMeters === null ||
      (gap.state !== 'good' &&
        gap.state !== 'caution' &&
        gap.state !== 'critical')
    ) {
      return;
    }

    const id = `formation:${ahead.id}->${behind.id}`;
    features.push({
      type: 'Feature',
      id,
      geometry: {
        type: 'LineString',
        coordinates: [
          [ahead.position.longitude, ahead.position.latitude],
          [behind.position.longitude, behind.position.latitude],
        ],
      },
      properties: {
        id,
        aheadId: ahead.id,
        aheadLabel: ahead.label,
        behindId: behind.id,
        behindLabel: behind.label,
        gapState: gap.state,
        distanceMeters: gap.distanceMeters,
        cautionGapMeters,
        criticalGapMeters,
        configuredOrder: true,
      },
    });
  });

  return {type: 'FeatureCollection', features};
}
