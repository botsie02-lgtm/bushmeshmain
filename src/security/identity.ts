import {fromBase64Url, toBase64Url, wipe} from './bytes';
import {SecurityError} from './errors';
import type {CryptoProvider, SecureSecretStore, SecurityClock, SecurityMetadataStore} from './ports';
import {systemClock} from './ports';
import {identityFingerprintPayload, identityRotationPayload} from './transcripts';
import type {DeviceIdentity, IdentityRotationProof} from './types';

const SIGNING_SECRET_PREFIX = 'identity/signing/';
const AGREEMENT_SECRET_PREFIX = 'identity/agreement/';

function secretRef(prefix: string, epoch: number): string {
  return `${prefix}epoch-${epoch}`;
}

export class IdentityManager {
  constructor(
    private readonly crypto: CryptoProvider,
    private readonly secrets: SecureSecretStore,
    private readonly metadata: SecurityMetadataStore,
    private readonly clock: SecurityClock = systemClock,
  ) {}

  async loadOrCreate(): Promise<DeviceIdentity> {
    const existing = await this.metadata.getIdentity();
    if (existing) {
      await this.assertIdentityIntegrity(existing);
      await this.assertSecretsPresent(existing.keyEpoch);
      return existing;
    }

    const signing = await this.crypto.generateSigningKeyPair();
    const agreement = await this.crypto.generateAgreementKeyPair();
    const now = this.clock.now();
    try {
      const identityWithoutFingerprint: Omit<DeviceIdentity, 'fingerprint'> = {
        identityVersion: 1,
        deviceId: `bm1_${toBase64Url(this.crypto.randomBytes(16))}`,
        signingPublicKey: toBase64Url(signing.publicKey),
        agreementPublicKey: toBase64Url(agreement.publicKey),
        keyEpoch: 1,
        createdAt: now,
      };
      const fingerprint = await this.computeFingerprint(identityWithoutFingerprint);
      const identity: DeviceIdentity = {...identityWithoutFingerprint, fingerprint};

      await this.secrets.setSecret(secretRef(SIGNING_SECRET_PREFIX, 1), signing.privateKey);
      await this.secrets.setSecret(secretRef(AGREEMENT_SECRET_PREFIX, 1), agreement.privateKey);
      await this.metadata.setIdentity(identity);
      return identity;
    } finally {
      wipe(signing.privateKey);
      wipe(agreement.privateKey);
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
    const privateKey = await this.secrets.getSecret(secretRef(SIGNING_SECRET_PREFIX, identity.keyEpoch));
    if (!privateKey) {
      throw new SecurityError('KEY_NOT_FOUND', 'Signing key is unavailable');
    }
    try {
      return await this.crypto.sign(privateKey, message);
    } finally {
      wipe(privateKey);
    }
  }

  async verify(identity: DeviceIdentity, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    await this.assertIdentityIntegrity(identity);
    return this.crypto.verify(fromBase64Url(identity.signingPublicKey, 32), message, signature);
  }

  async rotateKeys(): Promise<IdentityRotationProof> {
    const previous = await this.current();
    const oldSigning = await this.secrets.getSecret(
      secretRef(SIGNING_SECRET_PREFIX, previous.keyEpoch),
    );
    if (!oldSigning) {
      throw new SecurityError('KEY_NOT_FOUND', 'Current signing key is unavailable');
    }

    const signing = await this.crypto.generateSigningKeyPair();
    const agreement = await this.crypto.generateAgreementKeyPair();
    const rotatedAt = this.clock.now();
    const nextEpoch = previous.keyEpoch + 1;

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
      const signature = await this.crypto.sign(oldSigning, identityRotationPayload(unsigned));

      await this.secrets.setSecret(secretRef(SIGNING_SECRET_PREFIX, nextEpoch), signing.privateKey);
      await this.secrets.setSecret(secretRef(AGREEMENT_SECRET_PREFIX, nextEpoch), agreement.privateKey);
      await this.metadata.setIdentity(nextIdentity);
      await this.secrets.deleteSecret(secretRef(SIGNING_SECRET_PREFIX, previous.keyEpoch));
      await this.secrets.deleteSecret(secretRef(AGREEMENT_SECRET_PREFIX, previous.keyEpoch));

      return {...unsigned, signature: toBase64Url(signature)};
    } finally {
      wipe(oldSigning);
      wipe(signing.privateKey);
      wipe(agreement.privateKey);
    }
  }

  async getAgreementPrivateKey(): Promise<{identity: DeviceIdentity; privateKey: Uint8Array}> {
    const identity = await this.current();
    const privateKey = await this.secrets.getSecret(
      secretRef(AGREEMENT_SECRET_PREFIX, identity.keyEpoch),
    );
    if (!privateKey) {
      throw new SecurityError('KEY_NOT_FOUND', 'Agreement key is unavailable');
    }
    return {identity, privateKey};
  }

  async assertIdentityIntegrity(identity: DeviceIdentity): Promise<void> {
    if (
      identity.identityVersion !== 1 ||
      !identity.deviceId.startsWith('bm1_') ||
      !Number.isSafeInteger(identity.keyEpoch) ||
      identity.keyEpoch <= 0
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

  private async assertSecretsPresent(epoch: number): Promise<void> {
    const signing = await this.secrets.getSecret(secretRef(SIGNING_SECRET_PREFIX, epoch));
    const agreement = await this.secrets.getSecret(secretRef(AGREEMENT_SECRET_PREFIX, epoch));
    try {
      if (!signing || !agreement) {
        throw new SecurityError(
          'IDENTITY_CORRUPT',
          'Identity metadata exists but secure key material is missing',
        );
      }
    } finally {
      wipe(signing ?? undefined);
      wipe(agreement ?? undefined);
    }
  }
}
