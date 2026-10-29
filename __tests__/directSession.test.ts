import {utf8} from '../src/security/bytes';
import {DirectSessionManager} from '../src/security/session';
import {VersionPolicy} from '../src/security/versionPolicy';
import {createSecurityNode, mutuallyTrust} from './securityTestHelpers';

const context = {protocolVersion: 1, authenticatedHeader: utf8('canonical-header')};

async function establish(sessionLifetimeMs = 60_000) {
  const a = createSecurityNode();
  const b = createSecurityNode();
  await mutuallyTrust(a, b);
  const aSessions = new DirectSessionManager(
    a.crypto,
    a.secrets,
    a.metadata,
    a.identity,
    a.trust,
    a.versions,
    a.clock,
    sessionLifetimeMs,
  );
  const bSessions = new DirectSessionManager(
    b.crypto,
    b.secrets,
    b.metadata,
    b.identity,
    b.trust,
    b.versions,
    b.clock,
    sessionLifetimeMs,
  );
  const bIdentity = await b.identity.current();
  const offer = await aSessions.createOffer(bIdentity.deviceId);
  const accepted = await bSessions.acceptOffer(offer);
  const aSession = await aSessions.finalizeOffer(accepted.response);
  return {
    a,
    b,
    aSessions,
    bSessions,
    aSession,
    bSession: accepted.session,
    offer,
    response: accepted.response,
  };
}

