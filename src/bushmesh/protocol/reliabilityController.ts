import {
  BushMeshCompressionProfile,
  BushMeshPacketType,
  BushMeshPriority,
} from './codec';
import {decodeFragmentAck, encodeFragmentAck} from './fragmentation';
import {
  BushMeshRetransmissionEngine,
  DueRetransmission,
} from './retransmission';
import {
  BushMeshFrameAcceptResult,
  BushMeshWireReassembler,
  decodeBushMeshWire,
  encodeBushMeshWire,
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

    const ackPayload = encodeFragmentAck(
      progress.messageId,
      progress.fragmentCount,
      receivedFragments,
    );
    const ackWireBytes = encodeBushMeshWire({
      type: BushMeshPacketType.Ack,
      priority: BushMeshPriority.DirectMessage,
      compression: BushMeshCompressionProfile.Raw,
      messageId: progress.messageId,
      ackRequested: false,
      payload: ackPayload,
    });

    return {receive, ackWireBytes};
  }

  acceptAckWire(ackWireBytes: number[]): {
    messageId: number;
    acknowledgedFragments: number[];
    receivedFragments: number[];
    missingFragments: number[];
  } {
    const decoded = decodeBushMeshWire(ackWireBytes);
    if (decoded.envelope.type !== BushMeshPacketType.Ack) {
      throw new Error('Reliability controller expected an ACK packet.');
    }

    const ack = decodeFragmentAck(decoded.envelope.payload);
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
