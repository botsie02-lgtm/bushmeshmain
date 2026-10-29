import {SecurityError} from '../errors';
import type {SecureSecretStore, SecurityMetadataStore} from '../ports';
import type {
  DeviceIdentity,
  DirectSessionRecord,
  GroupRecord,
  LocalIdentityKeyHandles,
  PeerTrustRecord,
  PendingHandshakeRecord,
} from '../types';

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** TEST/DEVELOPMENT ONLY. Never use this implementation for production secrets. */
export class InMemorySecretStore implements SecureSecretStore {
  private readonly secrets = new Map<string, Uint8Array>();

  async setSecret(name: string, value: Uint8Array): Promise<void> {
    this.secrets.set(name, value.slice());
  }

  async getSecret(name: string): Promise<Uint8Array | null> {
    return this.secrets.get(name)?.slice() ?? null;
  }

  async deleteSecret(name: string): Promise<void> {
    this.secrets.delete(name);
  }

  has(name: string): boolean {
    return this.secrets.has(name);
  }
}

interface ReplayState {
  maxSeen: bigint;
  bitmap: bigint;
}

/**
 * TEST/DEVELOPMENT ONLY. The separate nonceCounters and nonceHighWatermarks
 * maps intentionally model two persistence domains so rollback detection can be
 * tested. Production implementations must provide equivalent atomic/durable
 * semantics with a platform-appropriate protected high-watermark.
 */
export class InMemorySecurityMetadataStore implements SecurityMetadataStore {
  private identity: DeviceIdentity | null = null;
  private identityKeyHandles: LocalIdentityKeyHandles | null = null;
  private readonly peers = new Map<string, PeerTrustRecord>();
  private readonly pending = new Map<string, PendingHandshakeRecord>();
  private readonly consumedHandshakes = new Map<string, number>();
  private readonly sessions = new Map<string, DirectSessionRecord>();
  private readonly groups = new Map<string, GroupRecord>();
  private readonly nonceCounters = new Map<string, bigint>();
  private readonly nonceHighWatermarks = new Map<string, bigint>();
  private readonly replayStates = new Map<string, ReplayState>();

  async getIdentity(): Promise<DeviceIdentity | null> {
    return this.identity ? clone(this.identity) : null;
  }

  async setIdentity(identity: DeviceIdentity): Promise<void> {
    this.identity = clone(identity);
  }

  async getIdentityKeyHandles(): Promise<LocalIdentityKeyHandles | null> {
    return this.identityKeyHandles ? clone(this.identityKeyHandles) : null;
  }

  async setIdentityKeyHandles(handles: LocalIdentityKeyHandles): Promise<void> {
    this.identityKeyHandles = clone(handles);
  }

  async listPeers(): Promise<PeerTrustRecord[]> {
    return [...this.peers.values()].map(clone);
  }

  async getPeer(deviceId: string): Promise<PeerTrustRecord | null> {
    const record = this.peers.get(deviceId);
    return record ? clone(record) : null;
  }

  async setPeer(record: PeerTrustRecord): Promise<void> {
    this.peers.set(record.deviceId, clone(record));
  }

  async getPendingHandshake(handshakeId: string): Promise<PendingHandshakeRecord | null> {
    const record = this.pending.get(handshakeId);
    return record ? clone(record) : null;
  }

  async setPendingHandshake(record: PendingHandshakeRecord): Promise<void> {
    this.pending.set(record.handshakeId, clone(record));
  }

  async deletePendingHandshake(handshakeId: string): Promise<void> {
    this.pending.delete(handshakeId);
  }

  async consumeHandshakeId(handshakeId: string, expiresAt: number): Promise<boolean> {
    if (this.consumedHandshakes.has(handshakeId)) {
      return false;
    }
    this.consumedHandshakes.set(handshakeId, expiresAt);
    return true;
  }

  async getSession(sessionId: string): Promise<DirectSessionRecord | null> {
    const record = this.sessions.get(sessionId);
    return record ? clone(record) : null;
  }

  async listSessions(peerDeviceId?: string): Promise<DirectSessionRecord[]> {
    return [...this.sessions.values()]
      .filter(record => peerDeviceId === undefined || record.peerDeviceId === peerDeviceId)
      .map(clone);
  }

  async setSession(record: DirectSessionRecord): Promise<void> {
    this.sessions.set(record.sessionId, clone(record));
  }

  async getGroup(groupId: string): Promise<GroupRecord | null> {
    const record = this.groups.get(groupId);
    return record ? clone(record) : null;
  }

  async setGroup(record: GroupRecord): Promise<void> {
    this.groups.set(record.groupId, clone(record));
  }

  async getNonceHighWatermark(scope: string): Promise<bigint> {
    return this.nonceHighWatermarks.get(scope) ?? 0n;
  }

  async advanceNonceHighWatermark(scope: string, counter: bigint): Promise<void> {
    if (counter < 0n || counter > 0xffffffffffffffffn) {
      throw new SecurityError('INVALID_INPUT', 'Nonce high-watermark is outside u64 range');
    }
    const current = this.nonceHighWatermarks.get(scope) ?? 0n;
    if (counter > current) {
      this.nonceHighWatermarks.set(scope, counter);
    }
  }

  async reserveNonceCounter(scope: string, minimumHighWatermark: bigint): Promise<bigint> {
    const current = this.nonceCounters.get(scope) ?? 0n;
    if (current < minimumHighWatermark) {
      throw new SecurityError(
        'COUNTER_ROLLBACK',
        `Nonce counter for ${scope} rolled back below its protected high-watermark`,
      );
    }
    if (current >= 0xffffffffffffffffn) {
      throw new SecurityError('NONCE_EXHAUSTED', 'Nonce counter exhausted');
    }
    const next = current + 1n;
    this.nonceCounters.set(scope, next);
    return next;
  }

  async acceptReplayCounter(scope: string, counter: bigint, windowSize: number): Promise<boolean> {
    if (counter <= 0n) {
      return false;
    }
    const current = this.replayStates.get(scope);
    if (!current) {
      this.replayStates.set(scope, {maxSeen: counter, bitmap: 1n});
      return true;
    }

    const window = BigInt(windowSize);
    const mask = (1n << window) - 1n;
    if (counter > current.maxSeen) {
      const shift = counter - current.maxSeen;
      const bitmap = ((shift >= window ? 0n : current.bitmap << shift) | 1n) & mask;
      this.replayStates.set(scope, {maxSeen: counter, bitmap});
      return true;
    }

    const delta = current.maxSeen - counter;
    if (delta >= window) {
      return false;
    }
    const bit = 1n << delta;
    if ((current.bitmap & bit) !== 0n) {
      return false;
    }
    this.replayStates.set(scope, {maxSeen: current.maxSeen, bitmap: current.bitmap | bit});
    return true;
  }

  /** Test-only fault injection for rollback/recovery scenarios. */
  unsafeSetNonceCounter(scope: string, value: bigint): void {
    this.nonceCounters.set(scope, value);
  }

  /** Test-only fault injection for rollback/recovery scenarios. */
  unsafeSetNonceHighWatermark(scope: string, value: bigint): void {
    this.nonceHighWatermarks.set(scope, value);
  }

  /** Test-only fault injection for stale replay-window scenarios. */
  unsafeSetReplayState(scope: string, maxSeen: bigint, bitmap: bigint): void {
    this.replayStates.set(scope, {maxSeen, bitmap});
  }
}
