import {BushMeshQuickActionCode} from '../src/bushmesh/protocol';
import {
  activeOperationalMarkers,
  isOperationalMarkerActive,
  operationalMarkerFromQuickAction,
} from '../src/convoy/operationalMarkers';

describe('operational convoy markers', () => {
  test('creates a map marker for a located hazard', () => {
    const marker = operationalMarkerFromQuickAction({
      id: 'hazard-1',
      senderId: 'AABBCCDDEEFF',
      action: BushMeshQuickActionCode.Hazard,
      latitude: -37.8,
      longitude: 145.2,
      receivedAtMs: 1_000,
      expiresAtMs: 61_000,
    });

    expect(marker).toEqual({
      id: 'hazard-1',
      senderId: 'AABBCCDDEEFF',
      type: 'hazard',
      latitude: -37.8,
      longitude: 145.2,
      createdAtMs: 1_000,
      expiresAtMs: 61_000,
    });
  });

  test('does not invent coordinates for non-located actions', () => {
    expect(
      operationalMarkerFromQuickAction({
        id: 'fuel-1',
        senderId: 'AABBCCDDEEFF',
        action: BushMeshQuickActionCode.Fuel,
        latitude: null,
        longitude: null,
        receivedAtMs: 1_000,
        expiresAtMs: 61_000,
      }),
    ).toBeNull();
  });

  test('status actions do not become map markers even if coordinates exist', () => {
    expect(
      operationalMarkerFromQuickAction({
        id: 'ok-1',
        senderId: 'AABBCCDDEEFF',
        action: BushMeshQuickActionCode.Ok,
        latitude: -37.8,
        longitude: 145.2,
        receivedAtMs: 1_000,
        expiresAtMs: 61_000,
      }),
    ).toBeNull();
  });

  test('expired markers are filtered out', () => {
    const active = operationalMarkerFromQuickAction({
      id: 'active',
      senderId: '001122334455',
      action: BushMeshQuickActionCode.Regroup,
      latitude: -37.8,
      longitude: 145.2,
      receivedAtMs: 1_000,
      expiresAtMs: 20_000,
    });
    const expired = operationalMarkerFromQuickAction({
      id: 'expired',
      senderId: '001122334456',
      action: BushMeshQuickActionCode.Stop,
      latitude: -37.9,
      longitude: 145.3,
      receivedAtMs: 1_000,
      expiresAtMs: 5_000,
    });

    if (!active || !expired) {
      throw new Error('Expected located actions to produce markers.');
    }

    expect(isOperationalMarkerActive(active, 10_000)).toBe(true);
    expect(isOperationalMarkerActive(expired, 10_000)).toBe(false);
    expect(activeOperationalMarkers([active, expired], 10_000)).toEqual([
      active,
    ]);
  });
});
