import {fromBase64Url, toBase64Url} from './bytes';
import {SecurityError} from './errors';
import type {CryptoProvider, SecurityClock, SecurityMetadataStore} from './ports';
import {systemClock} from './ports';
import {identityFingerprintPayload, identityRotationPayload} from './transcripts';
import type {
  DeviceIdentity,
  IdentityRotationProof,
  LocalIdentityKeyHandles,
  PrivateKeyHandle,
} from './types';

export class IdentityManager {
  constructor(
    private readonly crypto: CryptoProvider,
    private readonly metadata: SecurityMetadataStore,
    private readonly clock: SecurityClock = systemClock,
  ) {}

  async loadOrCreate(): Promise<DeviceIdentity> {
    const existing = await this.metadata.getIdentity();
    if (existing) {
      await this.assertIdentityIntegrity(existing);
      await this.requireCurrentKeyHandles(existing);
      return existing;
    }

    const signing = await this.crypto.generateSigningKeyPair('identity-signing');
    const agreement = await this.crypto.generateAgreementKeyPair('identity-agreement');
    const now = this.clock.now();
    let committed = false;
    try {
      const identityWithoutFingerprint: Omit<DeviceIdentity, 'fingerprint'> = {
        identityVersion: 1,
        deviceId: `bm1_${toBase64Url(this.crypto.randomBytes(16))}`,
        signingPublicKey: toBase64Url(signing.publicKey),
        agreementPublicKey: toBase64Url(agreement.publicKey),
        keyEpoch: 1,
        createdAt: now,
      };
      const identity: DeviceIdentity = {
        ...identityWithoutFingerprint,
        fingerprint: await this.computeFingerprint(identityWithoutFingerprint),
      };
      const handles: LocalIdentityKeyHandles = {
        keyEpoch: 1,
        signingPrivateKey: signing.privateKeyHandle,
        agreementPrivateKey: agreement.privateKeyHandle,
        createdAt: now,
      };

      await this.metadata.setIdentityKeyHandles(handles);
      await this.metadata.setIdentity(identity);
      committed = true;
      return identity;
    } finally {
      if (!committed) {
        await Promise.allSettled([
          this.crypto.deletePrivateKey(signing.privateKeyHandle),
          this.crypto.deletePrivateKey(agreement.privateKeyHandle),
        ]);
      }
    }
  }

  async current(): Promise<DeviceIdentity> {
    const identity = await this.metadata.getIdentity();
    if (!identity) {
      throw new SecurityError('KEY_NOT_FOUND', 'Device identity has not been initialized');
    }
    await this.assertIdentityIntegrity(identity);
    return identity;
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    const identity = await this.current();
    const handles = await this.requireCurrentKeyHandles(identity);
    return this.crypto.sign(handles.signingPrivateKey, message);
  }

  async verify(identity: DeviceIdentity, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    await this.assertIdentityIntegrity(identity);
    return this.crypto.verify(fromBase64Url(identity.signingPublicKey, 32), message, signature);
  }

