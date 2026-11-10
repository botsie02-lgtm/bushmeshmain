import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {Image, Text} from 'react-native';

import {ConvoyMap, ConvoyMapTileSource} from '../src/maps/ConvoyMap';
import {BushMeshMapPackCatalogEntry} from '../src/maps/mapPackCatalog';
import {worldPixel} from '../src/maps/convoyMapModel';

const now = 1_800_000_000_000;
const self = {latitude: -37.5, longitude: 146.1, receivedAtMs: now - 2_000, headingDegrees: 20};
const member = {
  id: 'authorised-lead',
  label: 'Lead',
  position: {...self, longitude: 146.101, receivedAtMs: now - 200_000},
};

function readyPack(): BushMeshMapPackCatalogEntry {
  return {
    manifest: {
      schemaVersion: 1,
      id: 'regional-pack',
      name: 'Regional',
      version: 'v1',
      bounds: {south: -39, west: 145, north: -36, east: 148},
      format: 'pmtiles',
      minZoom: 4,
      maxZoom: 14,
      tileSize: 256,
      expectedBytes: 64,
      sha256: 'f'.repeat(64),
      source: {kind: 'remote', url: 'https://example.test/region.pmtiles'},
    },
    artifact: {
      packId: 'regional-pack',
      manifestVersion: 'v1',
      format: 'pmtiles',
      localUri: 'file:///app/private/region.pmtiles',
      bytes: 64,
      sha256: 'f'.repeat(64),
      verifiedAtMs: now,
    },
    installState: 'ready',
    lastError: null,
  };
}

describe('ConvoyMap component', () => {
  it('does not leak members without an active convoy context', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ConvoyMap activeConvoyId={null} authorisedMembers={[member]}
          selfFix={self} packCatalog={[]} nowMs={now} />,
      );
    });
    const snapshot = JSON.stringify(tree!.toJSON());
    expect(snapshot).not.toContain('authorised-lead');
    expect(snapshot).not.toContain('Lead');
    expect(snapshot).toContain('NO ACTIVE CONVOY');
    expect(snapshot).toContain('NO VERIFIED OFFLINE PACK');
    await act(async () => tree!.unmount());
  });

  it('displays age and last-known warnings for authorised members', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ConvoyMap activeConvoyId="convoy-one" authorisedMembers={[member]}
          selfFix={self} packCatalog={[]} nowMs={now} />,
      );
    });
    const snapshot = JSON.stringify(tree!.toJSON());
    expect(snapshot).toContain('Lead');
    expect(snapshot).toContain('LAST KNOWN');
    expect(snapshot).toContain('1 AUTHORISED MEMBERS');
    await act(async () => tree!.unmount());
  });

  it('rejects remote tile URIs even from an injected tile source', async () => {
    const readTile = jest.fn(async () => 'https://example.test/tiles/12/3.png');
    const tileSource: ConvoyMapTileSource = {
      isAvailable: () => true,
      readTile,
    };
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ConvoyMap activeConvoyId="convoy-one" authorisedMembers={[]}
          selfFix={self} packCatalog={[readyPack()]}
          tileSource={tileSource} nowMs={now} />,
      );
    });
    expect(readTile).toHaveBeenCalled();
    expect(tree!.root.findAllByType(Image)).toHaveLength(0);
    expect(JSON.stringify(tree!.toJSON())).toContain('LOCAL TILES UNAVAILABLE');
    await act(async () => tree!.unmount());
  });

  it('accepts local raster tile URIs and reports loaded imagery', async () => {
    const tileSource: ConvoyMapTileSource = {
      isAvailable: () => true,
      readTile: async () => 'file:///app/private/tiles/sample.png',
    };
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ConvoyMap activeConvoyId="convoy-one" authorisedMembers={[]}
          selfFix={self} packCatalog={[readyPack()]}
          tileSource={tileSource} nowMs={now} />,
      );
    });
    const images = tree!.root.findAllByType(Image);
    expect(images.length).toBeGreaterThan(0);
    await act(async () => {
      images.forEach(image => image.props.onLoad());
    });
    expect(JSON.stringify(tree!.toJSON())).toContain('OFFLINE BASEMAP READY');
    await act(async () => tree!.unmount());
  });
});

