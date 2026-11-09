import type {IdentityManager} from '../../security/identity';
import type {DeviceIdentity} from '../../security/types';
import {encodeFields, fromBase64Url, toBase64Url, utf8} from '../../security/bytes';
import {
  RoleCredentialClaimsV2, SignedRoleCredentialV2,
  EnrolmentProposalV2, SignedEnrolmentApprovalV2,
  assertEnrolmentProposal, assertSignedApproval,
  assertRoleCredentialClaims, assertSignedRoleCredential,
} from './contract';

const ROLE_DOMAIN = 'bushmesh-security-v2-role-credential-signature-v1';

/**
 * Canonical signing preimage. Domain and each fixed-order UTF-8 field are
 * length-delimited. This protects the signed role CLAIMS only; actual convoy
 * authority also requires an independently anchored owner chain and Security
 * v2 epoch/role state, which Security v1 does NOT provide.
 */
export function roleCredentialTranscript(claims: RoleCredentialClaimsV2): Uint8Array {
  assertRoleCredentialClaims(claims);
  return encodeFields(ROLE_DOMAIN, [
    utf8(claims.schema),
    utf8(String(claims.version)),
    utf8(claims.credentialId),
    utf8(claims.convoyId),
    utf8(claims.groupId),
    utf8(claims.ownerAnchorFingerprint),
    utf8(claims.subject.deviceId),
    utf8(claims.subject.fingerprint),
    utf8(String(claims.subject.keyEpoch)),
    utf8(claims.role),
    utf8(claims.issuer.deviceId),
    utf8(claims.issuer.fingerprint),
    utf8(String(claims.issuer.keyEpoch)),
    utf8(String(claims.authoritySequence)),
    utf8(String(claims.groupEpoch)),
    utf8(String(claims.issuedAt)),
    utf8(String(claims.expiresAt)),
  ]);
}

export function approvalTranscript(proposal: EnrolmentProposalV2): Uint8Array {
  assertEnrolmentProposal(proposal);
  return encodeFields('bushmesh-security-v2-enrolment-approval-v1', [
    utf8(proposal.schema), utf8(String(proposal.version)), utf8(proposal.operation),
    utf8(proposal.transactionId), utf8(proposal.requestId),
    utf8(proposal.convoyId), utf8(proposal.groupId),
    utf8(proposal.requester.deviceId), utf8(proposal.requester.fingerprint),
    utf8(String(proposal.requester.keyEpoch)),
    utf8(proposal.approver.deviceId), utf8(proposal.approver.fingerprint),
    utf8(String(proposal.approver.keyEpoch)),
    utf8(String(proposal.expectedEpoch)), utf8(String(proposal.nextEpoch)),
    utf8(proposal.rosterDigestBefore), utf8(proposal.rosterDigestAfter),
    utf8(proposal.credentialId),
    utf8(String(proposal.issuedAt)), utf8(String(proposal.expiresAt)),
  ]);
}

/**
 * Signs with frozen IdentityManager, without exporting a private key. Merely
 * obtaining a signature from any identity does not appoint it owner/admin.
 */
export async function signRoleCredentialClaims(
  signer: Pick<IdentityManager, 'current' | 'sign'>,
  claims: RoleCredentialClaimsV2,
): Promise<SignedRoleCredentialV2> {
  const local = await signer.current();
  if (local.deviceId !== claims.issuer.deviceId ||
      local.fingerprint !== claims.issuer.fingerprint ||
      local.keyEpoch !== claims.issuer.keyEpoch) {
    throw new Error('Role claim issuer is not the signing identity');
  }
  const signature = await signer.sign(roleCredentialTranscript(claims));
  return {...claims, signature: toBase64Url(signature)};
}

export type RoleSignatureInspection = {
  /** Deliberately NOT a role grant or an authorisation to enrol. */
  result: 'valid-signature-only';
  issuerDeviceId: string;
  credentialId: string;
};

/**
 * Verifies Ed25519 signature using frozen Security v1 IdentityManager. No
 * authorisation conclusion is possible without a trusted, persisted owner
 * anchor and revocation/role-chain high-water source.
 */
