import {BushMeshPacketType} from './codec';
import {
  decodeBushMeshAckWire,
  encodeBushMeshFragmentAckWire,
} from './acknowledgement';
import {
  BushMeshRetransmissionEngine,
  DueRetransmission,
} from './retransmission';
import {
  BushMeshFrameAcceptResult,
  BushMeshWireReassembler,
  decodeBushMeshWire,
} from './transport';

export type BushMeshReliabilityReceiveResult = {
  receive: BushMeshFrameAcceptResult;
  ackWireBytes?: number[];
};

export class BushMeshReliabilityController {
  readonly retransmissions: BushMeshRetransmissionEngine;
  readonly reassembler: BushMeshWireReassembler;

  constructor(options?: {reassemblyTimeoutMs?: number}) {
    this.retransmissions = new BushMeshRetransmissionEngine();
    this.reassembler = new BushMeshWireReassembler(
      options?.reassemblyTimeoutMs ?? 120000,
    );
  }

  registerOutgoingFragments(
    messageId: number,
    fragmentWireBytes: number[][],
    options?: {
      now?: number;
      maxAttempts?: number;
      baseRetryDelayMs?: number;
    },
  ): void {
    this.retransmissions.registerMessage(messageId, fragmentWireBytes, options);
  }

  markFragmentSent(
    messageId: number,
    fragmentIndex: number,
    now = Date.now(),
  ): void {
    this.retransmissions.markSent(messageId, fragmentIndex, now);
  }

  acceptIncomingWire(
    wireBytes: number[],
    now = Date.now(),
  ): BushMeshReliabilityReceiveResult {
    const receive = this.reassembler.accept(wireBytes, now);
    const decodedOuter = decodeBushMeshWire(wireBytes);

    if (
      decodedOuter.envelope.type !== BushMeshPacketType.Fragment ||
      !receive.reassembly
    ) {
      return {receive};
    }

    const progress = receive.reassembly;
    const missing = new Set(progress.missingFragments);
    const receivedFragments: number[] = [];
    for (let index = 0; index < progress.fragmentCount; index += 1) {
      if (!missing.has(index)) {
        receivedFragments.push(index);
      }
    }

    return {
      receive,
      ackWireBytes: encodeBushMeshFragmentAckWire(
        progress.messageId,
        progress.fragmentCount,
        receivedFragments,
      ),
    };
  }

  acceptAckWire(ackWireBytes: number[]): {
    messageId: number;
    acknowledgedFragments: number[];
    receivedFragments: number[];
    missingFragments: number[];
  } {
    const ackPacket = decodeBushMeshAckWire(ackWireBytes);
    if (ackPacket.kind !== 'fragment') {
      throw new Error('Reliability controller expected a fragment ACK packet.');
    }

    const ack = ackPacket.value;
    const acknowledgedFragments = this.retransmissions.applyAck(ack);
    return {
      messageId: ack.messageId,
      acknowledgedFragments,
      receivedFragments: [...ack.receivedFragments],
      missingFragments: ack.missingFragments,
    };
  }

  dueRetransmissions(now = Date.now()): DueRetransmission[] {
    return this.retransmissions.due(now);
  }

  exhaustedFragments(messageId: number): number[] {
    return this.retransmissions.exhausted(messageId);
  }

  cancel(messageId: number): boolean {
    this.reassembler.reset(messageId);
    return this.retransmissions.cancel(messageId);
  }
}
