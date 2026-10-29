import {fromBase64Url} from './bytes';
import {SecurityError} from './errors';
import type {CryptoProvider, SecurityClock, SecurityMetadataStore} from './ports';
import {systemClock} from './ports';
import {identityRotationPayload} from './transcripts';
import type {DeviceIdentity, IdentityRotationProof, PeerTrustRecord} from './types';
import {IdentityManager} from './identity';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export class PeerTrustManager {
  constructor(
    private readonly crypto: CryptoProvider,
    private readonly metadata: SecurityMetadataStore,
    private readonly identityManager: IdentityManager,
    private readonly clock: SecurityClock = systemClock,
  ) {}

  async observe(identity: DeviceIdentity): Promise<PeerTrustRecord> {
    await this.identityManager.assertIdentityIntegrity(identity);
    const peers = await this.metadata.listPeers();
    const byDevice = peers.find(peer => peer.deviceId === identity.deviceId);
    const byFingerprint = peers.find(
      peer =>
        peer.identity.fingerprint === identity.fingerprint ||
        peer.fingerprintHistory.includes(identity.fingerprint),
    );

    if (byFingerprint && byFingerprint.deviceId !== identity.deviceId) {
      throw new SecurityError(
        'DUPLICATE_IDENTITY',
        'Fingerprint is already bound to another BushMesh device ID',
      );
    }
    if (byDevice && byDevice.identity.fingerprint !== identity.fingerprint) {
      throw new SecurityError(
        'DUPLICATE_IDENTITY',
        'Device ID presented different keys without a valid rotation proof',
      );
    }

    const now = this.clock.now();
    if (byDevice) {
      const updated = {...byDevice, lastSeenAt: now};
      await this.metadata.setPeer(updated);
      return updated;
    }

    const created: PeerTrustRecord = {
      deviceId: identity.deviceId,
      identity,
      trustState: 'unverified',
      fingerprintHistory: [],
      firstSeenAt: now,
      lastSeenAt: now,
    };
    await this.metadata.setPeer(created);
    return created;
  }

  async trust(deviceId: string, expectedFingerprint: string): Promise<PeerTrustRecord> {
    const record = await this.requirePeer(deviceId);
    if (record.trustState === 'revoked') {
      throw new SecurityError('PEER_REVOKED', 'Revoked peer cannot be trusted without re-pairing');
    }
    if (record.identity.fingerprint !== expectedFingerprint) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Fingerprint confirmation failed');
    }
    const updated: PeerTrustRecord = {
      ...record,
      trustState: 'trusted',
      trustedAt: this.clock.now(),
      lastSeenAt: this.clock.now(),
    };
    await this.metadata.setPeer(updated);
    return updated;
  }

  async revoke(deviceId: string, reason?: string): Promise<void> {
    const record = await this.requirePeer(deviceId);
    await this.metadata.setPeer({
      ...record,
      trustState: 'revoked',
      revokedAt: this.clock.now(),
      revocationReason: reason,
      lastSeenAt: this.clock.now(),
    });
  }

  async assertTrusted(deviceId: string, fingerprint?: string): Promise<PeerTrustRecord> {
    const record = await this.requirePeer(deviceId);
    if (record.trustState === 'revoked') {
      throw new SecurityError('PEER_REVOKED', `Peer ${deviceId} is revoked`);
    }
    if (record.trustState !== 'trusted') {
      throw new SecurityError('PEER_NOT_TRUSTED', `Peer ${deviceId} is not trusted`);
    }
    if (fingerprint !== undefined && record.identity.fingerprint !== fingerprint) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Peer fingerprint does not match trust record');
    }
    return record;
  }

  async applyRotation(proof: IdentityRotationProof): Promise<PeerTrustRecord> {
    const record = await this.requirePeer(proof.nextIdentity.deviceId);
    if (record.trustState === 'revoked') {
      throw new SecurityError('PEER_REVOKED', 'Rotation from a revoked peer is not accepted');
    }
    if (record.identity.fingerprint !== proof.previousFingerprint) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Rotation does not match current peer fingerprint');
    }
    if (proof.nextIdentity.deviceId !== record.deviceId) {
      throw new SecurityError('INVALID_INPUT', 'Rotation changed the stable BushMesh device ID');
    }
    if (proof.nextIdentity.keyEpoch !== record.identity.keyEpoch + 1) {
      throw new SecurityError('INVALID_INPUT', 'Rotation key epoch is not sequential');
    }
    if (proof.nextIdentity.rotatedAt !== proof.rotatedAt) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Rotation timestamp is not bound to next identity');
    }
    if (
      !Number.isSafeInteger(proof.rotatedAt) ||
      proof.rotatedAt < record.identity.createdAt ||
      proof.rotatedAt > this.clock.now() + MAX_CLOCK_SKEW_MS
    ) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Rotation timestamp is invalid');
    }
    if (record.identity.rotatedAt !== undefined && proof.rotatedAt <= record.identity.rotatedAt) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Rotation timestamp did not advance');
    }
    await this.identityManager.assertIdentityIntegrity(proof.nextIdentity);

    const unsigned: Omit<IdentityRotationProof, 'signature'> = {
      previousFingerprint: proof.previousFingerprint,
      nextIdentity: proof.nextIdentity,
      rotatedAt: proof.rotatedAt,
    };
    const valid = await this.crypto.verify(
      fromBase64Url(record.identity.signingPublicKey, 32),
      identityRotationPayload(unsigned),
      fromBase64Url(proof.signature, 64),
    );
    if (!valid) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Identity rotation signature is invalid');
    }

    const updated: PeerTrustRecord = {
      ...record,
      identity: proof.nextIdentity,
      fingerprintHistory: [...record.fingerprintHistory, record.identity.fingerprint],
      lastSeenAt: this.clock.now(),
    };
    await this.metadata.setPeer(updated);
    return updated;
  }

  private async requirePeer(deviceId: string): Promise<PeerTrustRecord> {
    const record = await this.metadata.getPeer(deviceId);
    if (!record) {
      throw new SecurityError('PEER_NOT_TRUSTED', `Unknown peer ${deviceId}`);
    }
    return record;
  }
}
