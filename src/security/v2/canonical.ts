import {encodeFields, fromBase64Url, toBase64Url, utf8} from '../bytes';
import type {CryptoProvider} from '../ports';
import type {EnrolmentProposalV2, RoleCredentialClaimsV2} from '../../convoy/enrolmentV3/contract';
import type {
  BoundEpochDistributionV2, GroupSnapshotV2, InstalledAckV2, PrincipalV2,
  RoleRevocationV2, RosterMemberV2, SignedJoinRequestV2, SignedOwnerGenesisV2,
} from './contracts';
import {SecurityV2Error} from './contracts';

export function assertPrincipalV2(value: PrincipalV2): void {
  if (!value || !/^bm1_[A-Za-z0-9_-]{8,128}$/.test(value.deviceId) ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(value.fingerprint) ||
      !Number.isSafeInteger(value.keyEpoch) || value.keyEpoch < 1) {
    throw new SecurityV2Error('INVALID_INPUT', 'Malformed pinned identity');
  }
}
export function samePrincipal(a: PrincipalV2, b: PrincipalV2): boolean {
  return a.deviceId === b.deviceId && a.fingerprint === b.fingerprint &&
    a.keyEpoch === b.keyEpoch;
}
export function assertReferenceV2(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
    throw new SecurityV2Error('INVALID_INPUT', 'Invalid Security v2 reference');
  }
}
/** Object key ordering is fixed; these are *not* the Protocol v1 wire bytes. */
export function canonicalValue(value: unknown): string {
  if (value === null) {return 'null';}
  if (typeof value === 'string') {return JSON.stringify(value);}
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {return value ? 'true' : 'false';}
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalValue).join(',') + ']';
  }
  if (value && typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype) {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort()
      .map(k => JSON.stringify(k) + ':' + canonicalValue(obj[k])).join(',') + '}';
  }
  throw new SecurityV2Error('INVALID_INPUT', 'Unsupported canonical signature value');
}
export function principalTranscript(p: PrincipalV2): Uint8Array[] {
  return [utf8(p.deviceId), utf8(p.fingerprint), utf8(String(p.keyEpoch))];
}
export function genesisTranscript(v: SignedOwnerGenesisV2): Uint8Array {
  return encodeFields('bushmesh-security-v2-owner-genesis-v1', [
    utf8(v.kind), utf8(String(v.version)), utf8(v.convoyId), utf8(v.groupId),
    utf8(v.owner.deviceId), utf8(v.owner.fingerprint),
    utf8(v.owner.signingPublicKey), utf8(v.owner.agreementPublicKey),
    utf8(String(v.owner.keyEpoch)), utf8(String(v.protocolVersion)),
    utf8(String(v.createdAt)),
  ]);
}
export function joinTranscript(v: SignedJoinRequestV2): Uint8Array {
  return encodeFields('bushmesh-security-v2-signed-join-v1', [
    utf8(v.kind), utf8(String(v.version)), utf8(v.convoyId),
    utf8(v.groupId), utf8(v.requestId), ...principalTranscript(v.requester),
    utf8(String(v.expectedEpoch)), utf8(v.aadDigest),
    utf8(String(v.issuedAt)), utf8(String(v.expiresAt)),
  ]);
}
/** Byte-for-byte compatible with the existing review-only v3 proposal. */
export function roleCredentialTranscriptV2(v: RoleCredentialClaimsV2): Uint8Array {
  return encodeFields('bushmesh-security-v2-role-credential-signature-v1', [
    utf8(v.schema), utf8(String(v.version)), utf8(v.credentialId),
    utf8(v.convoyId), utf8(v.groupId), utf8(v.ownerAnchorFingerprint),
    ...principalTranscript(v.subject), utf8(v.role),
    ...principalTranscript(v.issuer), utf8(String(v.authoritySequence)),
    utf8(String(v.groupEpoch)), utf8(String(v.issuedAt)),
    utf8(String(v.expiresAt)),
  ]);
}
/** Byte-for-byte compatible with existing signed approval proposal. */
export function approvalTranscriptV2(v: EnrolmentProposalV2): Uint8Array {
  return encodeFields('bushmesh-security-v2-enrolment-approval-v1', [
    utf8(v.schema), utf8(String(v.version)), utf8(v.operation),
    utf8(v.transactionId), utf8(v.requestId),
    utf8(v.convoyId), utf8(v.groupId),
    ...principalTranscript(v.requester), ...principalTranscript(v.approver),
    utf8(String(v.expectedEpoch)), utf8(String(v.nextEpoch)),
    utf8(v.rosterDigestBefore), utf8(v.rosterDigestAfter),
    utf8(v.credentialId), utf8(String(v.issuedAt)),
    utf8(String(v.expiresAt)),
  ]);
}
export function roleRevocationTranscript(v: RoleRevocationV2): Uint8Array {
  return encodeFields('bushmesh-security-v2-role-revocation-v1', [
    utf8(v.kind), utf8(String(v.version)), utf8(v.groupId),
    utf8(v.credentialId), ...principalTranscript(v.issuer),
    utf8(String(v.expectedAuthoritySequence)),
    utf8(String(v.nextAuthoritySequence)), utf8(String(v.issuedAt)),
  ]);
}
export function ackTranscript(v: InstalledAckV2): Uint8Array {
  return encodeFields('bushmesh-security-v2-install-ack-v1', [
    utf8(v.kind), utf8(String(v.version)), utf8(v.transactionId),
    utf8(v.groupId), utf8(String(v.committedEpoch)),
    utf8(v.rosterDigest), utf8(v.distributionDigest),
    ...principalTranscript(v.recipient), utf8(String(v.issuedAt)),
  ]);
}
export function distributionTranscript(v: BoundEpochDistributionV2): Uint8Array {
  // Every encrypted envelope byte is signed via its canonical digest, not an
  // untrusted JSON serializer's current property order.
  return encodeFields('bushmesh-security-v2-epoch-distribution-v1', [
    utf8(v.kind), utf8(String(v.version)), utf8(v.transactionId),
    utf8(v.convoyId), utf8(v.groupId), utf8(String(v.committedEpoch)),
    utf8(v.rosterDigest), utf8(v.genesisDigest),
    ...principalTranscript(v.sender), ...principalTranscript(v.recipient),
    utf8(v.aadDigest), utf8(canonicalValue(v.encryptedPayload)),
    utf8(canonicalValue(v.snapshot)), utf8(canonicalValue(v.join)),
    utf8(canonicalValue(v.approval)),
  ]);
}
export function sortedRoster(roster: RosterMemberV2[]): RosterMemberV2[] {
  if (!Array.isArray(roster) || roster.length < 1 || roster.length > 256) {
    throw new SecurityV2Error('INVALID_INPUT', 'Invalid roster length');
  }
  for (const m of roster) {
    assertPrincipalV2(m);
    if (!['active', 'pending-install', 'revoked'].includes(m.state) ||
        !Number.isSafeInteger(m.joinedAt) || m.joinedAt < 1 ||
        (m.revokedAt !== undefined && (!Number.isSafeInteger(m.revokedAt) || m.revokedAt < m.joinedAt))) {
      throw new SecurityV2Error('INVALID_INPUT', 'Malformed roster member');
    }
  }
  const ordered = [...roster].sort((a,b)=>a.deviceId.localeCompare(b.deviceId));
  if (ordered.some((m,i)=>i>0 && m.deviceId === ordered[i-1].deviceId)) {
    throw new SecurityV2Error('CONFLICT', 'Duplicate device ID in roster');
  }
  return ordered;
}
export async function rosterDigestV2(
  crypto: Pick<CryptoProvider, 'sha256'>,
  groupId: string, epoch: number, roster: RosterMemberV2[],
): Promise<string> {
  if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch > 0xffffffff) {
    throw new SecurityV2Error('INVALID_INPUT', 'Invalid group epoch');
  }
  const fields: Uint8Array[] = [utf8(groupId), utf8(String(epoch))];
  for (const m of sortedRoster(roster)) {
    fields.push(...principalTranscript(m), utf8(m.state),
      utf8(String(m.joinedAt)), utf8(String(m.revokedAt ?? 0)));
  }
  return toBase64Url(await crypto.sha256(
    encodeFields('bushmesh-security-v2-roster-digest-v1', fields),
  ));
}
export async function canonicalDigestV2(crypto: Pick<CryptoProvider, 'sha256'>,
  domain: string, obj: unknown): Promise<string> {
  return toBase64Url(await crypto.sha256(
    encodeFields(domain, [utf8(canonicalValue(obj))]),
  ));
}
export async function aadDigestV2(crypto: Pick<CryptoProvider, 'sha256'>,
  bytes: Uint8Array): Promise<string> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes.length > 1024) {
    throw new SecurityV2Error('INVALID_INPUT', 'Missing or unreasonable Protocol v1 AAD bytes');
  }
  return toBase64Url(await crypto.sha256(
    encodeFields('bushmesh-security-v2-protocol-aad-v1', [bytes]),
  ));
}
export function signatureBytes(signature: string): Uint8Array {
  return fromBase64Url(signature, 64);
}
export function encodeSignature(bytes: Uint8Array): string {
  if (bytes.length !== 64) {throw new SecurityV2Error('INVALID_INPUT', 'Unexpected Ed25519 signature length');}
  return toBase64Url(bytes);
}
export function assertSnapshotShape(snapshot: GroupSnapshotV2): void {
  if (!snapshot || snapshot.version !== 2 || snapshot.groupId !== snapshot.genesis?.groupId ||
      snapshot.convoyId !== snapshot.genesis.convoyId ||
      !/^bmg1_[A-Za-z0-9_-]{8,128}$/.test(snapshot.groupId) ||
      !Number.isSafeInteger(snapshot.epoch) || snapshot.epoch < 1 ||
      !Number.isSafeInteger(snapshot.protocolVersion) || snapshot.protocolVersion < 1 ||
      snapshot.protocolVersion !== snapshot.genesis.protocolVersion ||
      !Number.isSafeInteger(snapshot.authoritySequence) || snapshot.authoritySequence < 1 ||
      !['active', 'invalidated'].includes(snapshot.state) ||
      !Array.isArray(snapshot.revokedCredentials) ||
      new Set(snapshot.revokedCredentials).size !== snapshot.revokedCredentials.length) {
    throw new SecurityV2Error('CORRUPT_STATE', 'Malformed Security v2 group snapshot');
  }
  sortedRoster(snapshot.roster);
}
