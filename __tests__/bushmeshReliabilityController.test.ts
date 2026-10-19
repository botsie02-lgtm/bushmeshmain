import {
  BushMeshReliabilityController,
  BushMeshPacketType,
  SemanticIntent,
  decodeBushMeshWire,
  encodeBushMeshTextMessage,
  fragmentBushMeshWireMessage,
  tryParseSemanticText,
} from '../src/bushmesh/protocol';

describe('Bushmesh reliability controller and expanded semantic intents', () => {
  test('receiver generates ACK bitmaps and sender only retries missing fragments', () => {
    const messageId = 91;
    const encoded = encodeBushMeshTextMessage(
      'This deliberately long test message is fragmented into several Bushmesh packets.',
      messageId,
      {semantic: false},
    );
    const fragments = fragmentBushMeshWireMessage(encoded.wireBytes, messageId, 12);
    expect(fragments.length).toBeGreaterThan(2);

    const sender = new BushMeshReliabilityController();
    const receiver = new BushMeshReliabilityController();
    sender.registerOutgoingFragments(messageId, fragments, {
      now: 0,
      baseRetryDelayMs: 100,
      maxAttempts: 3,
    });

    fragments.forEach((_, index) => sender.markFragmentSent(messageId, index, 0));

    const first = receiver.acceptIncomingWire(fragments[0], 10);
    expect(first.receive.complete).toBe(false);
    expect(first.ackWireBytes).toBeDefined();

    const firstAck = sender.acceptAckWire(first.ackWireBytes!);
    expect(firstAck.acknowledgedFragments).toContain(0);
    expect(firstAck.missingFragments).not.toContain(0);

    const due = sender.dueRetransmissions(100);
    expect(due.some(item => item.fragmentIndex === 0)).toBe(false);
    expect(due.length).toBe(fragments.length - 1);

    let finalAck: number[] | undefined;
    for (let index = 1; index < fragments.length; index += 1) {
      const result = receiver.acceptIncomingWire(fragments[index], 20 + index);
      finalAck = result.ackWireBytes;
      if (finalAck) {
        sender.acceptAckWire(finalAck);
      }
    }

    expect(finalAck).toBeDefined();
    expect(sender.retransmissions.isComplete(messageId)).toBe(true);
    const decodedAck = decodeBushMeshWire(finalAck!);
    expect(decodedAck.envelope.type).toBe(BushMeshPacketType.Ack);
  });

  test.each([
    ['wait', SemanticIntent.Wait],
    ['stop now', SemanticIntent.Stop],
    ['keep going', SemanticIntent.Continue],
    ['i am lost', SemanticIntent.Lost],
    ['i am safe', SemanticIntent.Safe],
    ['bushfire', SemanticIntent.Fire],
    ['flooding', SemanticIntent.Flood],
    ['low battery', SemanticIntent.LowBattery],
    ['need fuel', SemanticIntent.NeedFuel],
    ['need recovery', SemanticIntent.NeedRecovery],
    ['turn around', SemanticIntent.TurnAround],
    ['hold position', SemanticIntent.HoldPosition],
  ])('recognizes semantic phrase %s', (text, intent) => {
    expect(tryParseSemanticText(text)?.intent).toBe(intent);
  });
});
