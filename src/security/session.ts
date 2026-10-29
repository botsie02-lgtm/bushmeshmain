import {
  concatBytes,
  encodeFields,
  fromBase64Url,
  parseCounter,
  toBase64Url,
  wipe,
} from './bytes';
import {isSecurityError, SecurityError} from './errors';
import {IdentityManager} from './identity';
import {NonceManager, ReplayProtector} from './nonceReplay';
import type {CryptoProvider, SecureSecretStore, SecurityClock, SecurityMetadataStore} from './ports';
import {systemClock} from './ports';
import {
  directMessageAad,
  sessionOfferPayload,
  sessionResponsePayload,
} from './transcripts';
import type {
  DirectSessionRecord,
  EncryptedDirectMessage,
  PendingHandshakeRecord,
  SecurityProtocolContext,
  SessionOffer,
  SessionResponse,
} from './types';
import {PeerTrustManager} from './trust';
import {VersionPolicy} from './versionPolicy';

const HANDSHAKE_MAX_AGE_MS = 120_000;
const MAX_CLOCK_SKEW_MS = 5_000;
const DEFAULT_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function offerUnsigned(offer: SessionOffer): Omit<SessionOffer, 'signature'> {
  const {signature: _signature, ...unsigned} = offer;
  return unsigned;
}

function responseUnsigned(response: SessionResponse): Omit<SessionResponse, 'signature'> {
  const {signature: _signature, ...unsigned} = response;
  return unsigned;
}

export class DirectSessionManager {
  private readonly nonceManager: NonceManager;
  private readonly replayProtector: ReplayProtector;

  constructor(
    private readonly crypto: CryptoProvider,
    private readonly secrets: SecureSecretStore,
    private readonly metadata: SecurityMetadataStore,
    private readonly identity: IdentityManager,
    private readonly trust: PeerTrustManager,
    private readonly versions: VersionPolicy,
    private readonly clock: SecurityClock = systemClock,
    private readonly sessionLifetimeMs = DEFAULT_SESSION_LIFETIME_MS,
  ) {
    this.nonceManager = new NonceManager(metadata);
    this.replayProtector = new ReplayProtector(metadata);
  }

  async createOffer(peerDeviceId: string): Promise<SessionOffer> {
    await this.trust.assertTrusted(peerDeviceId);
    const localIdentity = await this.identity.current();
    const ephemeral = await this.crypto.generateAgreementKeyPair('session-ephemeral');
    const handshakeId = `bmh1_${toBase64Url(this.crypto.randomBytes(16))}`;
    const unsigned: Omit<SessionOffer, 'signature'> = {
      handshakeId,
      initiator: localIdentity,
      responderDeviceId: peerDeviceId,
      ephemeralAgreementPublicKey: toBase64Url(ephemeral.publicKey),
      nonce: toBase64Url(this.crypto.randomBytes(32)),
      sendNoncePrefix: toBase64Url(this.crypto.randomBytes(4)),
      supportedSecurityVersions: this.versions.supportedSecurityVersions,
      supportedProtocolVersions: this.versions.supportedProtocolVersions,
      issuedAt: this.clock.now(),
    };
    const signature = await this.identity.sign(sessionOfferPayload(unsigned));
    const offer: SessionOffer = {...unsigned, signature: toBase64Url(signature)};
    const pending: PendingHandshakeRecord = {
      handshakeId,
      peerDeviceId,
      offer,
      privateKeyHandle: ephemeral.privateKeyHandle,
      createdAt: this.clock.now(),
      expiresAt: this.clock.now() + HANDSHAKE_MAX_AGE_MS,
    };
    try {
      await this.metadata.setPendingHandshake(pending);
      return offer;
    } catch (error) {
      await this.crypto.deletePrivateKey(ephemeral.privateKeyHandle);
      throw error;
    }
  }

