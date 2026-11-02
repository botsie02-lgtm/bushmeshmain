import {Buffer} from 'buffer';

import {
  BushMeshCompressionProfile,
  BushMeshDatagramFragmentReassembler,
  BushMeshPacketType,
  BushMeshPriority,
  BushMeshSecurityDeviceIdentity,
  createBushMeshSecurityProtocolContext,
  decodeBushMeshSecurityContainer,
  encodeBushMeshIdentityRotationProofContainer,
  encodeBushMeshPairingProofContainer,
  encodeBushMeshProtectedDirectContainer,
  encodeBushMeshProtectedGroupContainer,
  encodeBushMeshSessionOfferContainer,
  encodeBushMeshSessionResponseContainer,
  encodeBushMeshWire,
  encodeBushMeshWrappedGroupKeyDistributionContainer,
  fragmentBushMeshDatagramPayload,
} from '../src/bushmesh/protocol/public';

function b64(byte: number, length: number): string {
  return Buffer.alloc(length, byte)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function repeat(byte: number, count: number): number[] {
  return Array.from({length: count}, () => byte);
}

function hex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map(value => value.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

const identityA: BushMeshSecurityDeviceIdentity = {
  identityVersion: 1,
  deviceId: 'a',
  signingPublicKey: b64(0x01, 32),
  agreementPublicKey: b64(0x02, 32),
  fingerprint: b64(0x03, 32),
  keyEpoch: 1,
  createdAt: 1,
};

const identityB: BushMeshSecurityDeviceIdentity = {
  identityVersion: 1,
  deviceId: 'b',
  signingPublicKey: b64(0x11, 32),
  agreementPublicKey: b64(0x12, 32),
  fingerprint: b64(0x13, 32),
  keyEpoch: 2,
  createdAt: 2,
};

const U32_ONE = [0, 0, 0, 1];
const U32_TWO = [0, 0, 0, 2];
const U64_ONE = [0, 0, 0, 0, 0, 0, 0, 1];
const U64_TWO = [0, 0, 0, 0, 0, 0, 0, 2];

function baseWire(messageId: number): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Message,
    priority: BushMeshPriority.DirectMessage,
    compression: BushMeshCompressionProfile.Raw,
    messageId,
    ackRequested: true,
    storeAndForward: true,
    payload: [0x4f, 0x4b],
  });
}

