import {
  encodeFields,
  encodeNumberList,
  fromBase64Url,
  u32be,
  utf8,
} from './bytes';
import type {
  DeviceIdentity,
  IdentityRotationProof,
  PairingProof,
  SessionOffer,
  SessionResponse,
} from './types';

export function identityFingerprintPayload(identity: Omit<DeviceIdentity, 'fingerprint'>): Uint8Array {
  return encodeFields('bushmesh.identity-fingerprint.v1', [
    utf8(identity.deviceId),
    fromBase64Url(identity.signingPublicKey, 32),
    fromBase64Url(identity.agreementPublicKey, 32),
    u32be(identity.keyEpoch),
  ]);
}

export function identityRotationPayload(
  proof: Omit<IdentityRotationProof, 'signature'>,
): Uint8Array {
  const next = proof.nextIdentity;
  return encodeFields('bushmesh.identity-rotation.v1', [
    utf8(proof.previousFingerprint),
    utf8(next.deviceId),
    utf8(next.fingerprint),
    fromBase64Url(next.signingPublicKey, 32),
    fromBase64Url(next.agreementPublicKey, 32),
    u32be(next.keyEpoch),
    utf8(String(proof.rotatedAt)),
    utf8(String(next.rotatedAt ?? 0)),
  ]);
}

export function pairingProofPayload(proof: Omit<PairingProof, 'signature'>): Uint8Array {
  return encodeFields('bushmesh.pairing-proof.v1', [
    utf8(proof.identity.deviceId),
    utf8(proof.identity.fingerprint),
    fromBase64Url(proof.challenge),
    encodeNumberList(proof.supportedSecurityVersions),
    encodeNumberList(proof.supportedProtocolVersions),
    utf8(String(proof.issuedAt)),
  ]);
}

export function sessionOfferPayload(offer: Omit<SessionOffer, 'signature'>): Uint8Array {
  return encodeFields('bushmesh.direct-session-offer.v1', [
    utf8(offer.handshakeId),
    utf8(offer.initiator.deviceId),
    utf8(offer.initiator.fingerprint),
    utf8(offer.responderDeviceId),
    fromBase64Url(offer.ephemeralAgreementPublicKey, 32),
    fromBase64Url(offer.nonce, 32),
    fromBase64Url(offer.sendNoncePrefix, 4),
    encodeNumberList(offer.supportedSecurityVersions),
    encodeNumberList(offer.supportedProtocolVersions),
    utf8(String(offer.issuedAt)),
  ]);
}

export function sessionResponsePayload(
  offer: SessionOffer,
  response: Omit<SessionResponse, 'signature'>,
): Uint8Array {
  const {signature: _signature, ...unsignedOffer} = offer;
  return encodeFields('bushmesh.direct-session-response.v1', [
    sessionOfferPayload(unsignedOffer),
    fromBase64Url(offer.signature, 64),
    utf8(response.responder.deviceId),
    utf8(response.responder.fingerprint),
    utf8(response.initiatorDeviceId),
    fromBase64Url(response.ephemeralAgreementPublicKey, 32),
    fromBase64Url(response.nonce, 32),
    fromBase64Url(response.sendNoncePrefix, 4),
    u32be(response.selectedSecurityVersion),
    u32be(response.selectedProtocolVersion),
    utf8(String(response.issuedAt)),
  ]);
}

export function directMessageAad(
  sessionId: string,
  securityVersion: number,
  protocolVersion: number,
  keyEpoch: number,
  counter: bigint,
  protocolHeader: Uint8Array,
): Uint8Array {
  return encodeFields('bushmesh.direct-message-aad.v1', [
    utf8(sessionId),
    u32be(securityVersion),
    u32be(protocolVersion),
    u32be(keyEpoch),
    utf8(counter.toString()),
    protocolHeader,
  ]);
}

export function groupMessageAad(
  groupId: string,
  senderDeviceId: string,
  securityVersion: number,
  protocolVersion: number,
  epoch: number,
  counter: bigint,
  protocolHeader: Uint8Array,
): Uint8Array {
  return encodeFields('bushmesh.group-message-aad.v1', [
    utf8(groupId),
    utf8(senderDeviceId),
    u32be(securityVersion),
    u32be(protocolVersion),
    u32be(epoch),
    utf8(counter.toString()),
    protocolHeader,
  ]);
}
