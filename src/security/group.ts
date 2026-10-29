import {Buffer} from 'buffer';
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
import {isSecurityError, SecurityError} from './errors';
import {IdentityManager} from './identity';
import {NonceManager, ReplayProtector} from './nonceReplay';
import type {CryptoProvider, SecureSecretStore, SecurityClock, SecurityMetadataStore} from './ports';
import {systemClock} from './ports';
import type {DirectSessionManager} from './session';
import {groupMessageAad} from './transcripts';
import type {
  EncryptedGroupMessage,
  GroupMembership,
  GroupRecord,
  SecurityProtocolContext,
  WrappedGroupKeyDistribution,
} from './types';
import {PeerTrustManager} from './trust';
import {VersionPolicy} from './versionPolicy';

const ZERO_NONCE_PREFIX = new Uint8Array(4);
const GROUP_KEY_PACKAGE_KIND = 'bushmesh-group-key-distribution-v1';

interface GroupKeyPackageV1 {
  kind: typeof GROUP_KEY_PACKAGE_KIND;
  groupId: string;
  epoch: number;
  securityVersion: number;
  protocolVersion: number;
  senderDeviceId: string;
  senderFingerprint: string;
  recipientDeviceId: string;
  recipientFingerprint: string;
  members: GroupMembership[];
  groupCreatedAt: number;
  issuedAt: number;
  keyMaterial: string;
}

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
    this.assertMembershipSet(resolvedMembers);

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
    const previous = group.keyEpochs.find(epoch => epoch.epoch === group.currentEpoch);
    if (!previous) {
      throw new SecurityError('KEY_NOT_FOUND', 'Group current key epoch metadata is missing');
    }
    const nextEpoch = group.currentEpoch + 1;
    const key = this.crypto.randomBytes(32);
    const keyRef = `group/${groupId}/epoch-${nextEpoch}`;
    const now = this.clock.now();
    try {
      await this.secrets.setSecret(keyRef, key);
    } finally {
      wipe(key);
    }
    const updated: GroupRecord = {
      ...group,
      currentEpoch: nextEpoch,
      keyEpochs: [
        ...group.keyEpochs.map(epoch =>
          epoch.epoch === previous.epoch && epoch.state === 'active'
            ? {...epoch, state: 'rotated' as const, rotatedAt: now}
            : epoch,
        ),
        {epoch: nextEpoch, keyRef, state: 'active', createdAt: now},
      ],
      updatedAt: now,
    };
    await this.metadata.setGroup(updated);
    await this.secrets.deleteSecret(previous.keyRef);
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

  async wrapActiveKeyForPeer(
    groupId: string,
    recipientDeviceId: string,
    sessionId: string,
    sessions: DirectSessionManager,
    context: SecurityProtocolContext,
  ): Promise<WrappedGroupKeyDistribution> {
    const group = await this.requireGroup(groupId);
    this.versions.assertProtocolContext(group.protocolVersion, context.protocolVersion);
    const local = await this.identity.current();
    const senderMember = group.members.find(member => member.deviceId === local.deviceId);
    if (
      !senderMember ||
      senderMember.state !== 'active' ||
      senderMember.role !== 'leader' ||
      senderMember.identityFingerprint !== local.fingerprint
    ) {
      throw new SecurityError('PEER_NOT_TRUSTED', 'Only an active group leader may distribute group keys');
    }
    const recipient = group.members.find(member => member.deviceId === recipientDeviceId);
    if (!recipient || recipient.state !== 'active') {
      throw new SecurityError('PEER_REVOKED', 'Recipient is not an active group member');
    }
    await this.trust.assertTrusted(recipient.deviceId, recipient.identityFingerprint);
    await sessions.assertPeerSession(sessionId, recipient.deviceId, recipient.identityFingerprint);

    const active = this.activeEpoch(group);
    const rootKey = await this.secrets.getSecret(active.keyRef);
    if (!rootKey) {
      throw new SecurityError('KEY_NOT_FOUND', 'Active group key is unavailable');
    }
    try {
      const keyPackage: GroupKeyPackageV1 = {
        kind: GROUP_KEY_PACKAGE_KIND,
        groupId: group.groupId,
        epoch: active.epoch,
        securityVersion: group.securityVersion,
        protocolVersion: group.protocolVersion,
        senderDeviceId: local.deviceId,
        senderFingerprint: local.fingerprint,
        recipientDeviceId: recipient.deviceId,
        recipientFingerprint: recipient.identityFingerprint,
        members: group.members,
        groupCreatedAt: group.createdAt,
        issuedAt: this.clock.now(),
        keyMaterial: toBase64Url(rootKey),
      };
      const encryptedPayload = await sessions.encrypt(
        sessionId,
        utf8(JSON.stringify(keyPackage)),
        context,
      );
      return {
        distributionVersion: 1,
        groupId: group.groupId,
        epoch: active.epoch,
        senderDeviceId: local.deviceId,
        senderFingerprint: local.fingerprint,
        recipientDeviceId: recipient.deviceId,
        recipientFingerprint: recipient.identityFingerprint,
        securityVersion: group.securityVersion,
        protocolVersion: group.protocolVersion,
        sessionId,
        encryptedPayload,
      };
    } finally {
      wipe(rootKey);
    }
  }

  async installWrappedGroupKey(
    distribution: WrappedGroupKeyDistribution,
    sessions: DirectSessionManager,
    context: SecurityProtocolContext,
  ): Promise<GroupRecord> {
    if (distribution.distributionVersion !== 1) {
      throw new SecurityError('UNSUPPORTED_VERSION', 'Unsupported group-key distribution version');
    }
    if (distribution.encryptedPayload.sessionId !== distribution.sessionId) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Wrapped group-key session mismatch');
    }
    const local = await this.identity.current();
    if (
      distribution.recipientDeviceId !== local.deviceId ||
      distribution.recipientFingerprint !== local.fingerprint
    ) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Wrapped group key targets another identity');
    }
    await this.trust.assertTrusted(distribution.senderDeviceId, distribution.senderFingerprint);
    await sessions.assertPeerSession(
      distribution.sessionId,
      distribution.senderDeviceId,
      distribution.senderFingerprint,
    );
    const plaintext = await sessions.decrypt(distribution.encryptedPayload, context);
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(plaintext).toString('utf8'));
    } catch {
      throw new SecurityError('INVALID_INPUT', 'Malformed wrapped group-key payload');
    } finally {
      wipe(plaintext);
    }
    const keyPackage = this.assertKeyPackage(parsed);
    this.assertDistributionMatchesPackage(distribution, keyPackage);
    this.versions.assertProtocolContext(keyPackage.protocolVersion, context.protocolVersion);
    if (!this.versions.supportedSecurityVersions.includes(keyPackage.securityVersion)) {
      throw new SecurityError('UNSUPPORTED_VERSION', 'Unsupported group security version');
    }
    if (!this.versions.supportedProtocolVersions.includes(keyPackage.protocolVersion)) {
      throw new SecurityError('UNSUPPORTED_VERSION', 'Unsupported group protocol version');
    }
    this.assertMembershipSet(keyPackage.members);
    const sender = keyPackage.members.find(member => member.deviceId === keyPackage.senderDeviceId);
    const recipient = keyPackage.members.find(member => member.deviceId === keyPackage.recipientDeviceId);
    if (
      !sender ||
      sender.state !== 'active' ||
      sender.role !== 'leader' ||
      sender.identityFingerprint !== keyPackage.senderFingerprint
    ) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Group key was not distributed by an active leader');
    }
    if (
      !recipient ||
      recipient.state !== 'active' ||
      recipient.identityFingerprint !== keyPackage.recipientFingerprint
    ) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Recipient membership does not match local identity');
    }

    const existing = await this.metadata.getGroup(keyPackage.groupId);
    if (existing && keyPackage.epoch <= existing.currentEpoch) {
      throw new SecurityError('REPLAY_DETECTED', 'Group-key distribution did not advance the local epoch');
    }
    if (
      existing &&
      (existing.securityVersion !== keyPackage.securityVersion ||
        existing.protocolVersion !== keyPackage.protocolVersion ||
        existing.createdAt !== keyPackage.groupCreatedAt)
    ) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Group-key distribution conflicts with group identity');
    }

    const keyMaterial = fromBase64Url(keyPackage.keyMaterial, 32);
    const keyRef = `group/${keyPackage.groupId}/epoch-${keyPackage.epoch}`;
    const now = this.clock.now();
    const previous = existing?.keyEpochs.find(epoch => epoch.epoch === existing.currentEpoch);
    try {
      await this.secrets.setSecret(keyRef, keyMaterial);
      const keyEpochs = existing
        ? [
            ...existing.keyEpochs.map(epoch =>
              epoch.epoch === existing.currentEpoch && epoch.state === 'active'
                ? {...epoch, state: 'rotated' as const, rotatedAt: now}
                : epoch,
            ),
            {epoch: keyPackage.epoch, keyRef, state: 'active' as const, createdAt: now},
          ]
        : [{epoch: keyPackage.epoch, keyRef, state: 'active' as const, createdAt: now}];
      const group: GroupRecord = {
        groupId: keyPackage.groupId,
        securityVersion: keyPackage.securityVersion,
        protocolVersion: keyPackage.protocolVersion,
        currentEpoch: keyPackage.epoch,
        members: keyPackage.members,
        keyEpochs,
        createdAt: keyPackage.groupCreatedAt,
        updatedAt: now,
      };
      await this.metadata.setGroup(group);
      if (previous) {
        await this.secrets.deleteSecret(previous.keyRef);
      }
      return group;
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
    } catch (error) {
      if (isSecurityError(error, 'COUNTER_ROLLBACK')) {
        await this.revokeCurrentEpochForNonceFailure(group, active.epoch, active.keyRef);
      }
      throw error;
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

  private assertMembershipSet(members: GroupMembership[]): void {
    if (!Array.isArray(members) || members.length === 0) {
      throw new SecurityError('INVALID_INPUT', 'Group requires members');
    }
    if (new Set(members.map(member => member.deviceId)).size !== members.length) {
      throw new SecurityError('INVALID_INPUT', 'Group membership contains duplicate device IDs');
    }
    if (!members.some(member => member.role === 'leader' && member.state === 'active')) {
      throw new SecurityError('INVALID_INPUT', 'Group requires at least one active leader');
    }
    for (const member of members) {
      if (
        typeof member.deviceId !== 'string' ||
        typeof member.identityFingerprint !== 'string' ||
        (member.role !== 'leader' && member.role !== 'member') ||
        (member.state !== 'active' && member.state !== 'revoked') ||
        !Number.isSafeInteger(member.joinedAt)
      ) {
        throw new SecurityError('INVALID_INPUT', 'Malformed group membership');
      }
    }
  }

  private assertKeyPackage(value: unknown): GroupKeyPackageV1 {
    if (!value || typeof value !== 'object') {
      throw new SecurityError('INVALID_INPUT', 'Malformed wrapped group-key package');
    }
    const pkg = value as Partial<GroupKeyPackageV1>;
    if (
      pkg.kind !== GROUP_KEY_PACKAGE_KIND ||
      typeof pkg.groupId !== 'string' ||
      !Number.isSafeInteger(pkg.epoch) ||
      (pkg.epoch ?? 0) <= 0 ||
      !Number.isSafeInteger(pkg.securityVersion) ||
      !Number.isSafeInteger(pkg.protocolVersion) ||
      typeof pkg.senderDeviceId !== 'string' ||
      typeof pkg.senderFingerprint !== 'string' ||
      typeof pkg.recipientDeviceId !== 'string' ||
      typeof pkg.recipientFingerprint !== 'string' ||
      !Array.isArray(pkg.members) ||
      !Number.isSafeInteger(pkg.groupCreatedAt) ||
      !Number.isSafeInteger(pkg.issuedAt) ||
      typeof pkg.keyMaterial !== 'string'
    ) {
      throw new SecurityError('INVALID_INPUT', 'Malformed wrapped group-key package');
    }
    if ((pkg.issuedAt as number) > this.clock.now() + 5_000) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Group-key distribution timestamp is in the future');
    }
    fromBase64Url(pkg.keyMaterial, 32);
    return pkg as GroupKeyPackageV1;
  }

  private assertDistributionMatchesPackage(
    distribution: WrappedGroupKeyDistribution,
    pkg: GroupKeyPackageV1,
  ): void {
    if (
      distribution.groupId !== pkg.groupId ||
      distribution.epoch !== pkg.epoch ||
      distribution.senderDeviceId !== pkg.senderDeviceId ||
      distribution.senderFingerprint !== pkg.senderFingerprint ||
      distribution.recipientDeviceId !== pkg.recipientDeviceId ||
      distribution.recipientFingerprint !== pkg.recipientFingerprint ||
      distribution.securityVersion !== pkg.securityVersion ||
      distribution.protocolVersion !== pkg.protocolVersion
    ) {
      throw new SecurityError('AUTHENTICATION_FAILED', 'Wrapped group-key metadata was modified');
    }
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

  private async revokeCurrentEpochForNonceFailure(
    group: GroupRecord,
    epoch: number,
    keyRef: string,
  ): Promise<void> {
    const now = this.clock.now();
    await this.metadata.setGroup({
      ...group,
      keyEpochs: group.keyEpochs.map(record =>
        record.epoch === epoch
          ? {...record, state: 'revoked' as const, revokedAt: now}
          : record,
      ),
      updatedAt: now,
    });
    await this.secrets.deleteSecret(keyRef);
  }

  private async requireGroup(groupId: string): Promise<GroupRecord> {
    const group = await this.metadata.getGroup(groupId);
    if (!group) {
      throw new SecurityError('KEY_NOT_FOUND', `Unknown group ${groupId}`);
    }
    return group;
  }
}
