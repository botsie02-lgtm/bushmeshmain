import {assertBytes, assertIntegerInRange} from './codec';
import {FragmentAck} from './fragmentation';

export type BushMeshRetransmissionFragment = {
  fragmentIndex: number;
  bytes: number[];
  attempts: number;
  acknowledged: boolean;
  nextRetryAt: number;
};

type PendingMessage = {
  messageId: number;
  fragments: BushMeshRetransmissionFragment[];
  maxAttempts: number;
  baseRetryDelayMs: number;
  createdAt: number;
};

export type DueRetransmission = {
  messageId: number;
  fragmentIndex: number;
  bytes: number[];
  attempts: number;
};

export class BushMeshRetransmissionEngine {
  private readonly pending = new Map<number, PendingMessage>();

  registerMessage(
    messageId: number,
    fragmentBytes: number[][],
    options?: {
      now?: number;
      maxAttempts?: number;
      baseRetryDelayMs?: number;
    },
  ): void {
    assertIntegerInRange(messageId, 0, 0xffffffff, 'Message ID');

    if (fragmentBytes.length < 1) {
      throw new Error('Retransmission requires at least one fragment.');
    }

    const maxAttempts = options?.maxAttempts ?? 4;
    const baseRetryDelayMs = options?.baseRetryDelayMs ?? 2000;
    const now = options?.now ?? Date.now();

    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error('Max retransmission attempts must be positive.');
    }

    if (!Number.isFinite(baseRetryDelayMs) || baseRetryDelayMs < 0) {
      throw new Error('Base retry delay cannot be negative.');
    }

    const fragments = fragmentBytes.map((bytes, fragmentIndex) => {
      assertBytes(bytes, `fragment ${fragmentIndex}`);
      return {
        fragmentIndex,
        bytes: [...bytes],
        attempts: 0,
        acknowledged: false,
        nextRetryAt: now,
      };
    });

    this.pending.set(messageId, {
      messageId,
      fragments,
      maxAttempts,
      baseRetryDelayMs,
      createdAt: now,
    });
  }

  markSent(
    messageId: number,
    fragmentIndex: number,
    now = Date.now(),
  ): BushMeshRetransmissionFragment {
    const message = this.requireMessage(messageId);
    const fragment = message.fragments[fragmentIndex];

    if (!fragment) {
      throw new Error(`Unknown fragment ${fragmentIndex} for message ${messageId}.`);
    }

    if (fragment.acknowledged) {
      return {...fragment, bytes: [...fragment.bytes]};
    }

    fragment.attempts += 1;
    const exponent = Math.max(0, fragment.attempts - 1);
    fragment.nextRetryAt =
      now + message.baseRetryDelayMs * Math.pow(2, exponent);

    return {...fragment, bytes: [...fragment.bytes]};
  }

  applyAck(ack: FragmentAck): number[] {
    const message = this.pending.get(ack.messageId);

    if (!message) {
      return [];
    }

    if (ack.fragmentCount !== message.fragments.length) {
      throw new Error('ACK fragment count does not match pending message.');
    }

    const acknowledged: number[] = [];

    for (const index of ack.receivedFragments) {
      const fragment = message.fragments[index];

      if (fragment && !fragment.acknowledged) {
        fragment.acknowledged = true;
        acknowledged.push(index);
      }
    }

    if (message.fragments.every(fragment => fragment.acknowledged)) {
      this.pending.delete(ack.messageId);
    }

    return acknowledged;
  }

  due(now = Date.now()): DueRetransmission[] {
    const due: DueRetransmission[] = [];

    for (const message of this.pending.values()) {
      for (const fragment of message.fragments) {
        if (
          !fragment.acknowledged &&
          fragment.attempts < message.maxAttempts &&
          fragment.nextRetryAt <= now
        ) {
          due.push({
            messageId: message.messageId,
            fragmentIndex: fragment.fragmentIndex,
            bytes: [...fragment.bytes],
            attempts: fragment.attempts,
          });
        }
      }
    }

    return due.sort((a, b) =>
      a.messageId === b.messageId
        ? a.fragmentIndex - b.fragmentIndex
        : a.messageId - b.messageId,
    );
  }

  exhausted(messageId: number): number[] {
    const message = this.pending.get(messageId);

    if (!message) {
      return [];
    }

    return message.fragments
      .filter(
        fragment =>
          !fragment.acknowledged && fragment.attempts >= message.maxAttempts,
      )
      .map(fragment => fragment.fragmentIndex);
  }

  isComplete(messageId: number): boolean {
    return !this.pending.has(messageId);
  }

  cancel(messageId: number): boolean {
    return this.pending.delete(messageId);
  }

  clear(): void {
    this.pending.clear();
  }

  snapshot(messageId: number): BushMeshRetransmissionFragment[] | null {
    const message = this.pending.get(messageId);

    return message
      ? message.fragments.map(fragment => ({
          ...fragment,
          bytes: [...fragment.bytes],
        }))
      : null;
  }

  private requireMessage(messageId: number): PendingMessage {
    const message = this.pending.get(messageId);

    if (!message) {
      throw new Error(`Unknown pending message ${messageId}.`);
    }

    return message;
  }
}
