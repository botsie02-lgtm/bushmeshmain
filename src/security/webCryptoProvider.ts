import {toBase64Url, wipe} from './bytes';
import {SecurityError} from './errors';
import type {CryptoProvider, GeneratedKeyPair, SecureSecretStore} from './ports';
import type {PrivateKeyAlgorithm, PrivateKeyHandle, PrivateKeyPurpose} from './types';

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

/**
 * Optional DEVELOPMENT/TEST persistence used only because WebCrypto does not
 * provide a portable persistent private-key alias API. Production providers
 * should not implement this interface; they should keep keys non-exportable.
 */
export interface WebCryptoKeyPersistence {
  savePrivateKey(handle: PrivateKeyHandle, pkcs8: Uint8Array): Promise<void>;
  loadPrivateKey(handle: PrivateKeyHandle): Promise<Uint8Array | null>;
  deletePrivateKey(handle: PrivateKeyHandle): Promise<void>;
}

/** DEVELOPMENT/TEST ONLY: persists exportable PKCS#8 bytes behind SecureSecretStore. */
export class SecretStoreWebCryptoKeyPersistence implements WebCryptoKeyPersistence {
  constructor(
    private readonly secrets: SecureSecretStore,
    private readonly prefix = 'dev/webcrypto-private/',
  ) {}

  async savePrivateKey(handle: PrivateKeyHandle, pkcs8: Uint8Array): Promise<void> {
    await this.secrets.setSecret(this.ref(handle), pkcs8);
  }

  async loadPrivateKey(handle: PrivateKeyHandle): Promise<Uint8Array | null> {
    return this.secrets.getSecret(this.ref(handle));
  }

  async deletePrivateKey(handle: PrivateKeyHandle): Promise<void> {
    await this.secrets.deleteSecret(this.ref(handle));
  }

  private ref(handle: PrivateKeyHandle): string {
    return `${this.prefix}${handle.provider}/${handle.id}`;
  }
}

interface CachedPrivateKey {
  algorithm: PrivateKeyAlgorithm;
  key: unknown;
}

function asKeyPair(value: unknown): CryptoKeyPairLike {
  const pair = value as Partial<CryptoKeyPairLike>;
  if (!pair || !pair.publicKey || !pair.privateKey) {
    throw new SecurityError('AUTHENTICATION_FAILED', 'Platform crypto did not return a key pair');
  }
  return pair as CryptoKeyPairLike;
}

const PROVIDER_ID = 'webcrypto-v1';

export class WebCryptoProvider implements CryptoProvider {
  private readonly privateKeys = new Map<string, CachedPrivateKey>();

  constructor(
    private readonly crypto: WebCryptoLike,
    private readonly persistence?: WebCryptoKeyPersistence,
  ) {}

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

  async generateSigningKeyPair(
    purpose: Extract<PrivateKeyPurpose, 'identity-signing'>,
  ): Promise<GeneratedKeyPair> {
    if (purpose !== 'identity-signing') {
      throw new SecurityError('INVALID_INPUT', 'Invalid signing-key purpose');
    }
    return this.generateKeyPair('Ed25519', purpose, ['sign', 'verify']);
  }

  async generateAgreementKeyPair(
    purpose: Extract<PrivateKeyPurpose, 'identity-agreement' | 'session-ephemeral'>,
  ): Promise<GeneratedKeyPair> {
    return this.generateKeyPair('X25519', purpose, ['deriveBits']);
  }

  async hasPrivateKey(handle: PrivateKeyHandle): Promise<boolean> {
    try {
      await this.resolvePrivateKey(handle);
      return true;
    } catch (error) {
      if (error instanceof SecurityError && error.code === 'KEY_NOT_FOUND') {
        return false;
      }
      throw error;
    }
  }

  async deletePrivateKey(handle: PrivateKeyHandle): Promise<void> {
    this.assertHandle(handle);
    this.privateKeys.delete(handle.id);
    await this.persistence?.deletePrivateKey(handle);
  }

  async sign(handle: PrivateKeyHandle, message: Uint8Array): Promise<Uint8Array> {
    if (handle.algorithm !== 'Ed25519' || handle.purpose !== 'identity-signing') {
      throw new SecurityError('INVALID_INPUT', 'Signing requires an Ed25519 identity-signing handle');
    }
    const key = await this.resolvePrivateKey(handle);
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
    handle: PrivateKeyHandle,
    peerPublicKeyRaw: Uint8Array,
  ): Promise<Uint8Array> {
    if (handle.algorithm !== 'X25519') {
      throw new SecurityError('INVALID_INPUT', 'Key agreement requires an X25519 handle');
    }
    if (peerPublicKeyRaw.length !== 32) {
      throw new SecurityError('INVALID_INPUT', 'X25519 public key must be 32 bytes');
    }
    const privateKey = await this.resolvePrivateKey(handle);
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

  private async generateKeyPair(
    algorithm: PrivateKeyAlgorithm,
    purpose: PrivateKeyPurpose,
    usages: string[],
  ): Promise<GeneratedKeyPair> {
    const pair = asKeyPair(await this.crypto.subtle.generateKey({name: algorithm}, true, usages));
    const handle: PrivateKeyHandle = {
      provider: PROVIDER_ID,
      id: `wck1_${toBase64Url(this.randomBytes(18))}`,
      algorithm,
      purpose,
    };
    this.privateKeys.set(handle.id, {algorithm, key: pair.privateKey});
    if (this.persistence) {
      const exported = new Uint8Array(await this.crypto.subtle.exportKey('pkcs8', pair.privateKey));
      try {
        await this.persistence.savePrivateKey(handle, exported);
      } finally {
        wipe(exported);
      }
    }
    return {
      publicKey: new Uint8Array(await this.crypto.subtle.exportKey('raw', pair.publicKey)),
      privateKeyHandle: handle,
    };
  }

  private async resolvePrivateKey(handle: PrivateKeyHandle): Promise<unknown> {
    this.assertHandle(handle);
    const cached = this.privateKeys.get(handle.id);
    if (cached) {
      if (cached.algorithm !== handle.algorithm) {
        throw new SecurityError('KEY_NOT_FOUND', 'Private-key handle algorithm mismatch');
      }
      return cached.key;
    }
    if (!this.persistence) {
      throw new SecurityError('KEY_NOT_FOUND', 'Private key is not loaded by this WebCrypto provider');
    }
    const pkcs8 = await this.persistence.loadPrivateKey(handle);
    if (!pkcs8) {
      throw new SecurityError('KEY_NOT_FOUND', 'Private-key handle cannot be resolved');
    }
    try {
      const usages = handle.algorithm === 'Ed25519' ? ['sign'] : ['deriveBits'];
      const key = await this.crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        {name: handle.algorithm},
        false,
        usages,
      );
      this.privateKeys.set(handle.id, {algorithm: handle.algorithm, key});
      return key;
    } finally {
      wipe(pkcs8);
    }
  }

  private assertHandle(handle: PrivateKeyHandle): void {
    if (
      handle.provider !== PROVIDER_ID ||
      !/^wck1_[A-Za-z0-9_-]{16,64}$/.test(handle.id) ||
      (handle.algorithm !== 'Ed25519' && handle.algorithm !== 'X25519')
    ) {
      throw new SecurityError('KEY_NOT_FOUND', 'Private-key handle does not belong to this provider');
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