describe('secure direct-message sessions', () => {
  test('establishes authenticated X25519 session and exchanges messages', async () => {
    const {aSessions, bSessions, aSession, bSession} = await establish();
    expect(aSession.sessionId).toBe(bSession.sessionId);
    const envelope = await aSessions.encrypt(aSession.sessionId, utf8('hello bush'), context);
    const plaintext = await bSessions.decrypt(envelope, context);
    expect(plaintext).toEqual(utf8('hello bush'));
  });

  test('rejects replay after successful authentication and after manager recovery', async () => {
    const {aSessions, b, bSessions, aSession} = await establish();
    const envelope = await aSessions.encrypt(aSession.sessionId, utf8('once'), context);
    await expect(bSessions.decrypt(envelope, context)).resolves.toBeDefined();
    const recovered = new DirectSessionManager(
      b.crypto,
      b.secrets,
      b.metadata,
      b.identity,
      b.trust,
      b.versions,
      b.clock,
    );
    await expect(recovered.decrypt(envelope, context)).rejects.toMatchObject({
      code: 'REPLAY_DETECTED',
    });
  });

  test('modified ciphertext fails without poisoning replay state', async () => {
    const {aSessions, bSessions, aSession} = await establish();
    const envelope = await aSessions.encrypt(aSession.sessionId, utf8('auth me'), context);
    const finalChar = envelope.ciphertext.endsWith('A') ? 'B' : 'A';
    const tampered = {...envelope, ciphertext: envelope.ciphertext.slice(0, -1) + finalChar};
    await expect(bSessions.decrypt(tampered, context)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
    await expect(bSessions.decrypt(envelope, context)).resolves.toBeDefined();
  });

  test('wrong receive key fails authentication', async () => {
    const {a, b, aSessions, bSessions, aSession, bSession} = await establish();
    const envelope = await aSessions.encrypt(aSession.sessionId, utf8('secret'), context);
    await b.secrets.setSecret(bSession.receiveKeyRef, a.crypto.randomBytes(32));
    await expect(bSessions.decrypt(envelope, context)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });

  test('revoked peers cannot continue using established sessions', async () => {
    const {a, b, aSessions, bSessions, aSession} = await establish();
    const aIdentity = await a.identity.current();
    await b.trust.revoke(aIdentity.deviceId, 'lost device');
    await bSessions.revokeSessionsForPeer(aIdentity.deviceId);
    const envelope = await aSessions.encrypt(aSession.sessionId, utf8('blocked'), context);
    await expect(bSessions.decrypt(envelope, context)).rejects.toMatchObject({code: 'PEER_REVOKED'});
  });

  test('expired and rotated session keys are rejected', async () => {
    const expired = await establish(1_000);
    expired.a.clock.advance(1_001);
    await expect(
      expired.aSessions.encrypt(expired.aSession.sessionId, utf8('late'), context),
    ).rejects.toMatchObject({code: 'EXPIRED_KEY'});

    const rotated = await establish();
    await rotated.aSessions.retireSession(rotated.aSession.sessionId, 'rotated');
    await expect(
      rotated.aSessions.encrypt(rotated.aSession.sessionId, utf8('old'), context),
    ).rejects.toMatchObject({code: 'ROTATED_KEY'});
  });

  test('nonce counters survive manager recovery and concurrent reservations are unique', async () => {
    const {a, aSessions, aSession} = await establish();
    const firstBatch = await Promise.all(
      Array.from({length: 32}, (_, index) =>
        aSessions.encrypt(aSession.sessionId, utf8(`m-${index}`), context),
      ),
    );
    const counters = firstBatch.map(message => BigInt(message.counter));
    expect(new Set(counters.map(String)).size).toBe(32);
    expect(counters.map(Number).sort((x, y) => x - y)).toEqual(
      Array.from({length: 32}, (_, index) => index + 1),
    );

    const recovered = new DirectSessionManager(
      a.crypto,
      a.secrets,
      a.metadata,
      a.identity,
      a.trust,
      a.versions,
      a.clock,
    );
    const next = await recovered.encrypt(aSession.sessionId, utf8('after restart'), context);
    expect(next.counter).toBe('33');
  });

  test('counter rollback is a fail-closed security event that revokes the session', async () => {
    const {a, aSessions, aSession} = await establish();
    await aSessions.encrypt(aSession.sessionId, utf8('one'), context);
    await aSessions.encrypt(aSession.sessionId, utf8('two'), context);
    a.metadata.unsafeSetNonceCounter(aSession.sendNonceScope, 1n);

    await expect(
      aSessions.encrypt(aSession.sessionId, utf8('must not reuse'), context),
    ).rejects.toMatchObject({code: 'COUNTER_ROLLBACK'});
    expect((await a.metadata.getSession(aSession.sessionId))?.state).toBe('revoked');
    await expect(
      aSessions.encrypt(aSession.sessionId, utf8('retired'), context),
    ).rejects.toMatchObject({code: 'PEER_REVOKED'});
  });

  test('duplicate session offer is consumed exactly once', async () => {
    const a = createSecurityNode();
    const b = createSecurityNode();
    await mutuallyTrust(a, b);
    const aSessions = new DirectSessionManager(
      a.crypto, a.secrets, a.metadata, a.identity, a.trust, a.versions, a.clock,
    );
    const bSessions = new DirectSessionManager(
      b.crypto, b.secrets, b.metadata, b.identity, b.trust, b.versions, b.clock,
    );
    const offer = await aSessions.createOffer((await b.identity.current()).deviceId);
    await bSessions.acceptOffer(offer);
    await expect(bSessions.acceptOffer(offer)).rejects.toMatchObject({code: 'REPLAY_DETECTED'});
  });

  test('malformed response timestamp is rejected before session establishment', async () => {
    const a = createSecurityNode();
    const b = createSecurityNode();
    await mutuallyTrust(a, b);
    const aSessions = new DirectSessionManager(
      a.crypto, a.secrets, a.metadata, a.identity, a.trust, a.versions, a.clock,
    );
    const bSessions = new DirectSessionManager(
      b.crypto, b.secrets, b.metadata, b.identity, b.trust, b.versions, b.clock,
    );
    const offer = await aSessions.createOffer((await b.identity.current()).deviceId);
    const {response} = await bSessions.acceptOffer(offer);
    const future = {...response, issuedAt: a.clock.now() + 5_001};
    await expect(aSessions.finalizeOffer(future)).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
  });

  test('retires all sessions for a peer after revocation or rotation', async () => {
    const a = createSecurityNode();
    const b = createSecurityNode();
    const {bIdentity} = await mutuallyTrust(a, b);
    const aSessions = new DirectSessionManager(
      a.crypto, a.secrets, a.metadata, a.identity, a.trust, a.versions, a.clock,
    );
    const bSessions = new DirectSessionManager(
      b.crypto, b.secrets, b.metadata, b.identity, b.trust, b.versions, b.clock,
    );
    for (let i = 0; i < 2; i += 1) {
      const offer = await aSessions.createOffer(bIdentity.deviceId);
      const accepted = await bSessions.acceptOffer(offer);
      await aSessions.finalizeOffer(accepted.response);
    }
    expect((await a.metadata.listSessions(bIdentity.deviceId)).length).toBe(2);
    expect(await aSessions.rotateSessionsForPeer(bIdentity.deviceId)).toBe(2);
    expect((await a.metadata.listSessions(bIdentity.deviceId)).every(s => s.state === 'rotated')).toBe(true);
  });

  test('malformed counter and protocol context are rejected', async () => {
    const {aSessions, bSessions, aSession} = await establish();
    const envelope = await aSessions.encrypt(aSession.sessionId, utf8('header-bound'), context);
    await expect(
      bSessions.decrypt({...envelope, counter: '-1'}, context),
    ).rejects.toMatchObject({code: 'INVALID_INPUT'});
    await expect(
      bSessions.decrypt(envelope, {...context, protocolVersion: 2}),
    ).rejects.toMatchObject({code: 'DOWNGRADE_DETECTED'});
  });

  test('rejects version downgrade selections', () => {
    const policy = new VersionPolicy([3, 2, 1], [5, 4, 3], 1, 1);
    expect(() => policy.assertSelectedSecurity([3, 2, 1], 2)).toThrow(
      expect.objectContaining({code: 'DOWNGRADE_DETECTED'}),
    );
    expect(() => policy.assertSelectedProtocol([5, 4, 3], 4)).toThrow(
      expect.objectContaining({code: 'DOWNGRADE_DETECTED'}),
    );
  });

  test('tampered handshake version is rejected even if lower version is supported', async () => {
    const a = createSecurityNode();
    const b = createSecurityNode();
    await mutuallyTrust(a, b);
    const versions = new VersionPolicy([2, 1], [2, 1], 1, 1);
    const aSessions = new DirectSessionManager(
      a.crypto, a.secrets, a.metadata, a.identity, a.trust, versions, a.clock,
    );
    const bSessions = new DirectSessionManager(
      b.crypto, b.secrets, b.metadata, b.identity, b.trust, versions, b.clock,
    );
    const offer = await aSessions.createOffer((await b.identity.current()).deviceId);
    const {response} = await bSessions.acceptOffer(offer);
    await expect(
      aSessions.finalizeOffer({...response, selectedSecurityVersion: 1}),
    ).rejects.toMatchObject({code: 'DOWNGRADE_DETECTED'});
  });
});
