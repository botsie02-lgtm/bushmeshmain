import {Buffer} from 'buffer';
import {encodeFields, fromBase64Url, toBase64Url, u32be, utf8} from '../src/security/bytes';
import {identityFingerprintPayload} from '../src/security/transcripts';
import type {DeviceIdentity} from '../src/security/types';
import {createSecurityNode} from './securityTestHelpers';

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex');
}

function unhex(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

describe('security v1 deterministic interoperability vectors', () => {
  test('identity fingerprint vector is stable', async () => {
    const {crypto} = createSecurityNode();
    const identity: Omit<DeviceIdentity, 'fingerprint'> = {
      identityVersion: 1,
      deviceId: 'bm1_test-device',
      signingPublicKey: toBase64Url(Uint8Array.from({length: 32}, (_, i) => i)),
      agreementPublicKey: toBase64Url(Uint8Array.from({length: 32}, (_, i) => i + 32)),
      keyEpoch: 1,
      createdAt: 0,
    };
    const digest = await crypto.sha256(identityFingerprintPayload(identity));
    expect(toBase64Url(digest)).toBe('Fqr_J4PVy8cnYEq6xn24wxg91i2v8vnBSQ3-ze0xWFA');
  });

  test('RFC 5869 HKDF-SHA-256 test case 1', async () => {
    const {crypto} = createSecurityNode();
    const okm = await crypto.hkdfSha256(
      new Uint8Array(22).fill(0x0b),
      unhex('000102030405060708090a0b0c'),
      unhex('f0f1f2f3f4f5f6f7f8f9'),
      42,
    );
    expect(hex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  test('NIST AES-256-GCM zero vector', async () => {
    const {crypto} = createSecurityNode();
    const ciphertext = await crypto.aeadEncrypt(
      new Uint8Array(32),
      new Uint8Array(12),
      new Uint8Array(16),
      new Uint8Array(),
    );
    expect(hex(ciphertext)).toBe(
      'cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919',
    );
  });

  test('RFC 8032 Ed25519 test vector 1', async () => {
    const {crypto} = createSecurityNode();
    const seed = unhex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
    const pkcs8Prefix = unhex('302e020100300506032b657004220420');
    const privateKey = new Uint8Array(pkcs8Prefix.length + seed.length);
    privateKey.set(pkcs8Prefix);
    privateKey.set(seed, pkcs8Prefix.length);
    const publicKey = unhex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
    const signature = await crypto.sign(privateKey, new Uint8Array());
    expect(hex(signature)).toBe(
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
        '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
    );
    expect(await crypto.verify(publicKey, new Uint8Array(), signature)).toBe(true);
  });

  test('field encoding is unambiguous', () => {
    expect(hex(encodeFields('d', [utf8('ab'), utf8('c')]))).not.toBe(
      hex(encodeFields('d', [utf8('a'), utf8('bc')])),
    );
    expect(hex(u32be(1))).toBe('00000001');
    expect(fromBase64Url(toBase64Url(new Uint8Array([1, 2, 3])))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});
