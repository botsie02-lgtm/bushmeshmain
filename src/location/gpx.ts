import {BushMeshTrackPoint} from './TrackRecorder';

export type BushMeshGpxMetadata = {
  name?: string;
  description?: string;
  creator?: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function validFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function trackPointXml(point: BushMeshTrackPoint): string {
  const attributes = `lat="${point.latitude.toFixed(7)}" lon="${point.longitude.toFixed(7)}"`;
  const children: string[] = [];

  if (validFinite(point.altitudeMeters)) {
    children.push(`<ele>${point.altitudeMeters.toFixed(1)}</ele>`);
  }

  children.push(`<time>${new Date(point.recordedAtMs).toISOString()}</time>`);

  if (validFinite(point.accuracyMeters)) {
    children.push(`<extensions><bushmesh:accuracyMeters>${point.accuracyMeters.toFixed(1)}</bushmesh:accuracyMeters></extensions>`);
  }

  return `<trkpt ${attributes}>${children.join('')}</trkpt>`;
}

export function buildBushMeshTrackGpx(
  points: BushMeshTrackPoint[],
  metadata: BushMeshGpxMetadata = {},
): string {
  if (points.length === 0) {
    throw new Error('Cannot export an empty Bushmesh track.');
  }

  const creator = escapeXml(metadata.creator ?? 'Bushmesh');
  const name = escapeXml(metadata.name ?? 'Bushmesh Track');
  const description = metadata.description
    ? `<desc>${escapeXml(metadata.description)}</desc>`
    : '';
  const createdAtMs = points[0].recordedAtMs;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bushmesh="https://bushmesh.app/gpx/1" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">`,
    '<metadata>',
    `<name>${name}</name>`,
    description,
    `<time>${new Date(createdAtMs).toISOString()}</time>`,
    '</metadata>',
    '<trk>',
    `<name>${name}</name>`,
    '<trkseg>',
    ...points.map(trackPointXml),
    '</trkseg>',
    '</trk>',
    '</gpx>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function defaultBushMeshGpxFilename(
  startedAtMs: number | null,
  nowMs = Date.now(),
): string {
  const timestamp = new Date(startedAtMs ?? nowMs)
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');

  return `Bushmesh_${timestamp}.gpx`;
}