describe('BushMesh Protocol v1 Security wire contract', () => {
  it('freezes protected direct and group containers', () => {
    const directAad = createBushMeshSecurityProtocolContext(baseWire(42), {
      sourceNodeId: 1,
      destinationNodeId: 2,
    }).authenticatedHeader;
    expect(hex(directAad)).toBe('42 4D 41 01 41 23 2A 03 01 02');

    const direct = encodeBushMeshProtectedDirectContainer({
      routing: {sourceNodeId: 1, destinationNodeId: 2},
      authenticatedHeader: directAad,
      message: {
        securityVersion: 1,
        protocolVersion: 1,
        sessionId: 's',
        keyEpoch: 1,
        counter: '5',
        ciphertext: b64(0xaa, 16),
      },
    });
    expect(direct).toEqual([
      0xb5, 0x53, 0x01, 0x01,
      0x03, 0x01, 0x02,
      0x0a, 0x42, 0x4d, 0x41, 0x01, 0x41, 0x23, 0x2a, 0x03, 0x01, 0x02,
      0x22,
      0x01, 0x01, 0x01, 0x01, 0x73,
      ...U32_ONE,
      0, 0, 0, 0, 0, 0, 0, 5,
      0x10,
      ...repeat(0xaa, 16),
    ]);

    const groupAad = createBushMeshSecurityProtocolContext(baseWire(43), {
      sourceNodeId: 1,
      groupId: 'g',
    }).authenticatedHeader;
    expect(hex(groupAad)).toBe('42 4D 41 01 41 23 2B 05 01 01 67');

    const group = encodeBushMeshProtectedGroupContainer({
      routing: {sourceNodeId: 1, groupId: 'g'},
      authenticatedHeader: groupAad,
      message: {
        securityVersion: 1,
        protocolVersion: 1,
        groupId: 'g',
        epoch: 1,
        senderDeviceId: 'a',
        counter: '7',
        ciphertext: b64(0xbb, 16),
      },
    });
    expect(group).toEqual([
      0xb5, 0x53, 0x01, 0x02,
      0x05, 0x01, 0x01, 0x67,
      0x0b, 0x42, 0x4d, 0x41, 0x01, 0x41, 0x23, 0x2b, 0x05, 0x01, 0x01, 0x67,
      0x24,
      0x01, 0x01, 0x01, 0x01, 0x67,
      ...U32_ONE,
      0x01, 0x61,
      0, 0, 0, 0, 0, 0, 0, 7,
      0x10,
      ...repeat(0xbb, 16),
    ]);

    expect(decodeBushMeshSecurityContainer(direct)).toMatchObject({
      kind: 'protected-direct',
      routing: {sourceNodeId: 1, destinationNodeId: 2},
    });
    expect(decodeBushMeshSecurityContainer(group)).toMatchObject({
      kind: 'protected-group',
      routing: {sourceNodeId: 1, groupId: 'g'},
    });
  });

  it('freezes PairingProof, SessionOffer and SessionResponse', () => {
    const pairing = encodeBushMeshPairingProofContainer({
      identity: identityA,
      challenge: b64(0x0a, 16),
      supportedSecurityVersions: [1],
      supportedProtocolVersions: [1],
      issuedAt: 3,
      signature: b64(0x09, 64),
    });
    expect(pairing).toEqual([
      0xb5, 0x53, 0x01, 0x10, 0x00, 0x00, 0xce, 0x01,
      0x01,
      0x01, 0x01, 0x61,
      ...repeat(0x01, 32),
      ...repeat(0x02, 32),
      ...repeat(0x03, 32),
      ...U32_ONE,
      ...U64_ONE,
      0x00,
      0x10, ...repeat(0x0a, 16),
      0x01, 0x01,
      0x01, 0x01,
      0, 0, 0, 0, 0, 0, 0, 3,
      ...repeat(0x09, 64),
    ]);

    const offer = encodeBushMeshSessionOfferContainer({
      handshakeId: 'h',
      initiator: identityA,
      responderDeviceId: 'b',
      ephemeralAgreementPublicKey: b64(0x04, 32),
      nonce: b64(0x05, 32),
      sendNoncePrefix: b64(0x06, 4),
      supportedSecurityVersions: [1],
      supportedProtocolVersions: [1],
      issuedAt: 4,
      signature: b64(0x07, 64),
    });
    expect(offer).toEqual([
      0xb5, 0x53, 0x01, 0x11, 0x00, 0x00, 0x85, 0x02,
      0x01,
      0x01, 0x68,
      0x01, 0x01, 0x61,
      ...repeat(0x01, 32),
      ...repeat(0x02, 32),
      ...repeat(0x03, 32),
      ...U32_ONE,
      ...U64_ONE,
      0x00,
      0x01, 0x62,
      ...repeat(0x04, 32),
      ...repeat(0x05, 32),
      ...repeat(0x06, 4),
      0x01, 0x01,
      0x01, 0x01,
      0, 0, 0, 0, 0, 0, 0, 4,
      ...repeat(0x07, 64),
    ]);

    const response = encodeBushMeshSessionResponseContainer({
      handshakeId: 'h',
      responder: identityB,
      initiatorDeviceId: 'a',
      ephemeralAgreementPublicKey: b64(0x14, 32),
      nonce: b64(0x15, 32),
      sendNoncePrefix: b64(0x16, 4),
      selectedSecurityVersion: 1,
      selectedProtocolVersion: 1,
      issuedAt: 5,
      signature: b64(0x17, 64),
    });
    expect(response).toEqual([
      0xb5, 0x53, 0x01, 0x12, 0x00, 0x00, 0x83, 0x02,
      0x01,
      0x01, 0x68,
      0x01, 0x01, 0x62,
      ...repeat(0x11, 32),
      ...repeat(0x12, 32),
      ...repeat(0x13, 32),
      ...U32_TWO,
      ...U64_TWO,
      0x00,
      0x01, 0x61,
      ...repeat(0x14, 32),
      ...repeat(0x15, 32),
      ...repeat(0x16, 4),
      0x01, 0x01,
      0, 0, 0, 0, 0, 0, 0, 5,
      ...repeat(0x17, 64),
    ]);

    expect(decodeBushMeshSecurityContainer(pairing)).toMatchObject({
      kind: 'pairing-proof',
    });
    expect(decodeBushMeshSecurityContainer(offer)).toMatchObject({
      kind: 'session-offer',
    });
    expect(decodeBushMeshSecurityContainer(response)).toMatchObject({
      kind: 'session-response',
    });
  });

  it('freezes WrappedGroupKeyDistribution and IdentityRotationProof', () => {
    const distribution = encodeBushMeshWrappedGroupKeyDistributionContainer({
      distributionVersion: 1,
      groupId: 'g',
      epoch: 2,
      senderDeviceId: 'a',
      senderFingerprint: b64(0x03, 32),
      recipientDeviceId: 'b',
      recipientFingerprint: b64(0x13, 32),
      securityVersion: 1,
      protocolVersion: 1,
      sessionId: 's',
      encryptedPayload: {
        securityVersion: 1,
        protocolVersion: 1,
        sessionId: 's',
        keyEpoch: 1,
        counter: '9',
        ciphertext: b64(0x21, 16),
      },
    });
    expect(distribution).toEqual([
      0xb5, 0x53, 0x01, 0x13, 0x00, 0x00, 0x72,
      0x01,
      0x01, 0x67,
      ...U32_TWO,
      0x01, 0x61,
      ...repeat(0x03, 32),
      0x01, 0x62,
      ...repeat(0x13, 32),
      0x01, 0x01,
      0x01, 0x73,
      0x22,
      0x01, 0x01, 0x01, 0x01, 0x73,
      ...U32_ONE,
      0, 0, 0, 0, 0, 0, 0, 9,
      0x10, ...repeat(0x21, 16),
    ]);

    const nextIdentity: BushMeshSecurityDeviceIdentity = {
      identityVersion: 1,
      deviceId: 'a',
      signingPublicKey: b64(0x31, 32),
      agreementPublicKey: b64(0x32, 32),
      fingerprint: b64(0x33, 32),
      keyEpoch: 2,
      createdAt: 1,
      rotatedAt: 6,
    };
    const rotation = encodeBushMeshIdentityRotationProofContainer({
      previousFingerprint: b64(0x03, 32),
      nextIdentity,
      rotatedAt: 6,
      signature: b64(0x34, 64),
    });
    expect(rotation).toEqual([
      0xb5, 0x53, 0x01, 0x14, 0x00, 0x00, 0xe1, 0x01,
      0x01,
      ...repeat(0x03, 32),
      0x01, 0x01, 0x61,
      ...repeat(0x31, 32),
      ...repeat(0x32, 32),
      ...repeat(0x33, 32),
      ...U32_TWO,
      ...U64_ONE,
      0x01,
      0, 0, 0, 0, 0, 0, 0, 6,
      0, 0, 0, 0, 0, 0, 0, 6,
      ...repeat(0x34, 64),
    ]);

    expect(decodeBushMeshSecurityContainer(distribution)).toMatchObject({
      kind: 'wrapped-group-key-distribution',
      value: {groupId: 'g', epoch: 2, sessionId: 's'},
    });
    expect(decodeBushMeshSecurityContainer(rotation)).toMatchObject({
      kind: 'identity-rotation-proof',
      value: {rotatedAt: 6},
    });
  });

  it('rejects unsupported versions, reserved kinds, malformed lengths and trailing fields', () => {
    const valid = encodeBushMeshPairingProofContainer({
      identity: identityA,
      challenge: b64(0x0a, 16),
      supportedSecurityVersions: [1],
      supportedProtocolVersions: [1],
      issuedAt: 3,
      signature: b64(0x09, 64),
    });

    const badVersion = [...valid];
    badVersion[2] = 2;
    expect(() => decodeBushMeshSecurityContainer(badVersion)).toThrow(/version 2/);

    const reservedKind = [...valid];
    reservedKind[3] = 0x15;
    expect(() => decodeBushMeshSecurityContainer(reservedKind)).toThrow(/kind 21/);

    expect(() => decodeBushMeshSecurityContainer(valid.slice(0, -1))).toThrow(
      /Truncated/,
    );
    expect(() => decodeBushMeshSecurityContainer([...valid, 0])).toThrow(
      /trailing|unknown/i,
    );
  });

  it('fragments the final protected container and reassembles it before Security processing', () => {
    const aad = createBushMeshSecurityProtocolContext(baseWire(42), {
      sourceNodeId: 1,
      destinationNodeId: 2,
    }).authenticatedHeader;
    const protectedDatagram = encodeBushMeshProtectedDirectContainer({
      routing: {sourceNodeId: 1, destinationNodeId: 2},
      authenticatedHeader: aad,
      message: {
        securityVersion: 1,
        protocolVersion: 1,
        sessionId: 's',
        keyEpoch: 1,
        counter: '5',
        ciphertext: b64(0xaa, 64),
      },
    });

    const frames = fragmentBushMeshDatagramPayload(protectedDatagram, 900, 18);
    expect(frames.length).toBeGreaterThan(1);
    const reassembler = new BushMeshDatagramFragmentReassembler();
    let finalPayload: number[] | undefined;
    frames.forEach((frame, index) => {
      const result = reassembler.accept(frame, 1000 + index);
      if (result.complete) {
        finalPayload = result.datagramPayload;
      }
    });
    expect(finalPayload).toEqual(protectedDatagram);
    expect(decodeBushMeshSecurityContainer(finalPayload!)).toMatchObject({
      kind: 'protected-direct',
    });
  });
});
