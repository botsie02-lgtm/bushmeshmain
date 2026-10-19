import {MeshCoreSelfInfo} from '../src/meshcore/meshcoreSelfInfo';
import {meshCoreSelfInfoToRadioProfile} from '../src/radio/meshCoreRadioProfile';

function selfInfo(overrides?: Partial<MeshCoreSelfInfo>): MeshCoreSelfInfo {
  return {
    advertisementType: 1,
    txPower: 20,
    maxTxPower: 22,
    publicKeyHex: '00'.repeat(32).toUpperCase(),
    bushMeshIdentityRef: '000000000000',
    latitude: null,
    longitude: null,
    frequencyMhz: 915.5,
    bandwidthKhz: 125,
    spreadingFactor: 9,
    codingRate: 5,
    deviceName: 'Test radio',
    ...overrides,
  };
}

describe('MeshCore radio profile', () => {
  test('maps valid SELF_INFO modem parameters for airtime estimation', () => {
    expect(meshCoreSelfInfoToRadioProfile(selfInfo())).toEqual({
      source: 'meshcore',
      frequencyMhz: 915.5,
      txPower: 20,
      maxTxPower: 22,
      modem: {
        spreadingFactor: 9,
        bandwidthKhz: 125,
        codingRate: 5,
      },
    });
  });

  test('keeps RF identity data while refusing incomplete modem settings', () => {
    const profile = meshCoreSelfInfoToRadioProfile(
      selfInfo({bandwidthKhz: null}),
    );

    expect(profile.frequencyMhz).toBe(915.5);
    expect(profile.txPower).toBe(20);
    expect(profile.modem).toBeNull();
  });

  test('does not guess unsupported coding rates', () => {
    expect(
      meshCoreSelfInfoToRadioProfile(selfInfo({codingRate: 9})).modem,
    ).toBeNull();
  });
});
