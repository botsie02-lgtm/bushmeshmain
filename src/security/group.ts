import {
  concatBytes,
  encodeFields,
  fromBase64Url,
  parseCounter,
  toBase64Url,
  u32be,
  utf8,
  wipe,
} from './bytes';
import {SecurityError} from './errors';
import {IdentityManager} from './identity';
import {NonceManager, ReplayProtector} from './nonceReplay';
import type {CryptoProvider, SecureSecretStore, SecurityClock, SecurityMetadataStore} from './ports';
import {systemClock} from './ports';
import {groupMessageAad} from './transcripts';
import type {
  EncryptedGroupMessage,
  GroupMembership,
  GroupRecord,
  SecurityProtocolContext,
} from './types';
import {PeerTrustManager} from './trust';
import {VersionPolicy} from './versionPolicy';

const ZERO_NONCE_PREFIX = new Uint8Array(4);

export class GroupKeyManager {
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
  ) {
    this.nonceManager = new NonceManager(metadata);
    this.replayProtector = new ReplayProtector(metadata);
  }

  async createGroup(
    groupId: string,
    members: Array<{deviceId: string; role: 'leader' | 'member'}>,
    protocolVersion = this.versions.supportedProtocolVersions[0],
  ): Promise<GroupRecord> {
    if (!/^bmg1_[A-Za-z0-9_-]{8,128}$/.test(groupId)) {
      throw new SecurityError('INVALID_INPUT', 'Group ID must be a BushMesh bmg1_ identifier');
    }
    if (await this.metadata.getGroup(groupId)) {
      throw new SecurityError('DUPLICATE_IDENTITY', `Group ${groupId} already exists`);
    }
    if (!this.versions.supportedProtocolVersions.includes(protocolVersion)) {
      throw new SecurityError('UNSUPPORTED_VERSION', 'Unsupported group protocol version');
    }
    const resolvedMembers = await Promise.all(
      members.map(member => this.resolveMembership(member.deviceId, member.role)),
    );
    if (new Set(resolvedMembers.map(member => member.deviceId)).size !== resolvedMembers.length) {
      throw new SecurityError('INVALID_INPUT', 'Group membership contains duplicate device IDs');
    }
    if (!resolvedMembers.some(member => member.role === 'leader')) {
      throw new SecurityError('INVALID_INPUT', 'Group requires at least one leader');
    }

    const key = this.crypto.randomBytes(32);
    const keyRef = `group/${groupId}/epoch-1`;
    const now = this.clock.now();
    try {
      await this.secrets.setSecret(keyRef, key);
    } finally {
      wipe(key);
    }
    const group: GroupRecord = {
      groupId,
      securityVersion: this.versions.supportedSecurityVersions[0],
      protocolVersion,
      currentEpoch: 1,
      members: resolvedMembers,
      keyEpochs: [{epoch: 1, keyRef, state: 'active', createdAt: now}],
      createdAt: now,
      updatedAt: now,
    };
    await this.metadata.setGroup(group);
    return group;
  }

  async rotateGroupKey(groupId: string): Promise<GroupRecord> {
    const group = await this.requireGroup(groupId);
    const active = this.activeEpoch(group);
    const nextEpoch = group.currentEpoch + 1;
    const key = this.crypto.randomBytes(32);
    const keyRef = `group/${groupId}/epoch-${nextEpoch}`;
    const now = this.clock.now();
    try {
      await this.secrets.setSecret(keyRef, key);
    } finally {
      wipe(key);
    }
    await this.secrets.deleteSecret(active.keyRef);
    const updated: GroupRecord = {
      ...group,
      currentEpoch: nextEpoch,
      keyEpochs: [
        ...group.keyEpochs.map(epoch =>
          epoch.epoch === active.epoch ? {...epoch, state: 'rotated' as const, rotatedAt: now} : epoch,
        ),
        {epoch: nextEpoch, keyRef, state: 'active', createdAt: now},
      ],
      updatedAt: now,
    };
    await this.metadata.setGroup(updated);
    return updated;
  }

  async revokeMember(groupId: string, deviceId: string): Promise<GroupRecord> {
    const group = await this.requireGroup(groupId);
    const member = group.members.find(value => value.deviceId === deviceId);
    if (!member || member.state !== 'active') {
      throw new SecurityError('INVALID_INPUT', 'Group member is not active');
    }
    const now = this.clock.now();
    await this.metadata.setGroup({
      ...group,
      members: group.members.map(value =>
        value.deviceId === deviceId ? {...value, state: 'revoked' as const, revokedAt: now} : value,
      ),
      updatedAt: now,
    });
    return this.rotateGroupKey(groupId);
  }

  /**
   * Installs a key obtained through an already-authenticated direct session.
   * Callers must never source keyMaterial from UI state or unauthenticated transport.
   */
  async installGroupKey(group: GroupRecord, keyMaterial: Uint8Array): Promise<void> {
    if (keyMaterial.length !== 32) {
      throw new SecurityError('INVALID_INPUT', 'Group root key must be 32 bytes');
    }
    const active = this.activeEpoch(group);
    try {
      await this.secrets.setSecret(active.keyRef, keyMaterial);
      await this.metadata.setGroup(group);
    } finally {
      wipe(keyMaterial);
    }
  }

  async encrypt(
    groupId: string,
    plaintext: Uint8Array,
    context: SecurityProtocolContext,
  ): Promise<EncryptedGroupMessage> {
    const group = await this.requireGroup(groupId);
    this.versions.assertProtocolContext(group.protocolVersion, context.protocolVersion);
    const local = await this.identity.current();
    const member = group.members.find(value => value.deviceId === local.deviceId);
    if (!member || member.state !== 'active' || member.identityFingerprint !== local.fingerprint) {
      throw new SecurityError('PEER_NOT_TRUSTED', 'Local identity is not an active group member');
    }
    const active = this.activeEpoch(group);
    const rootKey = await this.secrets.getSecret(active.keyRef);
    if (!rootKey) {
      throw new SecurityError('KEY_NOT_FOUND', 'Active group key is unavailable');
    }
    let senderKey: Uint8Array | undefined;
    try {
      senderKey = await this.deriveSenderKey(rootKey, groupId, active.epoch, local.deviceId);
      const prefix = toBase64Url(ZERO_NONCE_PREFIX);
      const {counter, nonce} = await this.nonceManager.next(
        `group/${groupId}/epoch-${active.epoch}/sender/${local.deviceId}`,
        prefix,
      );
      const aad = groupMessageAad(
        groupId,
        local.deviceId,
        group.securityVersion,
        group.protocolVersion,
        active.epoch,
        counter,
        context.authenticatedHeader,
      );
      const ciphertext = await this.crypto.aeadEncrypt(senderKey, nonce, plaintext, aad);
      return {
        securityVersion: group.securityVersion,
        protocolVersion: group.protocolVersion,
        groupId,
        epoch: active.epoch,
        senderDeviceId: local.deviceId,
        counter: counter.toString(),
        ciphertext: toBase64Url(ciphertext),
      };
    } finally {
      wipe(rootKey);
      wipe(senderKey);
    }
  }

  async decrypt(
    envelope: EncryptedGroupMessage,
    context: SecurityProtocolContext,
  ): Promise<Uint8Array> {
    const group = await this.requireGroup(envelope.groupId);
    this.versions.assertProtocolContext(group.protocolVersion, context.protocolVersion);
    if (
      envelope.securityVersion !== group.securityVersion ||
      envelope.protocolVersion !== group.protocolVersion
    ) {
      throw new SecurityError('DOWNGRADE_DETECTED', 'Group message version mismatch');
    }
    if (envelope.epoch !== group.currentEpoch) {
      throw new SecurityError('ROTATED_KEY', 'Group message uses a non-current key epoch');
    }
    const member = group.members.find(value => value.deviceId === envelope.senderDeviceId);
    if (!member || member.state !== 'active') {
      throw new SecurityError('PEER_REVOKED', 'Group sender is not active');
    }
    const local = await this.identity.current();
    if (envelope.senderDeviceId !== local.deviceId) {
      const trusted = await this.trust.assertTrusted(
        envelope.senderDeviceId,
        member.identityFingerprint,
      );
      if (trusted.identity.fingerprint !== member.identityFingerprint) {
        throw new SecurityError('AUTHENTICATION_FAILED', 'Group membership identity changed');
      }
    }

    const active = this.activeEpoch(group);
    const rootKey = await this.secrets.getSecret(active.keyRef);
    if (!rootKey) {
      throw new SecurityError('KEY_NOT_FOUND', 'Active group key is unavailable');
    }
    const counter = parseCounter(envelope.counter);
    let senderKey: Uint8Array | undefined;
    let plaintext: Uint8Array | undefined;
    try {
      senderKey = await this.deriveSenderKey(
        rootKey,
        group.groupId,
        active.epoch,
        envelope.senderDeviceId,
      );
      const nonce = this.nonceManager.fromCounter(toBase64Url(ZERO_NONCE_PREFIX), counter);
      const aad = groupMessageAad(
        group.groupId,
        envelope.senderDeviceId,
        group.securityVersion,
        group.protocolVersion,
        active.epoch,
        counter,
        context.authenticatedHeader,
      );
      plaintext = await this.crypto.aeadDecrypt(
        senderKey,
        nonce,
        fromBase64Url(envelope.ciphertext),
        aad,
      );
      await this.replayProtector.assertFresh(
        `group/${group.groupId}/epoch-${active.epoch}/receiver/${envelope.senderDeviceId}`,
        counter,
      );
      return plaintext;
    } catch (error) {
      wipe(plaintext);
      throw error;
    } finally {
      wipe(rootKey);
      wipe(senderKey);
    }
  }

  private async resolveMembership(
    deviceId: string,
    role: 'leader' | 'member',
  ): Promise<GroupMembership> {
    const local = await this.identity.current();
    const fingerprint =
      deviceId === local.deviceId
        ? local.fingerprint
        : (await this.trust.assertTrusted(deviceId)).identity.fingerprint;
    return {
      deviceId,
      identityFingerprint: fingerprint,
      role,
      state: 'active',
      joinedAt: this.clock.now(),
    };
  }

  private async deriveSenderKey(
    rootKey: Uint8Array,
    groupId: string,
    epoch: number,
    senderDeviceId: string,
  ): Promise<Uint8Array> {
    const salt = await this.crypto.sha256(concatBytes(utf8(groupId), u32be(epoch)));
    return this.crypto.hkdfSha256(
      rootKey,
      salt,
      encodeFields('bushmesh.group-sender-key.v1', [utf8(senderDeviceId)]),
      32,
    );
  }

  private activeEpoch(group: GroupRecord) {
    const active = group.keyEpochs.find(
      epoch => epoch.epoch === group.currentEpoch && epoch.state === 'active',
    );
    if (!active) {
      throw new SecurityError('KEY_NOT_FOUND', 'Group has no active key epoch');
    }
    return active;
  }

  private async requireGroup(groupId: string): Promise<GroupRecord> {
    const group = await this.metadata.getGroup(groupId);
    if (!group) {
      throw new SecurityError('KEY_NOT_FOUND', `Unknown group ${groupId}`);
    }
    return group;
  }
}
