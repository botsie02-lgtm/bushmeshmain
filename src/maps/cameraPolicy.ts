import {Coordinate} from '../convoy/convoy';
import {
  OperationalPicture,
  OperationalPictureBounds,
  operationalBoundsForCoordinates,
} from './operationalPicture';

export type BushMeshMapCameraMode =
  | 'follow-self'
  | 'frame-convoy'
  | 'frame-target'
  | 'free';

export type BushMeshMapCameraDirective = {
  mode: BushMeshMapCameraMode;
  center: Coordinate | null;
  bounds: OperationalPictureBounds | null;
  followUser: boolean;
  targetPointId: string | null;
  zoomHint: number | null;
};

function selfPoint(picture: OperationalPicture) {
  return picture.points.find(point => point.kind === 'self') ?? null;
}

function targetedPoint(picture: OperationalPicture) {
  return picture.points.find(point => point.targeted) ?? null;
}

/**
 * Produces camera intent without depending on MapLibre APIs.
 *
 * The renderer decides how to animate/ease to these values. Domain code only
 * decides what deserves framing, keeping map-library details out of convoy and
 * navigation state.
 */
export function resolveMapCameraDirective(
  picture: OperationalPicture,
  mode: BushMeshMapCameraMode,
): BushMeshMapCameraDirective {
  const self = selfPoint(picture);
  const target = targetedPoint(picture);

  switch (mode) {
    case 'follow-self':
      return {
        mode,
        center: self
          ? {latitude: self.latitude, longitude: self.longitude}
          : picture.focusBounds?.center ?? null,
        bounds: null,
        followUser: self !== null,
        targetPointId: null,
        zoomHint: self ? 14 : null,
      };

    case 'frame-target': {
      if (!target) {
        return resolveMapCameraDirective(picture, 'frame-convoy');
      }

      const coordinates: Coordinate[] = [
        {latitude: target.latitude, longitude: target.longitude},
      ];
      if (self) {
        coordinates.push({latitude: self.latitude, longitude: self.longitude});
      }

      return {
        mode,
        center: operationalBoundsForCoordinates(coordinates)?.center ?? {
          latitude: target.latitude,
          longitude: target.longitude,
        },
        bounds: operationalBoundsForCoordinates(coordinates),
        followUser: false,
        targetPointId: target.id,
        zoomHint: self ? null : 14,
      };
    }

    case 'frame-convoy':
      return {
        mode,
        center: picture.focusBounds?.center ?? null,
        bounds: picture.focusBounds,
        followUser: false,
        targetPointId: target?.id ?? null,
        zoomHint: null,
      };

    case 'free':
      return {
        mode,
        center: null,
        bounds: null,
        followUser: false,
        targetPointId: target?.id ?? null,
        zoomHint: null,
      };
  }
}
