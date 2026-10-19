import {BushMeshPing, createPong, decodePing, encodePing} from './discovery';

export type BushMeshPingResult = {
  nonce: number;
  roundTripMs: number;
  sentAt: number;
  receivedAt: number;
};

type PendingPing = {
  nonce: number;
  sentAt: number;
  expiresAt: number;
};

export class BushMeshDiscoverySession {
  private readonly pending = new Map<number, PendingPing>();
  private nextNonce: number;

  constructor(
    nonceSeed = Date.now() >>> 0,
    private readonly timeoutMs = 15000,
  ) {
    this.nextNonce = nonceSeed === 0 ? 1 : nonceSeed;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Ping timeout must be greater than zero.');
    }
  }

  createPing(now = Date.now()): {ping: BushMeshPing; payload: number[]} {
    const nonce = this.nextNonce;
    this.nextNonce = (this.nextNonce + 1) >>> 0;
    if (this.nextNonce === 0) {
      this.nextNonce = 1;
    }

    const ping: BushMeshPing = {
      nonce,
      senderTimeSeconds: Math.floor(now / 1000),
      response: false,
    };
    this.pending.set(nonce, {
      nonce,
      sentAt: now,
      expiresAt: now + this.timeoutMs,
    });
    return {ping, payload: encodePing(ping)};
  }

  createPongForPayload(
    pingPayload: number[],
    now = Date.now(),
  ): {pong: BushMeshPing; payload: number[]} {
    const ping = decodePing(pingPayload);
    const pong = createPong(ping, Math.floor(now / 1000));
    return {pong, payload: encodePing(pong)};
  }

  acceptPongPayload(
    pongPayload: number[],
    now = Date.now(),
  ): BushMeshPingResult | null {
    const pong = decodePing(pongPayload);
    if (!pong.response) {
      return null;
    }

    const pending = this.pending.get(pong.nonce);
    if (!pending) {
      return null;
    }

    this.pending.delete(pong.nonce);
    return {
      nonce: pong.nonce,
      roundTripMs: Math.max(0, now - pending.sentAt),
      sentAt: pending.sentAt,
      receivedAt: now,
    };
  }

  pruneExpired(now = Date.now()): number[] {
    const expired: number[] = [];
    for (const [nonce, ping] of this.pending.entries()) {
      if (ping.expiresAt <= now) {
        this.pending.delete(nonce);
        expired.push(nonce);
      }
    }
    return expired;
  }

  pendingCount(now = Date.now()): number {
    this.pruneExpired(now);
    return this.pending.size;
  }

  clear(): void {
    this.pending.clear();
  }
}
