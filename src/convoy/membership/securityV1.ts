import type {
  CryptoProvider,
  SecureSecretStore,
  SecurityMetadataStore,
} from '../../security/ports';
import type {IdentityManager} from '../../security/identity';
import type {GroupKeyManager} from '../../security/group';
import type {DirectSessionManager} from '../../security/session';
import type {PeerTrustManager} from '../../security/trust';
import type {
  DeviceIdentity,
  EncryptedDirectMessage,
  EncryptedGroupMessage,
  GroupRecord,
  PeerTrustRecord,
  SecurityProtocolContext,
  WrappedGroupKeyDistribution,
} from '../../security/types';
import {ConvoyMembershipError} from './model';

export type VerifiedLocalGroup = {
  identity: DeviceIdentity;
  group: GroupRecord;
};

export interface ConvoySecurityV1Port {
  currentIdentity(): Promise<DeviceIdentity>;
  generateReference(prefix: 'bmc1_' | 'bmi1_' | 'bmr1_'): string;
  createOwnerGroup(groupId: string, foundingMemberIds: readonly string[]): Promise<GroupRecord>;
  wrapKeyForPeer(groupId: string, recipientDeviceId: string, sessionId: string, context: SecurityProtocolContext): Promise<WrappedGroupKeyDistribution>;
  verifyLocalGroup(groupId: string): Promise<VerifiedLocalGroup | null>;
  assertTrustedPeer(deviceId: string, fingerprint: string): Promise<PeerTrustRecord>;
  revokeGroupMember(groupId: string, deviceId: string): Promise<GroupRecord>;
  installAuthenticatedDistribution(
    distribution: WrappedGroupKeyDistribution,
    context: SecurityProtocolContext,
  ): Promise<GroupRecord>;
  decryptAuthenticatedJoin(
    message: EncryptedDirectMessage,
    context: SecurityProtocolContext,
    senderDeviceId: string,
    senderFingerprint: string,
  ): Promise<Uint8Array>;
  decryptAuthenticatedPosition(
    message: EncryptedGroupMessage,
    context: SecurityProtocolContext,
  ): Promise<Uint8Array>;
}

/**
 * Use actual frozen Security v1 managers, NOT MeshCore's PSK or an
 * application-authentication flag. Merely seeing a GroupRecord is insufficient:
 * the current local identity must match an active member and the current epoch
 * key must be available in Security v1's protected secret store.
 *
 * The legitimate group record must have originated from createGroup() or
 * installWrappedGroupKey() within the trusted Security v1 persistence boundary.
 * A compromised/untrusted metadata store cannot provide authorisation.
 */
export class SecurityV1ConvoyMembershipAdapter implements ConvoySecurityV1Port {
  constructor(
    private readonly crypto: Pick<CryptoProvider, 'randomBytes'>,
    private readonly identity: Pick<IdentityManager, 'current'>,
    private readonly metadata: Pick<SecurityMetadataStore, 'getGroup'>,
    private readonly secrets: Pick<SecureSecretStore, 'getSecret'>,
    private readonly trust: Pick<PeerTrustManager, 'assertTrusted'>,
    private readonly groups: Pick<
      GroupKeyManager,
      'createGroup' | 'revokeMember' | 'installWrappedGroupKey' | 'wrapActiveKeyForPeer' | 'decrypt'
    >,
    private readonly sessions: DirectSessionManager,
  ) {}

  currentIdentity(): Promise<DeviceIdentity> {
    return this.identity.current();
  }

  generateReference(prefix: 'bmc1_' | 'bmi1_' | 'bmr1_'): string {
    const bytes = this.crypto.randomBytes(16);
    if (bytes.length !== 16) {
      throw new ConvoyMembershipError('SECURITY_UNAVAILABLE', 'Security v1 random source failed');
    }
    const suffix = Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
    bytes.fill(0);
    return prefix + suffix;
  }

  async createOwnerGroup(groupId: string, foundingMemberIds: readonly string[]): Promise<GroupRecord> {
    const identity = await this.currentIdentity();
    return this.groups.createGroup(groupId, [
      {deviceId: identity.deviceId, role: 'leader'},
      ...foundingMemberIds.map(deviceId => ({deviceId, role: 'member' as const})),
    ]);
  }

  wrapKeyForPeer(
    groupId: string,
    recipientDeviceId: string,
    sessionId: string,
    context: SecurityProtocolContext,
  ): Promise<WrappedGroupKeyDistribution> {
    return this.groups.wrapActiveKeyForPeer(
      groupId, recipientDeviceId, sessionId, this.sessions, context,
    );
  }

  async verifyLocalGroup(groupId: string): Promise<VerifiedLocalGroup | null> {
    const identity = await this.currentIdentity();
    const group = await this.metadata.getGroup(groupId);
    if (!group || group.groupId !== groupId ||
      !Number.isSafeInteger(group.currentEpoch) || group.currentEpoch < 1) {
      return null;
    }
    const localMember = group.members.find(value => value.deviceId === identity.deviceId);
    const activeEpoch = group.keyEpochs.find(value =>
      value.epoch === group.currentEpoch && value.state === 'active',
    );
    if (!localMember || localMember.state !== 'active' ||
      localMember.identityFingerprint !== identity.fingerprint ||
      !activeEpoch || activeEpoch.keyRef !==
        'group/' + groupId + '/epoch-' + group.currentEpoch) {
      return null;
    }
    const secret = await this.secrets.getSecret(activeEpoch.keyRef);
    if (!secret) {
      return null;
    }
    try {
      if (secret.length !== 32) {
        return null;
      }
    } finally {
      secret.fill(0);
    }
    return {identity, group};
  }

  assertTrustedPeer(deviceId: string, fingerprint: string): Promise<PeerTrustRecord> {
    return this.trust.assertTrusted(deviceId, fingerprint);
  }

  revokeGroupMember(groupId: string, deviceId: string): Promise<GroupRecord> {
    return this.groups.revokeMember(groupId, deviceId);
  }

  installAuthenticatedDistribution(
    distribution: WrappedGroupKeyDistribution,
    context: SecurityProtocolContext,
  ): Promise<GroupRecord> {
    return this.groups.installWrappedGroupKey(distribution, this.sessions, context);
  }

  async decryptAuthenticatedJoin(
    message: EncryptedDirectMessage,
    context: SecurityProtocolContext,
    senderDeviceId: string,
    senderFingerprint: string,
  ): Promise<Uint8Array> {
    await this.assertTrustedPeer(senderDeviceId, senderFingerprint);
    await this.sessions.assertPeerSession(
      message.sessionId,
      senderDeviceId,
      senderFingerprint,
    );
    // AEAD authenticates sender session and canonical protocol AAD; replay
    // protection is enforced by Security v1, not by transport metadata.
    return this.sessions.decrypt(message, context);
  }

  decryptAuthenticatedPosition(
    message: EncryptedGroupMessage,
    context: SecurityProtocolContext,
  ): Promise<Uint8Array> {
    return this.groups.decrypt(message, context);
  }
}