export async function inspectRoleCredentialSignature(
  verifier: Pick<IdentityManager, 'verify'>,
  credential: SignedRoleCredentialV2,
  issuerIdentity: DeviceIdentity,
  atMs: number,
  expectedGroupId: string,
  expectedGroupEpoch: number,
): Promise<RoleSignatureInspection> {
  assertSignedRoleCredential(credential);
  if (credential.groupId !== expectedGroupId ||
      credential.groupEpoch !== expectedGroupEpoch ||
      issuerIdentity.deviceId !== credential.issuer.deviceId ||
      issuerIdentity.fingerprint !== credential.issuer.fingerprint ||
      issuerIdentity.keyEpoch !== credential.issuer.keyEpoch ||
      !Number.isSafeInteger(atMs) ||
      credential.issuedAt > atMs + 5000 || credential.expiresAt <= atMs) {
    throw new Error('Role credential identity, epoch or validity mismatch');
  }
  const {signature, ...claims} = credential;
  const verified = await verifier.verify(
    issuerIdentity,
    roleCredentialTranscript(claims),
    fromBase64Url(signature, 64),
  );
  if (!verified) {
    throw new Error('Role credential signature invalid');
  }
  return {result: 'valid-signature-only', issuerDeviceId: issuerIdentity.deviceId,
    credentialId: credential.credentialId};
}

/**
 * Creates a SIGNED CLAIM, not an executable join approval. Frozen Security v1
 * does not know the authority anchor or role revocation chain.
 */
export async function signProposedApproval(
  signer: Pick<IdentityManager, 'current' | 'sign'>,
  proposal: EnrolmentProposalV2,
  credential: SignedRoleCredentialV2,
): Promise<SignedEnrolmentApprovalV2> {
  assertEnrolmentProposal(proposal);
  assertSignedRoleCredential(credential);
  const approver = await signer.current();
  if (approver.deviceId !== proposal.approver.deviceId ||
      approver.fingerprint !== proposal.approver.fingerprint ||
      approver.keyEpoch !== proposal.approver.keyEpoch ||
      proposal.groupId !== credential.groupId ||
      proposal.convoyId !== credential.convoyId ||
      proposal.credentialId !== credential.credentialId ||
      proposal.approver.deviceId !== credential.subject.deviceId ||
      proposal.approver.fingerprint !== credential.subject.fingerprint ||
      proposal.approver.keyEpoch !== credential.subject.keyEpoch ||
      proposal.expectedEpoch !== credential.groupEpoch) {
    throw new Error('Signing identity and credential do not match the proposed approval');
  }
  const signature = await signer.sign(approvalTranscript(proposal));
  return {kind: 'approval', proposal, credential, signature: toBase64Url(signature)};
}

/** Cryptographic signature inspection ONLY, never an owner/admin permission. */
export async function inspectProposedApprovalSignatures(
  verifier: Pick<IdentityManager, 'verify'>,
  approval: SignedEnrolmentApprovalV2,
  credentialIssuer: DeviceIdentity,
  approvalSigner: DeviceIdentity,
  atMs: number,
  expectedGroupEpoch: number,
): Promise<'signatures-valid-only'> {
  assertSignedApproval(approval);
  const {proposal, credential, signature} = approval;
  if (proposal.expectedEpoch !== expectedGroupEpoch ||
      !Number.isSafeInteger(atMs) ||
      proposal.issuedAt > atMs + 5000 || proposal.expiresAt <= atMs ||
      credential.expiresAt <= atMs ||
      approvalSigner.deviceId !== proposal.approver.deviceId ||
      approvalSigner.fingerprint !== proposal.approver.fingerprint ||
      approvalSigner.keyEpoch !== proposal.approver.keyEpoch) {
    throw new Error('Proposed approval is stale or signer identity differs');
  }
  await inspectRoleCredentialSignature(
    verifier, credential, credentialIssuer, atMs, proposal.groupId, expectedGroupEpoch,
  );
  const valid = await verifier.verify(
    approvalSigner, approvalTranscript(proposal), fromBase64Url(signature, 64),
  );
  if (!valid) {
    throw new Error('Proposed approval signature invalid');
  }
  return 'signatures-valid-only';
}
