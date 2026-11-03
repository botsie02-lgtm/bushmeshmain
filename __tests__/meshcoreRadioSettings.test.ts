import {Buffer} from 'buffer';

import {
  buildSetRadioParamsCommand,
  buildSetRadioTxPowerCommand,
} from '../src/meshcore/meshcoreCommands';
import {
  repeatModeForRadioWrite,
  validateMeshCoreRadioParams,
  validateMeshCoreTxPower,
  verifyMeshCoreRadioParams,
} from '../src/meshcore/meshcoreRadioSettings';

function decode(value: string): number[] {
  return Array.from(Buffer.from(value, 'base64'));
}

const v9DeviceInfo = {
  firmwareVersion: 9,
  maxContacts: 64,
  maxChannels: 8,
  blePin: null,
  firmwareBuild: 'test',
  model: 'Heltec',
  version: 'test',
  clientRepeat: 1,
  pathHashMode: 0,
};

const selfInfo = {
  advertisementType: 0,
  txPower: 20,
  maxTxPower: 22,
  publicKeyPrefix: 'AABBCCDDEEFF',
  bushMeshIdentityRef: 'AABBCCDDEEFF',
  latitude: null,
  longitude: null,
  frequencyMhz: 916.58,
  bandwidthKhz: 62.5,
  spreadingFactor: 8,
  codingRate: 5,
  deviceName: 'Heltec A',
};

describe('MeshCore radio settings', () => {
  it('encodes 916.580 MHz / 62.5 kHz exactly little-endian with SF, CR and preserved repeat', () => {
    expect(
      decode(
        buildSetRadioParamsCommand(
          {
            frequencyMhz: 916.58,
            bandwidthKhz: 62.5,
            spreadingFactor: 8,
            codingRate: 5,
          },
          1,
        ),
      ),
    ).toEqual([
      0x0b,
      0x64,
      0xfc,
      0x0d,
      0x00, // 916580 uint32 LE
      0x24,
      0xf4,
      0x00,
      0x00, // 62500 uint32 LE
      0x08,
      0x05,
      0x01,
    ]);
  });

  it('uses the legacy 11-byte form before protocol v9 and preserves v9 repeat state', () => {
    expect(
      repeatModeForRadioWrite({...v9DeviceInfo, firmwareVersion: 8, clientRepeat: null}),
    ).toBeNull();
    expect(repeatModeForRadioWrite(v9DeviceInfo)).toBe(1);
    expect(repeatModeForRadioWrite({...v9DeviceInfo, clientRepeat: 0})).toBe(0);

    expect(
      decode(
        buildSetRadioParamsCommand(
          {
            frequencyMhz: 916.58,
            bandwidthKhz: 62.5,
            spreadingFactor: 8,
            codingRate: 5,
          },
          null,
        ),
      ),
    ).toHaveLength(11);
  });

  it('refuses protocol v9+ writes if repeat state was not reported', () => {
    expect(() =>
      repeatModeForRadioWrite({...v9DeviceInfo, clientRepeat: null}),
    ).toThrow(/client-repeat mode/i);
  });

  it('encodes TX power as CMD_SET_RADIO_TX_POWER signed byte', () => {
    expect(decode(buildSetRadioTxPowerCommand(22))).toEqual([0x0c, 0x16]);
    expect(decode(buildSetRadioTxPowerCommand(-9))).toEqual([0x0c, 0xf7]);
  });

  it('rejects malformed and unsupported radio parameters without silently rounding', () => {
    expect(() =>
      validateMeshCoreRadioParams({
        frequencyMhz: Number.NaN,
        bandwidthKhz: 62.5,
        spreadingFactor: 8,
        codingRate: 5,
      }),
    ).toThrow(/finite number/i);
    expect(() =>
      validateMeshCoreRadioParams({
        frequencyMhz: -1,
        bandwidthKhz: 62.5,
        spreadingFactor: 8,
        codingRate: 5,
      }),
    ).toThrow(/cannot be negative/i);
    expect(() =>
      validateMeshCoreRadioParams({
        frequencyMhz: 916.5804,
        bandwidthKhz: 62.5,
        spreadingFactor: 8,
        codingRate: 5,
      }),
    ).toThrow(/three decimal places/i);
    expect(() =>
      validateMeshCoreRadioParams({
        frequencyMhz: 916.58,
        bandwidthKhz: 6.9,
        spreadingFactor: 8,
        codingRate: 5,
      }),
    ).toThrow(/bandwidth must be between/i);
    expect(() =>
      validateMeshCoreRadioParams({
        frequencyMhz: 916.58,
        bandwidthKhz: 62.5,
        spreadingFactor: 13,
        codingRate: 5,
      }),
    ).toThrow(/spreading factor/i);
    expect(() =>
      validateMeshCoreRadioParams({
        frequencyMhz: 916.58,
        bandwidthKhz: 62.5,
        spreadingFactor: 8,
        codingRate: 9,
      }),
    ).toThrow(/coding rate/i);
  });

  it('rejects TX power above the node-advertised maximum instead of clamping', () => {
    expect(() => validateMeshCoreTxPower(23, 22)).toThrow(/advertised maximum/i);
    expect(validateMeshCoreTxPower(22, 22)).toBe(22);
  });

  it('requires exact SELF_INFO read-back for frequency, bandwidth, SF and CR', () => {
    const requested = validateMeshCoreRadioParams({
      frequencyMhz: 916.58,
      bandwidthKhz: 62.5,
      spreadingFactor: 8,
      codingRate: 5,
    });
    expect(() => verifyMeshCoreRadioParams(requested, selfInfo)).not.toThrow();
    expect(() =>
      verifyMeshCoreRadioParams(requested, {...selfInfo, bandwidthKhz: 125}),
    ).toThrow(/read-back mismatch/i);
  });
});
