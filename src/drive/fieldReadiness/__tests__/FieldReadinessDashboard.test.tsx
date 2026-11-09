import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import type {
  FieldCapability,
  FieldReadinessModel,
} from '../fieldReadinessModel';
import {FieldReadinessDashboard} from '../FieldReadinessDashboard';
import {BushMeshQuickActionCode} from '../../../bushmesh/legacyProtocol';
import type {DriveAlert} from '../../../state/DriveContext';

function capability(key: FieldCapability['key']): FieldCapability {
  return {
    key, state: 'unavailable',
    title: key + ' unavailable',
    detail: 'Check before departure.',
  };
}

function model(): FieldReadinessModel {
  const radio = capability('radio');
  const gps = {
    ...capability('gps'),
    latitude: '—', longitude: '—',
    heading: 'Unknown', accuracy: 'Unknown', positionAge: 'No valid position',
    lastKnown: false,
  };
  const maps = {
    ...capability('maps'),
    imagery: 'not-confirmed' as const,
    imageryLabel: 'Offline map imagery NOT confirmed loaded',
    inventoryLabel: '0 verified local packs / 0 registered',
    downloadLabel: 'No downloadable regional pack is registered.',
  };
  const convoy = {
    ...capability('convoy'),
    state: 'awaiting-authorisation' as const,
    name: 'No active convoy',
    remoteCount: null, live: null, recent: null, attention: null,
  };
  return {
    title: 'PRE-TRIP CHECK NEEDED',
    detail: 'Review before departure.',
    allChecksReady: false,
    capabilities: [radio, gps, maps, convoy],
    radio, gps, maps, convoy,
    alerts: [],
    alertsLabel: 'Verified convoy alert feed unavailable',
    traffic: {carrierRxLast5Min: 5, pending: 2, failed: 1},
    moving: false,
    previewAvailable: true,
    previewReason: 'LOCAL PREVIEW ONLY. This screen cannot transmit quick actions.',
  };
}

function makeProps(current = model()) {
  return {
    model: current,
    onOpenMap: jest.fn(),
    onManageMapPacks: jest.fn(),
    onOpenConvoy: jest.fn(),
    onOpenRadio: jest.fn(),
    onOpenGpsSettings: jest.fn(),
  };
}

function press(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const node = renderer.root.findAllByProps({accessibilityLabel: label})
    .find(item => typeof item.props.onPress === 'function');
  if (!node) throw new Error('No action named ' + label);
  node.props.onPress();
}

