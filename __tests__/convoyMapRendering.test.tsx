import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {Image, Text} from 'react-native';

import {ConvoyMap, ConvoyMapTileSource} from '../src/maps/ConvoyMap';
import {BushMeshMapPackCatalogEntry} from '../src/maps/mapPackCatalog';

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
    const label = tree!.root.findAllByType(Text).find(node => node.props.children === 'VIEW PACK');
    expect(label).toBeDefined();
    await act(async () => {
      label!.parent!.props.onPress();
    });
    expect(tree!.root.findAllByType(Image).length).toBeGreaterThan(0);
    expect(JSON.stringify(tree!.toJSON())).not.toContain('authorised-lead');
    await act(async () => tree!.unmount());
  });
});
