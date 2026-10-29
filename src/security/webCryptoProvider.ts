import {SecurityError} from './errors';
import type {CryptoProvider, GeneratedKeyPair} from './ports';

interface CryptoKeyPairLike {
  publicKey: unknown;
  privateKey: unknown;
}

interface SubtleCryptoLike {
  generateKey(algorithm: unknown, extractable: boolean, keyUsages: string[]): Promise<unknown>;
  exportKey(format: string, key: unknown): Promise<ArrayBuffer>;
  importKey(
    format: string,
    keyData: ArrayBuffer | Uint8Array,
    algorithm: unknown,
    extractable: boolean,
    keyUsages: string[],
  ): Promise<unknown>;
  sign(algorithm: unknown, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  verify(
    algorithm: unknown,
    key: unknown,
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean>;
  deriveBits(algorithm: unknown, baseKey: unknown, length: number): Promise<ArrayBuffer>;
  digest(algorithm: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  encrypt(algorithm: unknown, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(algorithm: unknown, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
}

export interface WebCryptoLike {
  subtle: SubtleCryptoLike;
  getRandomValues<T extends Uint8Array>(value: T): T;
}

function asKeyPair(value: unknown): CryptoKeyPairLike {
  const pair = value as Partial<CryptoKeyPairLike>;
  if (!pair || !pair.publicKey || !pair.privateKey) {
    throw new SecurityError('AUTHENTICATION_FAILED', 'Platform crypto did not return a key pair');
  }
  return pair as CryptoKeyPairLike;
}

export class WebCryptoProvider implements CryptoProvider {
  constructor(private readonly crypto: WebCryptoLike) {}

  randomBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new SecurityError('INVALID_INPUT', 'Random byte length must be positive');
    }
    return this.crypto.getRandomValues(new Uint8Array(length));
  }

  async sha256(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await this.crypto.subtle.digest('SHA-256', data));
  }

  async hkdfSha256(
    inputKeyMaterial: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number,
  ): Promise<Uint8Array> {
    if (!Number.isSafeInteger(length) || length <= 0 || length > 255 * 32) {
      throw new SecurityError('INVALID_INPUT', 'Invalid HKDF output length');
    }
    const baseKey = await this.crypto.subtle.importKey('raw', inputKeyMaterial, 'HKDF', false, [
      'deriveBits',
    ]);
    const bits = await this.crypto.subtle.deriveBits(
      {name: 'HKDF', hash: 'SHA-256', salt, info},
      baseKey,
      length * 8,
    );
    return new Uint8Array(bits);
  }

  async generateSigningKeyPair(): Promise<GeneratedKeyPair> {
    const pair = asKeyPair(await this.crypto.subtle.generateKey({name: 'Ed25519'}, true, [
      'sign',
      'verify',
    ]));
    return {
      publicKey: new Uint8Array(await this.crypto.subtle.exportKey('raw', pair.publicKey)),
      privateKey: new Uint8Array(await this.crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    };
  }

  async generateAgreementKeyPair(): Promise<GeneratedKeyPair> {
    const pair = asKeyPair(await this.crypto.subtle.generateKey({name: 'X25519'}, true, [
      'deriveBits',
    ]));
    return {
      publicKey: new Uint8Array(await this.crypto.subtle.exportKey('raw', pair.publicKey)),
      privateKey: new Uint8Array(await this.crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    };
  }

  async sign(privateKeyPkcs8: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
    const key = await this.crypto.subtle.importKey(
      'pkcs8',
      privateKeyPkcs8,
      {name: 'Ed25519'},
      false,
      ['sign'],
    );
    return new Uint8Array(await this.crypto.subtle.sign({name: 'Ed25519'}, key, message));
  }

  async verify(
    publicKeyRaw: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean> {
    if (publicKeyRaw.length !== 32 || signature.length !== 64) {
      return false;
    }
    try {
      const key = await this.crypto.subtle.importKey(
        'raw',
        publicKeyRaw,
        {name: 'Ed25519'},
        false,
        ['verify'],
      );
      return await this.crypto.subtle.verify({name: 'Ed25519'}, key, signature, message);
    } catch {
      return false;
    }
  }

  async deriveSharedSecret(
    privateKeyPkcs8: Uint8Array,
    peerPublicKeyRaw: Uint8Array,
  ): Promise<Uint8Array> {
    if (peerPublicKeyRaw.length !== 32) {
      throw new SecurityError('INVALID_INPUT', 'X25519 public key must be 32 bytes');
    }
    const privateKey = await this.crypto.subtle.importKey(
      'pkcs8',
      privateKeyPkcs8,
      {name: 'X25519'},
      false,
      ['deriveBits'],
    );
    const publicKey = await this.crypto.subtle.importKey(
      'raw',
      peerPublicKeyRaw,
      {name: 'X25519'},
      false,
      [],
    );
    return new Uint8Array(
      await this.crypto.subtle.deriveBits({name: 'X25519', public: publicKey}, privateKey, 256),
    );
  }

  async aeadEncrypt(
    keyBytes: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    associatedData: Uint8Array,
  ): Promise<Uint8Array> {
    this.assertAeadInputs(keyBytes, nonce);
    const key = await this.crypto.subtle.importKey('raw', keyBytes, {name: 'AES-GCM'}, false, [
      'encrypt',
    ]);
    return new Uint8Array(
      await this.crypto.subtle.encrypt(
        {name: 'AES-GCM', iv: nonce, additionalData: associatedData, tagLength: 128},
        key,
        plaintext,
      ),
    );
  }

  async aeadDecrypt(
    keyBytes: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
    associatedData: Uint8Array,
  ): Promise<Uint8Array> {
    this.assertAeadInputs(keyBytes, nonce);
    if (ciphertext.length < 16) {
      throw new SecurityError('INVALID_INPUT', 'AES-GCM ciphertext is shorter than its tag');
    }
    try {
      const key = await this.crypto.subtle.importKey('raw', keyBytes, {name: 'AES-GCM'}, false, [
        'decrypt',
      ]);
      return new Uint8Array(
        await this.crypto.subtle.decrypt(
          {name: 'AES-GCM', iv: nonce, additionalData: associatedData, tagLength: 128},
          key,
          ciphertext,
        ),
      );
    } catch (error) {
      if (error instanceof SecurityError) {
        throw error;
      }
      throw new SecurityError('AUTHENTICATION_FAILED', 'Ciphertext authentication failed');
    }
  }

  private assertAeadInputs(key: Uint8Array, nonce: Uint8Array): void {
    if (key.length !== 32) {
      throw new SecurityError('INVALID_INPUT', 'AES-256-GCM key must be 32 bytes');
    }
    if (nonce.length !== 12) {
      throw new SecurityError('INVALID_INPUT', 'AES-GCM nonce must be 12 bytes');
    }
  }
}
