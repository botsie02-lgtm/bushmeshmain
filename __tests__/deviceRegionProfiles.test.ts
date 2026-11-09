import {
  MESHCORE_DOCUMENTED_EXAMPLE,
  assertReadBackMatches,
  compareRadioProfiles,
  parseMeshCoreRegionCatalog,
  proposeRegionProfile,
  readCompleteDeviceProfile,
  validateProposedProfile,
} from '../src/device/regionProfiles';
import {MeshCoreSelfInfo} from '../src/meshcore/meshcoreSelfInfo';

const selfInfo: MeshCoreSelfInfo = {
  advertisementType: 0,
  publicKeyHex: 'AB'.repeat(32),
  bushMeshIdentityRef: 'ABABABABABAB',
  latitude: null,
  longitude: null,
  deviceName: 'Heltec',
  frequencyMhz: 915.8,
  bandwidthKhz: 250,
  spreadingFactor: 10,
  codingRate: 5,
  txPower: 20,
  maxTxPower: 22,
};

const entry = {
  title: 'Australia (Narrow)',
  frequency: '916.575',
  bandwidth: '62.5',
  spreading_factor: '7',
  coding_rate: '7',
  description: 'Australia Narrow source example',
};
const makePayload = (entries: unknown[]) => ({
  config: {suggested_radio_settings: {info_message: 'community', entries}},
});

describe('versioned MeshCore region profiles', () => {
  it('parses the structured API fields and stores source/revision metadata', () => {
    const catalog = parseMeshCoreRegionCatalog(makePayload([entry]), '2026-11-09T00:00:00Z');
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.source).toBe('meshcore-api');
    expect(catalog.profiles[0].settings).toEqual({
      frequencyMhz: 916.575,
      bandwidthKhz: 62.5,
      spreadingFactor: 7,
      codingRate: 7,
    });
    expect(catalog.profiles[0].sourceRevision).toBe(catalog.revision);
    expect(catalog.profiles[0].txPolicy).toBe('retain-verified-device-power');
    expect(catalog.profiles[0].pathHashSize).toBeNull();
    expect(catalog.revision).toBe(
      parseMeshCoreRegionCatalog(makePayload([entry]), '2026-11-10T00:00:00Z').revision,
    );
    expect(parseMeshCoreRegionCatalog(makePayload([
      {...entry, coding_rate: '8'},
    ]), '2026-11-09T00:00:00Z').revision).not.toBe(catalog.revision);
  });

  it('skips invalid and incomplete entries rather than guessing missing RF values', () => {
    const catalog = parseMeshCoreRegionCatalog(makePayload([
      {...entry, title: 'Broken', bandwidth: null},
      entry,
      {...entry, title: 'Repeat', network_settings: {path_hash_size: 2}},
      {...entry, title: 'Repeat', network_settings: {path_hash_size: 4}},
      {...entry, title: 'Out of band', frequency: '9999'},
      {...entry, title: 'Bad SF', spreading_factor: '7.5'},
    ]), '2026-11-09T00:00:00Z');
    expect(catalog.profiles).toHaveLength(2);
    expect(catalog.profiles[1].pathHashSize).toBe(2);
    expect(catalog.rejectedEntries).toBe(4);
    expect(() => parseMeshCoreRegionCatalog(makePayload([
      {...entry, bandwidth: undefined},
    ]), '2026-11-09T00:00:00Z')).toThrow(/no valid complete/i);
    expect(() => parseMeshCoreRegionCatalog({}, '2026-11-09T00:00:00Z'))
      .toThrow(/suggested_radio_settings/i);
  });

  it('retains the node TX value, compares all five parameters and verifies read-back', () => {
    const preset = MESHCORE_DOCUMENTED_EXAMPLE.profiles[0];
    const proposal = proposeRegionProfile(preset, selfInfo);
    expect(proposal).toEqual({
      frequencyMhz: 916.575, bandwidthKhz: 62.5,
      spreadingFactor: 7, codingRate: 7, txPowerDbm: 20,
    });
    expect(compareRadioProfiles(readCompleteDeviceProfile(selfInfo), proposal))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({label: 'TX power', changed: false}),
        expect.objectContaining({label: 'Frequency', changed: true}),
      ]));
    expect(() => assertReadBackMatches(proposal, {
      ...selfInfo, frequencyMhz: 916.575, bandwidthKhz: 62.5,
      spreadingFactor: 7, codingRate: 7,
    })).not.toThrow();
    expect(() => assertReadBackMatches(proposal, {...selfInfo, txPower: 19}))
      .toThrow(/mismatch/i);
    expect(() => assertReadBackMatches(proposal, {...selfInfo, txPower: 20}))
      .toThrow(/mismatch/i);
  });

  it('rejects manual TX beyond node capability and invalid decimal precision', () => {
    const valid = proposeRegionProfile(MESHCORE_DOCUMENTED_EXAMPLE.profiles[0], selfInfo);
    expect(() => validateProposedProfile({...valid, txPowerDbm: 23}, 22))
      .toThrow(/advertised maximum/i);
    expect(() => validateProposedProfile({...valid, frequencyMhz: 916.5751}, 22))
      .toThrow(/three decimal places/i);
    expect(() => validateProposedProfile({...valid, codingRate: 10}, 22))
      .toThrow(/Coding rate/i);
    expect(() => readCompleteDeviceProfile({...selfInfo, bandwidthKhz: null}))
      .toThrow(/complete SELF_INFO/i);
  });
});
