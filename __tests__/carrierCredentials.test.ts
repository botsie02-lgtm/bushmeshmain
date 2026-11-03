import {
  buildCarrierCredentialDetails,
  MESHCORE_CARRIER_PSK_DISTINCTION,
  normalizeCarrierPskHex,
} from '../src/convoy/carrierCredentials';

const activeCarrier = {
  convoyId: '0123456789ABCDEF',
  convoyName: 'Hardware Test Convoy',
  channelName: 'BM Hardware Test',
  channelIndex: 3,
};

describe('advanced carrier credentials', () => {
  it('normalizes the exact 16-byte MeshCore PSK as 32 hexadecimal characters without text conversion', () => {
    expect(normalizeCarrierPskHex('7a31d82c41e90f55b2a44c9f01786e33')).toBe(
      '7A31D82C41E90F55B2A44C9F01786E33',
    );
    expect(() => normalizeCarrierPskHex('A5'.repeat(15))).toThrow(
      /16 bytes \/ 32 hexadecimal characters/i,
    );
    expect(() => normalizeCarrierPskHex('GG'.repeat(16))).toThrow(
      /16 bytes \/ 32 hexadecimal characters/i,
    );
  });

  it('presents non-secret carrier and RF metadata while keeping the secret out of the details object', () => {
    const details = buildCarrierCredentialDetails(activeCarrier, {
      source: 'meshcore',
      frequencyMhz: 915.5,
      txPower: 20,
      maxTxPower: 22,
      modem: {
        spreadingFactor: 10,
        bandwidthKhz: 250,
        codingRate: 5,
      },
    });

    expect(details).toEqual({
      convoyName: 'Hardware Test Convoy',
      channelName: 'BM Hardware Test',
      channelIndex: 3,
      privacy: 'private',
      secretStatus: 'configured',
      frequency: '915.5 MHz',
      bandwidth: '250 kHz',
      spreadingFactor: 'SF10',
      codingRate: '4/5',
      txPower: '20 dBm',
    });
    expect(Object.keys(details)).not.toContain('secretHex');
  });

  it('makes the Security v1 distinction explicit', () => {
    expect(MESHCORE_CARRIER_PSK_DISTINCTION).toBe(
      'MeshCore carrier PSK — not BushMesh Security v1 group key',
    );
  });
});
