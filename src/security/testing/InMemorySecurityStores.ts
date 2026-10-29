import {SecurityError} from '../errors';
import type {SecureSecretStore, SecurityMetadataStore} from '../ports';
import type {
  DeviceIdentity,
  DirectSessionRecord,
  GroupRecord,
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

/** TEST/DEVELOPMENT ONLY. Production nonce/replay operations must be durable and atomic. */
export class InMemorySecurityMetadataStore implements SecurityMetadataStore {
  private identity: DeviceIdentity | null = null;
  private readonly peers = new Map<string, PeerTrustRecord>();
  private readonly pending = new Map<string, PendingHandshakeRecord>();
  private readonly sessions = new Map<string, DirectSessionRecord>();
  private readonly groups = new Map<string, GroupRecord>();
  private readonly nonceCounters = new Map<string, bigint>();
  private readonly replayStates = new Map<string, ReplayState>();

  async getIdentity(): Promise<DeviceIdentity | null> {
    return this.identity ? clone(this.identity) : null;
  }

  async setIdentity(identity: DeviceIdentity): Promise<void> {
    this.identity = clone(identity);
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

  async getSession(sessionId: string): Promise<DirectSessionRecord | null> {
    const record = this.sessions.get(sessionId);
    return record ? clone(record) : null;
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

  async reserveNonceCounter(scope: string): Promise<bigint> {
    const current = this.nonceCounters.get(scope) ?? 0n;
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
      current.bitmap = ((shift >= window ? 0n : current.bitmap << shift) | 1n) & mask;
      current.maxSeen = counter;
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
    current.bitmap |= bit;
    return true;
  }
}
