import {toBase64Url} from '../src/security/bytes';
import {SecurityError} from '../src/security/errors';
import {IdentityManager} from '../src/security/identity';
import {PairingService} from '../src/security/pairing';
import {PeerTrustManager} from '../src/security/trust';
import {createSecurityNode, mutuallyTrust, recreateCrypto} from './securityTestHelpers';

describe('identity, trust, rotation and pairing', () => {
  test('persistent identity recovers using opaque key handles after provider recreation', async () => {
    const node = createSecurityNode();
    const first = await node.identity.loadOrCreate();
    const handles = await node.metadata.getIdentityKeyHandles();
    expect(handles?.signingPrivateKey).toEqual(
      expect.objectContaining({provider: 'webcrypto-v1', algorithm: 'Ed25519'}),
    );
    expect((handles?.signingPrivateKey as unknown as {privateKey?: unknown})?.privateKey).toBeUndefined();

    const recreatedCrypto = recreateCrypto(node);
    const recovered = new IdentityManager(recreatedCrypto, node.metadata, node.clock);
    expect(await recovered.loadOrCreate()).toEqual(first);
    await expect(recovered.sign(new Uint8Array([1, 2, 3]))).resolves.toHaveLength(64);
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

  test('rotation timestamp and next identity are cryptographically bound', async () => {
    const local = createSecurityNode();
    const peer = createSecurityNode();
    await mutuallyTrust(local, peer);
    const proof = await peer.identity.rotateKeys();
    const tampered = {
      ...proof,
      nextIdentity: {...proof.nextIdentity, rotatedAt: proof.rotatedAt + 1},
    };
    await expect(local.trust.applyRotation(tampered)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });

  test('revoked peer remains rejected and cannot rotate back into trust', async () => {
    const a = createSecurityNode();
    const b = createSecurityNode();
    const {bIdentity} = await mutuallyTrust(a, b);
    const proof = await b.identity.rotateKeys();
    await a.trust.revoke(bIdentity.deviceId, 'compromised');
    await expect(a.trust.assertTrusted(bIdentity.deviceId)).rejects.toMatchObject({
      code: 'PEER_REVOKED',
    });
    await expect(a.trust.applyRotation(proof)).rejects.toMatchObject({code: 'PEER_REVOKED'});
  });

  test('fingerprint history cannot be rebound to another device ID', async () => {
    const local = createSecurityNode();
    const peer = createSecurityNode();
    const attacker = createSecurityNode();
    await mutuallyTrust(local, peer);
    const old = await peer.identity.current();
    const proof = await peer.identity.rotateKeys();
    await local.trust.applyRotation(proof);

    const attackerIdentity = await attacker.identity.loadOrCreate();
    const collision = {...old, deviceId: attackerIdentity.deviceId};
    const {fingerprint: _ignored, ...unsigned} = collision;
    const forged = {...unsigned, fingerprint: old.fingerprint};
    await expect(local.trust.observe(forged)).rejects.toBeInstanceOf(SecurityError);
  });

  test('pairing proof binds challenge, signature, versions and age', async () => {
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
    const downgraded = {...proof, supportedSecurityVersions: [0]};
    await expect(pairing.verifyProof(downgraded, challenge)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    node.clock.advance(120_001);
    await expect(pairing.verifyProof(proof, challenge)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });

  test('missing local private-key handle is treated as identity corruption', async () => {
    const node = createSecurityNode();
    const identity = await node.identity.loadOrCreate();
    const handles = await node.metadata.getIdentityKeyHandles();
    expect(handles).not.toBeNull();
    await node.crypto.deletePrivateKey(handles!.signingPrivateKey);
    const recovered = new IdentityManager(node.crypto, node.metadata, node.clock);
    await expect(recovered.loadOrCreate()).rejects.toMatchObject({code: 'IDENTITY_CORRUPT'});
    const trust = new PeerTrustManager(node.crypto, node.metadata, recovered, node.clock);
    expect(trust).toBeDefined();
    expect(identity.deviceId).toMatch(/^bm1_/);
  });
});
