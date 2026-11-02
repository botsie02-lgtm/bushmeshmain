import {
  OperationalPicture,
  OperationalPicturePoint,
  OperationalPicturePolyline,
} from './operationalPicture';

export type BushMeshGeoJsonPosition = [number, number];

export type BushMeshPointProperties = {
  id: string;
  kind: OperationalPicturePoint['kind'];
  label: string;
  status: OperationalPicturePoint['status'];
  targeted: boolean;
  sourceId: string | null;
  markerType: OperationalPicturePoint['markerType'];
  simulated: boolean;
};

export type BushMeshLineProperties = {
  id: string;
  kind: OperationalPicturePolyline['kind'];
  vehicleId: string | null;
  targeted: boolean;
};

export type BushMeshPointFeature = {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'Point';
    coordinates: BushMeshGeoJsonPosition;
  };
  properties: BushMeshPointProperties;
};

export type BushMeshLineFeature = {
  type: 'Feature';
  id: string;
  geometry: {
    type: 'LineString';
    coordinates: BushMeshGeoJsonPosition[];
  };
  properties: BushMeshLineProperties;
};

export type BushMeshPointFeatureCollection = {
  type: 'FeatureCollection';
  features: BushMeshPointFeature[];
};

export type BushMeshLineFeatureCollection = {
  type: 'FeatureCollection';
  features: BushMeshLineFeature[];
};

export type BushMeshMapGeoJson = {
  points: BushMeshPointFeatureCollection;
  lines: BushMeshLineFeatureCollection;
};

function pointFeature(point: OperationalPicturePoint): BushMeshPointFeature {
  return {
    type: 'Feature',
    id: point.id,
    geometry: {
      type: 'Point',
      // GeoJSON is longitude, latitude — deliberately opposite to most of our
      // domain coordinate objects.
      coordinates: [point.longitude, point.latitude],
    },
    properties: {
      id: point.id,
      kind: point.kind,
      label: point.label,
      status: point.status,
      targeted: point.targeted,
      sourceId: point.sourceId,
      markerType: point.markerType,
      simulated: point.simulated,
    },
  };
}

function lineFeature(line: OperationalPicturePolyline): BushMeshLineFeature {
  return {
    type: 'Feature',
    id: line.id,
    geometry: {
      type: 'LineString',
      coordinates: line.points.map(point => [point.longitude, point.latitude]),
    },
    properties: {
      id: line.id,
      kind: line.kind,
      vehicleId: line.vehicleId,
      targeted: line.targeted,
    },
  };
}

/**
 * Thin rendering boundary for MapLibre (or another GeoJSON renderer).
 *
 * Bushmesh freshness, target selection and safety semantics remain in the
 * operational-picture domain. The map renderer only receives geometry plus
 * simple style/filter properties and therefore cannot accidentally reinterpret
 * a stale vehicle as live.
 */
export function operationalPictureToGeoJson(
  picture: OperationalPicture,
): BushMeshMapGeoJson {
  return {
    points: {
      type: 'FeatureCollection',
      features: picture.points.map(pointFeature),
    },
    lines: {
      type: 'FeatureCollection',
      features: picture.polylines
        .filter(line => line.points.length >= 2)
        .map(lineFeature),
    },
  };
}
