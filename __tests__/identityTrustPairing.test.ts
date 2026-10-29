import {toBase64Url} from '../src/security/bytes';
import {SecurityError} from '../src/security/errors';
import {IdentityManager} from '../src/security/identity';
import {PairingService} from '../src/security/pairing';
import {createSecurityNode, mutuallyTrust} from './securityTestHelpers';

describe('identity, trust, rotation and pairing', () => {
  test('persistent identity recovers without regenerating keys', async () => {
    const node = createSecurityNode();
    const first = await node.identity.loadOrCreate();
    const recovered = new IdentityManager(node.crypto, node.secrets, node.metadata, node.clock);
    expect(await recovered.loadOrCreate()).toEqual(first);
  });

  test('detects malformed public key material', async () => {
    const node = createSecurityNode();
    const identity = await node.identity.loadOrCreate();
    await node.metadata.setIdentity({...identity, signingPublicKey: toBase64Url(new Uint8Array(31))});
    await expect(node.identity.current()).rejects.toMatchObject({code: 'INVALID_INPUT'});
  });

  test('rejects duplicate device identity with unproven replacement keys', async () => {
    const local = createSecurityNode();
    const peerA = createSecurityNode();
    const peerB = createSecurityNode();
    const a = await peerA.identity.loadOrCreate();
    const b = await peerB.identity.loadOrCreate();
    await local.identity.loadOrCreate();
    await local.trust.observe(a);

    const replacementUnsigned = {
      ...b,
      deviceId: a.deviceId,
      keyEpoch: a.keyEpoch,
      createdAt: a.createdAt,
    };
    const {fingerprint: _old, ...withoutFingerprint} = replacementUnsigned;
    const replacement = {
      ...withoutFingerprint,
      fingerprint: await local.identity.computeFingerprint(withoutFingerprint),
    };
    await expect(local.trust.observe(replacement)).rejects.toMatchObject({
      code: 'DUPLICATE_IDENTITY',
    });
  });

  test('accepts signed sequential key rotation and keeps trust', async () => {
    const local = createSecurityNode();
    const peer = createSecurityNode();
    await mutuallyTrust(local, peer);
    const proof = await peer.identity.rotateKeys();
    const updated = await local.trust.applyRotation(proof);
    expect(updated.trustState).toBe('trusted');
    expect(updated.identity.fingerprint).toBe(proof.nextIdentity.fingerprint);
    expect(updated.fingerprintHistory).toContain(proof.previousFingerprint);
  });

  test('revoked peer remains rejected', async () => {
    const a = createSecurityNode();
    const b = createSecurityNode();
    const {bIdentity} = await mutuallyTrust(a, b);
    await a.trust.revoke(bIdentity.deviceId, 'compromised');
    await expect(a.trust.assertTrusted(bIdentity.deviceId)).rejects.toMatchObject({
      code: 'PEER_REVOKED',
    });
  });

  test('pairing proof binds challenge and signature', async () => {
    const node = createSecurityNode();
    await node.identity.loadOrCreate();
    const pairing = new PairingService(node.identity, node.versions, node.clock);
    const challenge = node.crypto.randomBytes(32);
    const proof = await pairing.createProof(challenge);
    await expect(pairing.verifyProof(proof, challenge)).resolves.toBeUndefined();
    const tampered = {...proof, signature: proof.signature.slice(0, -1) + 'A'};
    await expect(pairing.verifyProof(tampered, challenge)).rejects.toBeInstanceOf(SecurityError);
    await expect(pairing.verifyProof(proof, node.crypto.randomBytes(32))).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });
});