  async rotateKeys(): Promise<IdentityRotationProof> {
    const previous = await this.current();
    const oldHandles = await this.requireCurrentKeyHandles(previous);
    const signing = await this.crypto.generateSigningKeyPair('identity-signing');
    const agreement = await this.crypto.generateAgreementKeyPair('identity-agreement');
    const rotatedAt = this.clock.now();
    const nextEpoch = previous.keyEpoch + 1;
    let committed = false;

    try {
      const nextWithoutFingerprint: Omit<DeviceIdentity, 'fingerprint'> = {
        identityVersion: 1,
        deviceId: previous.deviceId,
        signingPublicKey: toBase64Url(signing.publicKey),
        agreementPublicKey: toBase64Url(agreement.publicKey),
        keyEpoch: nextEpoch,
        createdAt: previous.createdAt,
        rotatedAt,
      };
      const nextIdentity: DeviceIdentity = {
        ...nextWithoutFingerprint,
        fingerprint: await this.computeFingerprint(nextWithoutFingerprint),
      };
      const unsigned: Omit<IdentityRotationProof, 'signature'> = {
        previousFingerprint: previous.fingerprint,
        nextIdentity,
        rotatedAt,
      };
      const signature = await this.crypto.sign(
        oldHandles.signingPrivateKey,
        identityRotationPayload(unsigned),
      );
      const nextHandles: LocalIdentityKeyHandles = {
        keyEpoch: nextEpoch,
        signingPrivateKey: signing.privateKeyHandle,
        agreementPrivateKey: agreement.privateKeyHandle,
        createdAt: rotatedAt,
      };

      await this.metadata.setIdentityKeyHandles(nextHandles);
      await this.metadata.setIdentity(nextIdentity);
      committed = true;
      await Promise.allSettled([
        this.crypto.deletePrivateKey(oldHandles.signingPrivateKey),
        this.crypto.deletePrivateKey(oldHandles.agreementPrivateKey),
      ]);
      return {...unsigned, signature: toBase64Url(signature)};
    } finally {
      if (!committed) {
        await Promise.allSettled([
          this.crypto.deletePrivateKey(signing.privateKeyHandle),
          this.crypto.deletePrivateKey(agreement.privateKeyHandle),
        ]);
      }
    }
  }

  async getAgreementPrivateKeyHandle(): Promise<{
    identity: DeviceIdentity;
    privateKeyHandle: PrivateKeyHandle;
  }> {
    const identity = await this.current();
    const handles = await this.requireCurrentKeyHandles(identity);
    return {identity, privateKeyHandle: handles.agreementPrivateKey};
  }

  async assertIdentityIntegrity(identity: DeviceIdentity): Promise<void> {
    if (
      identity.identityVersion !== 1 ||
      !identity.deviceId.startsWith('bm1_') ||
      !Number.isSafeInteger(identity.keyEpoch) ||
      identity.keyEpoch <= 0 ||
      !Number.isSafeInteger(identity.createdAt) ||
      identity.createdAt <= 0 ||
      (identity.rotatedAt !== undefined &&
        (!Number.isSafeInteger(identity.rotatedAt) || identity.rotatedAt < identity.createdAt))
    ) {
      throw new SecurityError('IDENTITY_CORRUPT', 'Malformed BushMesh identity metadata');
    }
    fromBase64Url(identity.signingPublicKey, 32);
    fromBase64Url(identity.agreementPublicKey, 32);
    const {fingerprint: _fingerprint, ...unsigned} = identity;
    const expected = await this.computeFingerprint(unsigned);
    if (expected !== identity.fingerprint) {
      throw new SecurityError('IDENTITY_CORRUPT', 'Identity fingerprint mismatch');
    }
  }

  async computeFingerprint(identity: Omit<DeviceIdentity, 'fingerprint'>): Promise<string> {
    return toBase64Url(await this.crypto.sha256(identityFingerprintPayload(identity)));
  }

  private async requireCurrentKeyHandles(identity: DeviceIdentity): Promise<LocalIdentityKeyHandles> {
    const handles = await this.metadata.getIdentityKeyHandles();
    if (!handles || handles.keyEpoch !== identity.keyEpoch) {
      throw new SecurityError(
        'IDENTITY_CORRUPT',
        'Identity metadata exists but current private-key handles are missing',
      );
    }
    if (
      handles.signingPrivateKey.algorithm !== 'Ed25519' ||
      handles.signingPrivateKey.purpose !== 'identity-signing' ||
      handles.agreementPrivateKey.algorithm !== 'X25519' ||
      handles.agreementPrivateKey.purpose !== 'identity-agreement'
    ) {
      throw new SecurityError('IDENTITY_CORRUPT', 'Identity private-key handles have wrong purpose');
    }
    const [signingPresent, agreementPresent] = await Promise.all([
      this.crypto.hasPrivateKey(handles.signingPrivateKey),
      this.crypto.hasPrivateKey(handles.agreementPrivateKey),
    ]);
    if (!signingPresent || !agreementPresent) {
      throw new SecurityError(
        'IDENTITY_CORRUPT',
        'Identity references private keys unavailable to the configured crypto provider',
      );
    }
    return handles;
  }
}
