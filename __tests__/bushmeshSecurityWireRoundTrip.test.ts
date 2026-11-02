import {Buffer} from 'buffer';

import {
  BushMeshIdentityRotationProof,
  BushMeshPairingProof,
  BushMeshSecurityDeviceIdentity,
  BushMeshSessionOffer,
  BushMeshSessionResponse,
  BushMeshWrappedGroupKeyDistribution,
  decodeBushMeshSecurityContainer,
  encodeBushMeshIdentityRotationProofContainer,
  encodeBushMeshPairingProofContainer,
  encodeBushMeshSessionOfferContainer,
  encodeBushMeshSessionResponseContainer,
  encodeBushMeshWrappedGroupKeyDistributionContainer,
} from '../src/bushmesh/protocol/public';

function b64(byte: number, length: number): string {
  return Buffer.alloc(length, byte)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const identity: BushMeshSecurityDeviceIdentity = {
  identityVersion: 1,
  deviceId: 'bm1_roundtrip',
  signingPublicKey: b64(0x01, 32),
  agreementPublicKey: b64(0x02, 32),
  fingerprint: b64(0x03, 32),
  keyEpoch: 3,
  createdAt: 100,
};

function decodedControlValue(bytes: number[]): unknown {
  const decoded = decodeBushMeshSecurityContainer(bytes);
  switch (decoded.kind) {
    case 'pairing-proof':
    case 'session-offer':
    case 'session-response':
    case 'wrapped-group-key-distribution':
    case 'identity-rotation-proof':
      return decoded.value;
    case 'protected-direct':
    case 'protected-group':
      throw new Error('Expected Security control container.');
  }
}

describe('BushMesh Protocol v1 Security control round trips', () => {
  it('round-trips every frozen Security v1 control object exactly', () => {
    const pairing: BushMeshPairingProof = {
      identity,
      challenge: b64(0x04, 16),
      supportedSecurityVersions: [2, 1],
      supportedProtocolVersions: [1],
      issuedAt: 101,
      signature: b64(0x05, 64),
    };
    expect(
      decodedControlValue(encodeBushMeshPairingProofContainer(pairing)),
    ).toEqual(pairing);

    const offer: BushMeshSessionOffer = {
      handshakeId: 'bmh1_roundtrip',
      initiator: identity,
      responderDeviceId: 'bm1_responder',
      ephemeralAgreementPublicKey: b64(0x06, 32),
      nonce: b64(0x07, 32),
      sendNoncePrefix: b64(0x08, 4),
      supportedSecurityVersions: [2, 1],
      supportedProtocolVersions: [1],
      issuedAt: 102,
      signature: b64(0x09, 64),
    };
    expect(
      decodedControlValue(encodeBushMeshSessionOfferContainer(offer)),
    ).toEqual(offer);

    const responder: BushMeshSecurityDeviceIdentity = {
      ...identity,
      deviceId: 'bm1_responder',
      fingerprint: b64(0x0a, 32),
      keyEpoch: 4,
      createdAt: 90,
    };
    const response: BushMeshSessionResponse = {
      handshakeId: offer.handshakeId,
      responder,
      initiatorDeviceId: identity.deviceId,
      ephemeralAgreementPublicKey: b64(0x0b, 32),
      nonce: b64(0x0c, 32),
      sendNoncePrefix: b64(0x0d, 4),
      selectedSecurityVersion: 2,
      selectedProtocolVersion: 1,
      issuedAt: 103,
      signature: b64(0x0e, 64),
    };
    expect(
      decodedControlValue(encodeBushMeshSessionResponseContainer(response)),
    ).toEqual(response);

    const distribution: BushMeshWrappedGroupKeyDistribution = {
      distributionVersion: 1,
      groupId: 'bmg1_roundtrip',
      epoch: 5,
      senderDeviceId: identity.deviceId,
      senderFingerprint: identity.fingerprint,
      recipientDeviceId: responder.deviceId,
      recipientFingerprint: responder.fingerprint,
      securityVersion: 2,
      protocolVersion: 1,
      sessionId: 'bms1_roundtrip',
      encryptedPayload: {
        securityVersion: 2,
        protocolVersion: 1,
        sessionId: 'bms1_roundtrip',
        keyEpoch: 4,
        counter: '18446744073709551615',
        ciphertext: b64(0x0f, 32),
      },
    };
    expect(
      decodedControlValue(
        encodeBushMeshWrappedGroupKeyDistributionContainer(distribution),
      ),
    ).toEqual(distribution);

    const nextIdentity: BushMeshSecurityDeviceIdentity = {
      ...identity,
      signingPublicKey: b64(0x10, 32),
      agreementPublicKey: b64(0x11, 32),
      fingerprint: b64(0x12, 32),
      keyEpoch: 4,
      rotatedAt: 104,
    };
    const rotation: BushMeshIdentityRotationProof = {
      previousFingerprint: identity.fingerprint,
      nextIdentity,
      rotatedAt: 104,
      signature: b64(0x13, 64),
    };
    expect(
      decodedControlValue(
        encodeBushMeshIdentityRotationProofContainer(rotation),
      ),
    ).toEqual(rotation);
  });

  it('rejects an unsupported Security control body schema version', () => {
    const pairing: BushMeshPairingProof = {
      identity,
      challenge: b64(0x04, 16),
      supportedSecurityVersions: [1],
      supportedProtocolVersions: [1],
      issuedAt: 101,
      signature: b64(0x05, 64),
    };
    const bytes = encodeBushMeshPairingProofContainer(pairing);

    // B5 53 / version / kind / routingFlags / aadLength / bodyLength(varuint).
    // Walk the body-length varuint rather than assuming its exact size.
    let cursor = 6;
    while ((bytes[cursor] & 0x80) !== 0) {
      cursor += 1;
    }
    cursor += 1;
    bytes[cursor] = 2;

    expect(() => decodeBushMeshSecurityContainer(bytes)).toThrow(
      /object schema version 2/,
    );
  });
});
