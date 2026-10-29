import {fromBase64Url, toBase64Url} from './bytes';
import {SecurityError} from './errors';
import {IdentityManager} from './identity';
import type {SecurityClock} from './ports';
import {systemClock} from './ports';
import {pairingProofPayload} from './transcripts';
import type {PairingProof} from './types';
import {VersionPolicy} from './versionPolicy';

export class PairingService {
  constructor(
    private readonly identity: IdentityManager,
    private readonly versions: VersionPolicy,
    private readonly clock: SecurityClock = systemClock,
  ) {}

  async createProof(challenge: Uint8Array): Promise<PairingProof> {
    if (challenge.length < 16) {
      throw new SecurityError('INVALID_INPUT', 'Pairing challenge must contain at least 128 bits');
    }
    const unsigned: Omit<PairingProof, 'signature'> = {
      identity: await this.identity.current(),
      challenge: toBase64Url(challenge),
      supportedSecurityVersions: this.versions.supportedSecurityVersions,
      supportedProtocolVersions: this.versions.supportedProtocolVersions,
      issuedAt: this.clock.now(),
    };
    const signature = await this.identity.sign(pairingProofPayload(unsigned));
    return {...unsigned, signature: toBase64Url(signature)};
  }

  async verifyProof(
    proof: PairingProof,
    expectedChallenge: Uint8Array,
    maxAgeMs = 120_000,
  ): Promise<void> {
    if (expectedChallenge.length < 16 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
      throw new SecurityError('INVALID_INPUT', 'Invalid pairing verification parameters');
    }
    const challenge = fromBase64Url(proof.challenge);
    if (challenge.length !== expectedChallenge.length) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Pairing challenge mismatch');
    }
    let mismatch = 0;
    for (let i = 0; i < challenge.length; i += 1) {
      mismatch |= challenge[i] ^ expectedChallenge[i];
    }
    if (mismatch !== 0) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Pairing challenge mismatch');
    }
    if (proof.issuedAt > this.clock.now() + 5_000 || this.clock.now() - proof.issuedAt > maxAgeMs) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Pairing proof is outside its validity window');
    }
    this.versions.negotiateSecurity(proof.supportedSecurityVersions);
    this.versions.negotiateProtocol(proof.supportedProtocolVersions);
    await this.identity.assertIdentityIntegrity(proof.identity);
    const {signature: _signature, ...unsigned} = proof;
    const valid = await this.identity.verify(
      proof.identity,
      pairingProofPayload(unsigned),
      fromBase64Url(proof.signature, 64),
    );
    if (!valid) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Pairing proof signature is invalid');
    }
  }
}
