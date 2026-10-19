import {BushMeshDeliveryAckStatus, assertIntegerInRange} from '../protocol';

export type BushMeshDeliveryState =
  | 'pending'
  | 'delivered'
  | 'rejected'
  | 'expired';

export type BushMeshTrackedDelivery = {
  messageId: number;
  destinationNodeId: number;
  state: BushMeshDeliveryState;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export class BushMeshDeliveryTracker {
  private readonly deliveries = new Map<number, BushMeshTrackedDelivery>();

  track(
    messageId: number,
    destinationNodeId: number,
    options?: {now?: number; ttlMs?: number},
  ): BushMeshTrackedDelivery {
    assertIntegerInRange(messageId, 0, 0xffffffff, 'Tracked message ID');
    assertIntegerInRange(
      destinationNodeId,
      0,
      0xffffffff,
      'Tracked destination node ID',
    );

    const now = options?.now ?? Date.now();
    const ttlMs = options?.ttlMs ?? 30 * 60 * 1000;

    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Delivery tracking TTL must be greater than zero.');
    }

    const delivery: BushMeshTrackedDelivery = {
      messageId,
      destinationNodeId,
      state: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ttlMs,
    };
    this.deliveries.set(messageId, delivery);
    return {...delivery};
  }

  acknowledge(
    messageId: number,
    sourceNodeId: number,
    status: BushMeshDeliveryAckStatus | number,
    now = Date.now(),
  ): BushMeshTrackedDelivery | null {
    const delivery = this.deliveries.get(messageId);

    if (!delivery || delivery.destinationNodeId !== sourceNodeId) {
      return null;
    }

    delivery.updatedAt = now;
    delivery.state =
      status === BushMeshDeliveryAckStatus.Delivered
        ? 'delivered'
        : status === BushMeshDeliveryAckStatus.Rejected
          ? 'rejected'
          : 'expired';

    return {...delivery};
  }

  get(messageId: number, now = Date.now()): BushMeshTrackedDelivery | null {
    this.prune(now);
    const delivery = this.deliveries.get(messageId);
    return delivery ? {...delivery} : null;
  }

  pending(now = Date.now()): BushMeshTrackedDelivery[] {
    this.prune(now);
    return Array.from(this.deliveries.values())
      .filter(delivery => delivery.state === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(delivery => ({...delivery}));
  }

  recent(now = Date.now()): BushMeshTrackedDelivery[] {
    this.prune(now);
    return Array.from(this.deliveries.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(delivery => ({...delivery}));
  }

  prune(now = Date.now()): number[] {
    const removed: number[] = [];

    for (const [messageId, delivery] of this.deliveries.entries()) {
      if (delivery.expiresAt <= now) {
        if (delivery.state === 'pending') {
          delivery.state = 'expired';
          delivery.updatedAt = now;
        } else {
          this.deliveries.delete(messageId);
          removed.push(messageId);
        }
      }
    }

    return removed;
  }

  clear(): void {
    this.deliveries.clear();
  }
}