describe('offline map pack viewing without a GPS fix', () => {
  it('can jump to a verified pack without plotting unverified contacts', async () => {
    const tileSource: ConvoyMapTileSource = {
      isAvailable: () => true,
      readTile: async () => 'file:///app/private/tiles/genuine-test.png',
    };
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ConvoyMap activeConvoyId={null} authorisedMembers={[member]}
          selfFix={null} packCatalog={[readyPack()]} nowMs={now}
          tileSource={tileSource} />,
      );
    });
    expect(JSON.stringify(tree!.toJSON())).toContain('TAP VIEW PACK OR START GPS');
    const pressable = tree!.root.findAll(node =>
      typeof node.props.onPress === 'function' &&
      node.findAllByType(Text).some(child => child.props.children === 'VIEW PACK'),
    )[0];
    expect(pressable).toBeDefined();
    await act(async () => {
      pressable.props.onPress();
    });
    expect(tree!.root.findAllByType(Image).length).toBeGreaterThan(0);
    expect(JSON.stringify(tree!.toJSON())).not.toContain('authorised-lead');
    await act(async () => tree!.unmount());
  });
});


it('loads verified Melbourne pack tiles using VIEW PACK without GPS or convoy authority', async () => {
  const original = readyPack();
  const digest = '2801b85fff3eb42dca50179a6c729a523ae239258112cfe96f2ca7201689fb70';
  const melbourne: BushMeshMapPackCatalogEntry = {
    ...original,
    manifest: {
      ...original.manifest,
      id: 'melbourne-cbd-osm-roads-v1',
      name: 'Melbourne CBD - real OSM roads',
      version: 'bbbike-20261109',
      bounds: {south: -37.84, west: 144.94, north: -37.78, east: 145.02},
      minZoom: 12,
      maxZoom: 15,
      format: 'mbtiles',
      expectedBytes: 1331200,
      sha256: digest,
      source: {kind: 'import', displayName: 'melbourne-cbd-roads.mbtiles'},
    },
    artifact: {
      ...original.artifact!,
      packId: 'melbourne-cbd-osm-roads-v1',
      manifestVersion: 'bbbike-20261109',
      format: 'mbtiles',
      bytes: 1331200,
      sha256: digest,
    },
  };
  const readTile = jest.fn<ReturnType<ConvoyMapTileSource['readTile']>,
    Parameters<ConvoyMapTileSource['readTile']>>(async () =>
      'file:///app/private/map-tiles/example.png');
  const tileSource: ConvoyMapTileSource = {isAvailable: () => true, readTile};
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <ConvoyMap activeConvoyId={null} authorisedMembers={[member]}
        selfFix={null} packCatalog={[melbourne]}
        tileSource={tileSource} nowMs={now} />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('TAP VIEW PACK OR START GPS');
  const press = tree.root.findAll(node =>
    typeof node.props.onPress === 'function' &&
    node.findAllByType(Text).some(child => child.props.children === 'VIEW PACK'),
  )[0];
  expect(press).toBeDefined();
  await act(async () => {
    press.props.onPress();
  });
  expect(readTile).toHaveBeenCalled();
  const centerPixel = worldPixel({latitude: -37.81, longitude: 144.98}, 13);
  expect(readTile.mock.calls.some(([tile]) =>
    tile.pack.manifest.id === melbourne.manifest.id &&
    tile.z === 13 &&
    tile.x === Math.floor(centerPixel.x / 256) &&
    tile.y === Math.floor(centerPixel.y / 256),
  )).toBe(true);
  expect(tree.root.findAllByType(Image).length).toBeGreaterThan(0);
  // This simulates Image.onLoad; only physical testing can confirm real pixels.
  await act(async () => {
    tree.root.findAllByType(Image).forEach(image => image.props.onLoad());
  });
  expect(JSON.stringify(tree.toJSON())).toContain('OFFLINE BASEMAP READY');
  expect(JSON.stringify(tree.toJSON())).not.toContain('authorised-lead');
  await act(async () => tree.unmount());
});
