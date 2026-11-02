import {Buffer} from 'buffer';

import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
  BushMeshSecurityDeviceIdentity,
  BushMeshSecurityContainerKind,
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
import {BushMeshDatagramFragmentReassembler} from '../src/bushmesh/protocol/transport';

function b64(byte: number, length: number): string {
  return Buffer.alloc(length, byte)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function hex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map(value => value.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

const identityA: BushMeshSecurityDeviceIdentity = {
  identityVersion: 1,
  deviceId: 'bm1_A',
  signingPublicKey: b64(0x01, 32),
  agreementPublicKey: b64(0x02, 32),
  fingerprint: b64(0x03, 32),
  keyEpoch: 1,
  createdAt: 1000,
};

const identityB: BushMeshSecurityDeviceIdentity = {
  identityVersion: 1,
  deviceId: 'bm1_B',
  signingPublicKey: b64(0x11, 32),
  agreementPublicKey: b64(0x12, 32),
  fingerprint: b64(0x13, 32),
  keyEpoch: 2,
  createdAt: 900,
};

function baseWire(messageId = 42): number[] {
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
  it('freezes protected direct and group containers byte-for-byte', () => {
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
        sessionId: 'bms1_S',
        keyEpoch: 1,
        counter: '5',
        ciphertext: b64(0xaa, 16),
      },
    });
    expect(hex(direct)).toBe(
      'B5 53 01 01 03 01 02 0A 42 4D 41 01 41 23 2A 03 01 02 27 01 01 01 06 62 6D 73 31 5F 53 00 00 00 01 00 00 00 00 00 00 00 05 10 AA AA AA AA AA AA AA AA AA AA AA AA AA AA AA AA',
    );

    const groupAad = createBushMeshSecurityProtocolContext(baseWire(43), {
      sourceNodeId: 1,
      groupId: 'bmg1_G',
    }).authenticatedHeader;
    expect(hex(groupAad)).toBe(
      '42 4D 41 01 41 23 2B 05 01 06 62 6D 67 31 5F 47',
    );
    const group = encodeBushMeshProtectedGroupContainer({
      routing: {sourceNodeId: 1, groupId: 'bmg1_G'},
      authenticatedHeader: groupAad,
      message: {
        securityVersion: 1,
        protocolVersion: 1,
        groupId: 'bmg1_G',
        epoch: 1,
        senderDeviceId: 'bm1_A',
        counter: '7',
        ciphertext: b64(0xbb, 16),
      },
    });
    expect(hex(group)).toBe(
      'B5 53 01 02 05 01 06 62 6D 67 31 5F 47 10 42 4D 41 01 41 23 2B 05 01 06 62 6D 67 31 5F 47 2D 01 01 01 06 62 6D 67 31 5F 47 00 00 00 01 05 62 6D 31 5F 41 00 00 00 00 00 00 00 07 10 BB BB BB BB BB BB BB BB BB BB BB BB BB BB BB BB',
    );

    expect(decodeBushMeshSecurityContainer(direct)).toMatchObject({
      kind: 'protected-direct',
      routing: {sourceNodeId: 1, destinationNodeId: 2},
    });
    expect(decodeBushMeshSecurityContainer(group)).toMatchObject({
      kind: 'protected-group',
      routing: {sourceNodeId: 1, groupId: 'bmg1_G'},
    });
  });

  it('freezes pairing and direct-session control objects byte-for-byte', () => {
    const pairing = encodeBushMeshPairingProofContainer({
      identity: identityA,
      challenge: b64(0x0a, 16),
      supportedSecurityVersions: [1],
      supportedProtocolVersions: [1],
      issuedAt: 2000,
      signature: b64(0x09, 64),
    });
    expect(hex(pairing)).toBe(
      'B5 53 01 10 00 00 D2 01 01 01 05 62 6D 31 5F 41 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 00 00 00 01 00 00 00 00 00 00 03 E8 00 10 0A 0A 0A 0A 0A 0A 0A 0A 0A 0A 0A 0A 0A 0A 0A 0A 01 01 01 01 00 00 00 00 00 00 07 D0 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09 09',
    );

    const offer = encodeBushMeshSessionOfferContainer({
      handshakeId: 'bmh1_H',
      initiator: identityA,
      responderDeviceId: 'bm1_B',
      ephemeralAgreementPublicKey: b64(0x04, 32),
      nonce: b64(0x05, 32),
      sendNoncePrefix: b64(0x06, 4),
      supportedSecurityVersions: [1],
      supportedProtocolVersions: [1],
      issuedAt: 3000,
      signature: b64(0x07, 64),
    });
    expect(hex(offer)).toBe(
      'B5 53 01 11 00 00 92 02 01 06 62 6D 68 31 5F 48 01 05 62 6D 31 5F 41 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 00 00 00 01 00 00 00 00 00 00 03 E8 00 05 62 6D 31 5F 42 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 04 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 05 06 06 06 06 01 01 01 01 00 00 00 00 00 00 0B B8 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07 07',
    );

    const response = encodeBushMeshSessionResponseContainer({
      handshakeId: 'bmh1_H',
      responder: identityB,
      initiatorDeviceId: 'bm1_A',
      ephemeralAgreementPublicKey: b64(0x14, 32),
      nonce: b64(0x15, 32),
      sendNoncePrefix: b64(0x16, 4),
      selectedSecurityVersion: 1,
      selectedProtocolVersion: 1,
      issuedAt: 3100,
      signature: b64(0x17, 64),
    });
    expect(hex(response)).toBe(
      'B5 53 01 12 00 00 90 02 01 06 62 6D 68 31 5F 48 01 05 62 6D 31 5F 42 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 11 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 12 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 00 00 00 02 00 00 00 00 00 00 03 84 00 05 62 6D 31 5F 41 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 14 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 15 16 16 16 16 01 01 00 00 00 00 00 00 0C 1C 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17 17',
    );

    expect(decodeBushMeshSecurityContainer(pairing)).toMatchObject({
      kind: 'pairing-proof',
      value: {identity: {deviceId: 'bm1_A'}, issuedAt: 2000},
    });
    expect(decodeBushMeshSecurityContainer(offer)).toMatchObject({
      kind: 'session-offer',
      value: {handshakeId: 'bmh1_H', responderDeviceId: 'bm1_B'},
    });
    expect(decodeBushMeshSecurityContainer(response)).toMatchObject({
      kind: 'session-response',
      value: {handshakeId: 'bmh1_H', initiatorDeviceId: 'bm1_A'},
    });
  });

  it('freezes group-key distribution and identity-rotation controls byte-for-byte', () => {
    const distribution = encodeBushMeshWrappedGroupKeyDistributionContainer({
      distributionVersion: 1,
      groupId: 'bmg1_G',
      epoch: 2,
      senderDeviceId: 'bm1_A',
      senderFingerprint: b64(0x03, 32),
      recipientDeviceId: 'bm1_B',
      recipientFingerprint: b64(0x13, 32),
      securityVersion: 1,
      protocolVersion: 1,
      sessionId: 'bms1_S',
      encryptedPayload: {
        securityVersion: 1,
        protocolVersion: 1,
        sessionId: 'bms1_S',
        keyEpoch: 1,
        counter: '9',
        ciphertext: b64(0x21, 32),
      },
    });
    expect(hex(distribution)).toBe(
      'B5 53 01 13 00 00 99 01 01 06 62 6D 67 31 5F 47 00 00 00 02 05 62 6D 31 5F 41 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 05 62 6D 31 5F 42 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 13 01 01 06 62 6D 73 31 5F 53 37 01 01 01 06 62 6D 73 31 5F 53 00 00 00 01 00 00 00 00 00 00 00 09 20 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21 21',
    );

    const nextIdentity: BushMeshSecurityDeviceIdentity = {
      identityVersion: 1,
      deviceId: 'bm1_A',
      signingPublicKey: b64(0x31, 32),
      agreementPublicKey: b64(0x32, 32),
      fingerprint: b64(0x33, 32),
      keyEpoch: 2,
      createdAt: 1000,
      rotatedAt: 4000,
    };
    const rotation = encodeBushMeshIdentityRotationProofContainer({
      previousFingerprint: b64(0x03, 32),
      nextIdentity,
      rotatedAt: 4000,
      signature: b64(0x34, 64),
    });
    expect(hex(rotation)).toBe(
      'B5 53 01 14 00 00 E5 01 01 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 03 01 05 62 6D 31 5F 41 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 31 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 32 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 33 00 00 00 02 00 00 00 00 00 00 03 E8 01 00 00 00 00 00 00 0F A0 00 00 00 00 00 00 0F A0 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34 34',
    );

    expect(decodeBushMeshSecurityContainer(distribution)).toMatchObject({
      kind: 'wrapped-group-key-distribution',
      value: {groupId: 'bmg1_G', epoch: 2, sessionId: 'bms1_S'},
    });
    expect(decodeBushMeshSecurityContainer(rotation)).toMatchObject({
      kind: 'identity-rotation-proof',
      value: {previousFingerprint: b64(0x03, 32), rotatedAt: 4000},
    });
  });

  it('rejects unsupported versions, unknown kinds, malformed lengths and trailing fields', () => {
    const valid = encodeBushMeshPairingProofContainer({
      identity: identityA,
      challenge: b64(0x0a, 16),
      supportedSecurityVersions: [1],
      supportedProtocolVersions: [1],
      issuedAt: 2000,
      signature: b64(0x09, 64),
    });

    const badVersion = [...valid];
    badVersion[2] = 2;
    expect(() => decodeBushMeshSecurityContainer(badVersion)).toThrow(
      /Unsupported BushMesh Security container version 2/,
    );

    const unknownKind = [...valid];
    unknownKind[3] = 0x15;
    expect(() => decodeBushMeshSecurityContainer(unknownKind)).toThrow(
      /Unsupported BushMesh Security container kind 21/,
    );

    const truncated = valid.slice(0, -1);
    expect(() => decodeBushMeshSecurityContainer(truncated)).toThrow(/Truncated/);

    const trailing = [...valid, 0x00];
    expect(() => decodeBushMeshSecurityContainer(trailing)).toThrow(/trailing|unknown/i);
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
        sessionId: 'bms1_S',
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