  async acceptOffer(offer: SessionOffer): Promise<{response: SessionResponse; session: DirectSessionRecord}> {
    await this.assertOffer(offer);
    const localIdentity = await this.identity.current();
    if (offer.responderDeviceId !== localIdentity.deviceId) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Session offer targets another device');
    }
    await this.trust.assertTrusted(offer.initiator.deviceId, offer.initiator.fingerprint);

    const offerSignatureValid = await this.identity.verify(
      offer.initiator,
      sessionOfferPayload(offerUnsigned(offer)),
      fromBase64Url(offer.signature, 64),
    );
    if (!offerSignatureValid) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Session offer signature is invalid');
    }

    const selectedSecurityVersion = this.versions.negotiateSecurity(
      offer.supportedSecurityVersions,
    );
    const selectedProtocolVersion = this.versions.negotiateProtocol(
      offer.supportedProtocolVersions,
    );
    const consumed = await this.metadata.consumeHandshakeId(
      offer.handshakeId,
      this.clock.now() + HANDSHAKE_MAX_AGE_MS,
    );
    if (!consumed) {
      throw new SecurityError('REPLAY_DETECTED', 'Session offer handshake ID was already consumed');
    }

    const ephemeral = await this.crypto.generateAgreementKeyPair('session-ephemeral');
    const responseUnsignedValue: Omit<SessionResponse, 'signature'> = {
      handshakeId: offer.handshakeId,
      responder: localIdentity,
      initiatorDeviceId: offer.initiator.deviceId,
      ephemeralAgreementPublicKey: toBase64Url(ephemeral.publicKey),
      nonce: toBase64Url(this.crypto.randomBytes(32)),
      sendNoncePrefix: toBase64Url(this.crypto.randomBytes(4)),
      selectedSecurityVersion,
      selectedProtocolVersion,
      issuedAt: this.clock.now(),
    };
    const responseSignature = await this.identity.sign(
      sessionResponsePayload(offer, responseUnsignedValue),
    );
    const response: SessionResponse = {
      ...responseUnsignedValue,
      signature: toBase64Url(responseSignature),
    };

    let shared: Uint8Array | undefined;
    try {
      shared = await this.crypto.deriveSharedSecret(
        ephemeral.privateKeyHandle,
        fromBase64Url(offer.ephemeralAgreementPublicKey, 32),
      );
      const {initiatorSendKey, responderSendKey, sessionId} = await this.deriveSessionKeys(
        offer,
        response,
        shared,
      );
      const session = await this.persistSession({
        sessionId,
        peerDeviceId: offer.initiator.deviceId,
        peerFingerprint: offer.initiator.fingerprint,
        securityVersion: selectedSecurityVersion,
        protocolVersion: selectedProtocolVersion,
        sendKey: responderSendKey,
        receiveKey: initiatorSendKey,
        sendNoncePrefix: response.sendNoncePrefix,
        receiveNoncePrefix: offer.sendNoncePrefix,
      });
      return {response, session};
    } finally {
      wipe(shared);
      await this.crypto.deletePrivateKey(ephemeral.privateKeyHandle);
    }
  }

  async finalizeOffer(response: SessionResponse): Promise<DirectSessionRecord> {
    const pending = await this.metadata.getPendingHandshake(response.handshakeId);
    if (!pending) {
      throw new SecurityError('SESSION_NOT_FOUND', 'Pending session handshake not found');
    }
    if (pending.expiresAt < this.clock.now()) {
      await this.abortPending(response.handshakeId);
      throw new SecurityError('EXPIRED_KEY', 'Pending session handshake expired');
    }
    const offer = pending.offer;
    await this.assertResponse(response, offer);
    if (
      response.initiatorDeviceId !== offer.initiator.deviceId ||
      response.responder.deviceId !== pending.peerDeviceId
    ) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Session response identity mismatch');
    }
    await this.identity.assertIdentityIntegrity(response.responder);
    await this.trust.assertTrusted(response.responder.deviceId, response.responder.fingerprint);
    this.versions.assertSelectedSecurity(
      offer.supportedSecurityVersions,
      response.selectedSecurityVersion,
    );
    this.versions.assertSelectedProtocol(
      offer.supportedProtocolVersions,
      response.selectedProtocolVersion,
    );

    const signatureValid = await this.identity.verify(
      response.responder,
      sessionResponsePayload(offer, responseUnsigned(response)),
      fromBase64Url(response.signature, 64),
    );
    if (!signatureValid) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Session response signature is invalid');
    }

    if (!(await this.crypto.hasPrivateKey(pending.privateKeyHandle))) {
      throw new SecurityError('KEY_NOT_FOUND', 'Pending ephemeral key is unavailable');
    }
    let shared: Uint8Array | undefined;
    try {
      shared = await this.crypto.deriveSharedSecret(
        pending.privateKeyHandle,
        fromBase64Url(response.ephemeralAgreementPublicKey, 32),
      );
      const {initiatorSendKey, responderSendKey, sessionId} = await this.deriveSessionKeys(
        offer,
        response,
        shared,
      );
      const session = await this.persistSession({
        sessionId,
        peerDeviceId: response.responder.deviceId,
        peerFingerprint: response.responder.fingerprint,
        securityVersion: response.selectedSecurityVersion,
        protocolVersion: response.selectedProtocolVersion,
        sendKey: initiatorSendKey,
        receiveKey: responderSendKey,
        sendNoncePrefix: offer.sendNoncePrefix,
        receiveNoncePrefix: response.sendNoncePrefix,
      });
      await this.abortPending(response.handshakeId);
      return session;
    } finally {
      wipe(shared);
    }
  }

  async encrypt(
    sessionId: string,
    plaintext: Uint8Array,
    context: SecurityProtocolContext,
  ): Promise<EncryptedDirectMessage> {
    const session = await this.requireUsableSession(sessionId);
    this.versions.assertProtocolContext(session.protocolVersion, context.protocolVersion);
    const key = await this.secrets.getSecret(session.sendKeyRef);
    if (!key) {
      throw new SecurityError('KEY_NOT_FOUND', 'Session send key is unavailable');
    }
    try {
      const {counter, nonce} = await this.nonceManager.next(
        session.sendNonceScope,
        session.sendNoncePrefix,
      );
      const aad = directMessageAad(
        session.sessionId,
        session.securityVersion,
        session.protocolVersion,
        session.keyEpoch,
        counter,
        context.authenticatedHeader,
      );
      const ciphertext = await this.crypto.aeadEncrypt(key, nonce, plaintext, aad);
      return {
        securityVersion: session.securityVersion,
        protocolVersion: session.protocolVersion,
        sessionId: session.sessionId,
        keyEpoch: session.keyEpoch,
        counter: counter.toString(),
        ciphertext: toBase64Url(ciphertext),
      };
    } catch (error) {
      if (isSecurityError(error, 'COUNTER_ROLLBACK')) {
        await this.retireSession(session.sessionId, 'revoked');
      }
      throw error;
    } finally {
      wipe(key);
    }
  }

  async decrypt(
    envelope: EncryptedDirectMessage,
    context: SecurityProtocolContext,
  ): Promise<Uint8Array> {
    const session = await this.requireUsableSession(envelope.sessionId);
    this.versions.assertProtocolContext(session.protocolVersion, context.protocolVersion);
    if (
      envelope.securityVersion !== session.securityVersion ||
      envelope.protocolVersion !== session.protocolVersion
    ) {
      throw new SecurityError('DOWNGRADE_DETECTED', 'Encrypted message version mismatch');
    }
    if (envelope.keyEpoch !== session.keyEpoch) {
      throw new SecurityError('ROTATED_KEY', 'Encrypted message uses a rotated session key');
    }
    const counter = parseCounter(envelope.counter);
    const key = await this.secrets.getSecret(session.receiveKeyRef);
    if (!key) {
      throw new SecurityError('KEY_NOT_FOUND', 'Session receive key is unavailable');
    }
    let plaintext: Uint8Array | undefined;
    try {
      const nonce = this.nonceManager.fromCounter(session.receiveNoncePrefix, counter);
      const aad = directMessageAad(
        session.sessionId,
        session.securityVersion,
        session.protocolVersion,
        session.keyEpoch,
        counter,
        context.authenticatedHeader,
      );
      plaintext = await this.crypto.aeadDecrypt(
        key,
        nonce,
        fromBase64Url(envelope.ciphertext),
        aad,
      );
      await this.replayProtector.assertFresh(session.receiveReplayScope, counter);
      return plaintext;
    } catch (error) {
      wipe(plaintext);
      throw error;
    } finally {
      wipe(key);
    }
  }

  async assertPeerSession(
    sessionId: string,
    peerDeviceId: string,
    peerFingerprint?: string,
  ): Promise<void> {
    const session = await this.requireUsableSession(sessionId);
    if (
      session.peerDeviceId !== peerDeviceId ||
      (peerFingerprint !== undefined && session.peerFingerprint !== peerFingerprint)
    ) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Direct session is bound to another peer');
    }
  }

  async retireSession(sessionId: string, state: 'rotated' | 'revoked'): Promise<void> {
    const session = await this.requireSession(sessionId);
    await this.metadata.setSession({...session, state});
    await this.secrets.deleteSecret(session.sendKeyRef);
    await this.secrets.deleteSecret(session.receiveKeyRef);
  }

  async retireSessionsForPeer(
    peerDeviceId: string,
    state: 'rotated' | 'revoked',
  ): Promise<number> {
    const sessions = await this.metadata.listSessions(peerDeviceId);
    let retired = 0;
    for (const session of sessions) {
      if (session.state === state) {
        continue;
      }
      await this.metadata.setSession({...session, state});
      await this.secrets.deleteSecret(session.sendKeyRef);
      await this.secrets.deleteSecret(session.receiveKeyRef);
      retired += 1;
    }
    return retired;
  }

  async revokeSessionsForPeer(peerDeviceId: string): Promise<number> {
    return this.retireSessionsForPeer(peerDeviceId, 'revoked');
  }

  async rotateSessionsForPeer(peerDeviceId: string): Promise<number> {
    return this.retireSessionsForPeer(peerDeviceId, 'rotated');
  }

  async abortPending(handshakeId: string): Promise<void> {
    const pending = await this.metadata.getPendingHandshake(handshakeId);
    if (pending) {
      await this.crypto.deletePrivateKey(pending.privateKeyHandle);
      await this.metadata.deletePendingHandshake(handshakeId);
    }
  }

  private async assertOffer(offer: SessionOffer): Promise<void> {
    if (!/^bmh1_[A-Za-z0-9_-]{16,128}$/.test(offer.handshakeId)) {
      throw new SecurityError('INVALID_INPUT', 'Malformed handshake ID');
    }
    await this.identity.assertIdentityIntegrity(offer.initiator);
    fromBase64Url(offer.ephemeralAgreementPublicKey, 32);
    fromBase64Url(offer.nonce, 32);
    fromBase64Url(offer.sendNoncePrefix, 4);
    fromBase64Url(offer.signature, 64);
    if (
      offer.issuedAt > this.clock.now() + MAX_CLOCK_SKEW_MS ||
      this.clock.now() - offer.issuedAt > HANDSHAKE_MAX_AGE_MS
    ) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Session offer is outside its validity window');
    }
  }

  private async assertResponse(response: SessionResponse, offer: SessionOffer): Promise<void> {
    if (response.handshakeId !== offer.handshakeId) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Session response handshake mismatch');
    }
    fromBase64Url(response.ephemeralAgreementPublicKey, 32);
    fromBase64Url(response.nonce, 32);
    fromBase64Url(response.sendNoncePrefix, 4);
    fromBase64Url(response.signature, 64);
    if (
      response.issuedAt < offer.issuedAt - MAX_CLOCK_SKEW_MS ||
      response.issuedAt > this.clock.now() + MAX_CLOCK_SKEW_MS ||
      this.clock.now() - response.issuedAt > HANDSHAKE_MAX_AGE_MS
    ) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Session response is outside its validity window');
    }
  }

  private async deriveSessionKeys(
    offer: SessionOffer,
    response: SessionResponse,
    sharedSecret: Uint8Array,
  ): Promise<{initiatorSendKey: Uint8Array; responderSendKey: Uint8Array; sessionId: string}> {
    const transcript = encodeFields('bushmesh.direct-session-transcript.v1', [
      sessionResponsePayload(offer, responseUnsigned(response)),
      fromBase64Url(response.signature, 64),
    ]);
    const transcriptHash = await this.crypto.sha256(transcript);
    const salt = await this.crypto.sha256(
      concatBytes(fromBase64Url(offer.nonce, 32), fromBase64Url(response.nonce, 32)),
    );
    const keyMaterial = await this.crypto.hkdfSha256(
      sharedSecret,
      salt,
      encodeFields('bushmesh.direct-session-kdf.v1', [transcriptHash]),
      64,
    );
    return {
      initiatorSendKey: keyMaterial.slice(0, 32),
      responderSendKey: keyMaterial.slice(32, 64),
      sessionId: `bms1_${toBase64Url(transcriptHash.slice(0, 16))}`,
    };
  }

  private async persistSession(input: {
    sessionId: string;
    peerDeviceId: string;
    peerFingerprint: string;
    securityVersion: number;
    protocolVersion: number;
    sendKey: Uint8Array;
    receiveKey: Uint8Array;
    sendNoncePrefix: string;
    receiveNoncePrefix: string;
  }): Promise<DirectSessionRecord> {
    const sendKeyRef = `session/${input.sessionId}/send`;
    const receiveKeyRef = `session/${input.sessionId}/receive`;
    await this.secrets.setSecret(sendKeyRef, input.sendKey);
    await this.secrets.setSecret(receiveKeyRef, input.receiveKey);
    wipe(input.sendKey);
    wipe(input.receiveKey);

    const createdAt = this.clock.now();
    const session: DirectSessionRecord = {
      sessionId: input.sessionId,
      peerDeviceId: input.peerDeviceId,
      peerFingerprint: input.peerFingerprint,
      securityVersion: input.securityVersion,
      protocolVersion: input.protocolVersion,
      keyEpoch: 1,
      sendKeyRef,
      receiveKeyRef,
      sendNoncePrefix: input.sendNoncePrefix,
      receiveNoncePrefix: input.receiveNoncePrefix,
      sendNonceScope: `session/${input.sessionId}/send/epoch-1`,
      receiveReplayScope: `session/${input.sessionId}/receive/epoch-1`,
      createdAt,
      expiresAt: createdAt + this.sessionLifetimeMs,
      state: 'active',
    };
    await this.metadata.setSession(session);
    return session;
  }

  private async requireSession(sessionId: string): Promise<DirectSessionRecord> {
    const session = await this.metadata.getSession(sessionId);
    if (!session) {
      throw new SecurityError('SESSION_NOT_FOUND', `Unknown session ${sessionId}`);
    }
    return session;
  }

  private async requireUsableSession(sessionId: string): Promise<DirectSessionRecord> {
    const session = await this.requireSession(sessionId);
    if (session.state === 'rotated') {
      throw new SecurityError('ROTATED_KEY', 'Session key has been rotated');
    }
    if (session.state === 'revoked') {
      throw new SecurityError('PEER_REVOKED', 'Session has been revoked');
    }
    if (session.state === 'expired' || session.expiresAt <= this.clock.now()) {
      if (session.state !== 'expired') {
        await this.metadata.setSession({...session, state: 'expired'});
      }
      throw new SecurityError('EXPIRED_KEY', 'Session key has expired');
    }
    await this.trust.assertTrusted(session.peerDeviceId, session.peerFingerprint);
    return session;
  }
}