describe('FieldReadinessDashboard safety UX', () => {
  test('empty state displays no made-up location, member or offline imagery', async () => {
    const props = makeProps();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<FieldReadinessDashboard {...props} />);
    });
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('PRE-TRIP CHECK NEEDED');
    expect(text).toContain('No active convoy');
    expect(text).toContain('Verified convoy alert feed unavailable');
    expect(text).toContain('Offline map imagery NOT confirmed loaded');
    expect(text).toContain('CARRIER RX / 5 MIN');
    expect(text).toContain('NOT confirmed loaded');
    expect(text).not.toContain('RADIO ACCEPTED');
    await act(async () => {renderer.unmount();});
  });

  test('map and map-pack buttons call real host navigation callbacks', async () => {
    const props = makeProps();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<FieldReadinessDashboard {...props} />);
    });
    await act(async () => {
      press(renderer, 'Open ConvoyMap');
      press(renderer, 'Manage offline map packs');
      press(renderer, 'GPS details');
      press(renderer, 'Convoy selection');
      press(renderer, 'Radio messages');
    });
    expect(props.onOpenMap).toHaveBeenCalledTimes(1);
    expect(props.onManageMapPacks).toHaveBeenCalledTimes(1);
    expect(props.onOpenGpsSettings).toHaveBeenCalledTimes(1);
    expect(props.onOpenConvoy).toHaveBeenCalledTimes(1);
    expect(props.onOpenRadio).toHaveBeenCalledTimes(1);
    await act(async () => {renderer.unmount();});
  });

  test('STOP and HELP require confirmation even when no convoy is authorised', async () => {
    const props = makeProps();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<FieldReadinessDashboard {...props} />);
    });
    await act(async () => {press(renderer, 'Preview STOP');});
    expect(JSON.stringify(renderer.toJSON())).toContain('Preview STOP?');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('NOT TRANSMITTED.');
    await act(async () => {press(renderer, 'Cancel preview');});
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Preview STOP?');
    await act(async () => {press(renderer, 'Preview HELP');});
    await act(async () => {press(renderer, 'Confirm local HELP preview');});
    expect(JSON.stringify(renderer.toJSON())).toContain('LOCAL PREVIEW — HELP');
    expect(JSON.stringify(renderer.toJSON())).toContain('NOT TRANSMITTED');
    await act(async () => {renderer.unmount();});
  });

  test('HAZARD and REGROUP only show local previews without radio actions', async () => {
    const props = makeProps();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<FieldReadinessDashboard {...props} />);
    });
    for (const label of ['HAZARD', 'REGROUP']) {
      await act(async () => {press(renderer, 'Preview ' + label);});
      expect(JSON.stringify(renderer.toJSON())).toContain(
        'LOCAL PREVIEW — ' + label,
      );
      expect(JSON.stringify(renderer.toJSON())).toContain('NOT TRANSMITTED');
      await act(async () => {press(renderer, 'Close preview');});
    }
    await act(async () => {renderer.unmount();});
  });

  test('revoked membership clears pending critical confirmation', async () => {
    const before = model();
    before.convoy.name = 'Previously authorised group';
    before.convoy.remoteCount = 2;
    const props = makeProps(before);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<FieldReadinessDashboard {...props} />);
    });
    await act(async () => {press(renderer, 'Preview STOP');});
    expect(JSON.stringify(renderer.toJSON())).toContain('Preview STOP?');
    const after = model();
    await act(async () => {
      renderer.update(<FieldReadinessDashboard {...props} model={after} />);
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Preview STOP?');
    await act(async () => {renderer.unmount();});
  });

  test('moving driver cannot open complex pack controls or previews', async () => {
    const active = model();
    active.moving = true;
    active.previewAvailable = false;
    active.previewReason = 'Stop in a safe place before using preview controls.';
    const props = makeProps(active);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<FieldReadinessDashboard {...props} />);
    });
    const controls = renderer.root.findAllByProps({
      accessibilityLabel: 'Preview STOP',
    }).filter(node => typeof node.props.onPress === 'function');
    expect(controls[0].props.disabled).toBe(true);
    await act(async () => {press(renderer, 'Preview STOP');});
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Preview STOP?');
    const packButton = renderer.root.findAllByProps({
      accessibilityLabel: 'Manage offline map packs',
    }).find(node => typeof node.props.onPress === 'function');
    expect(packButton?.props.disabled).toBe(true);
    expect(props.onManageMapPacks).not.toHaveBeenCalled();
    await act(async () => {renderer.unmount();});
  });

  test('critical verified STOP alert renders as large readable card', async () => {
    const current = model();
    const alert: DriveAlert = {
      id: 'verified-alert',
      senderId: 'VERIFIED-PEER',
      action: BushMeshQuickActionCode.Stop,
      label: 'STOP', description: 'Stop when it is safe.',
      channelIndex: 1, latitude: null, longitude: null,
      receivedAtMs: 1_800_000_000_000,
      packetTimestampSeconds: 1_800_000_000,
      expiresAtMs: 1_800_000_120_000,
      snrDb: null, pathLength: null, source: 'radio',
    };
    current.alerts = [alert];
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <FieldReadinessDashboard {...makeProps(current)} />,
      );
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('VERIFIED-PEER');
    expect(JSON.stringify(renderer.toJSON())).toContain('Stop when it is safe');
    const button = renderer.root.findAllByProps({
      accessibilityLabel: 'Open ConvoyMap',
    }).find(node => typeof node.props.onPress === 'function');
    const preview = renderer.root.findAllByProps({
      accessibilityLabel: 'Preview STOP',
    }).find(node => typeof node.props.onPress === 'function');
    expect(StyleSheet.flatten(button!.props.style).minHeight).toBeGreaterThanOrEqual(56);
    expect(StyleSheet.flatten(preview!.props.style).minHeight).toBeGreaterThanOrEqual(96);
    await act(async () => {renderer.unmount();});
  });
});
