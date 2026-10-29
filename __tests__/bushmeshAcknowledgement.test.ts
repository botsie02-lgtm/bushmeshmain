import {
  BushMeshDeliveryAckStatus,
  decodeBushMeshAckWire,
  decodeBushMeshTypedPacket,
  encodeBushMeshDeliveryAckPacketWire,
  encodeBushMeshFragmentAckWire,
} from '../src/bushmesh/protocol/public';

describe('BushMesh acknowledgement schemas', () => {
  it('decodes selective fragment ACKs through the Raw discriminator', () => {
    const wire = encodeBushMeshFragmentAckWire(44, 4, [0, 2, 3]);
    const decoded = decodeBushMeshAckWire(wire);

    expect(decoded.kind).toBe('fragment');
    if (decoded.kind === 'fragment') {
      expect(decoded.value.messageId).toBe(44);
      expect(decoded.value.receivedFragments).toEqual([0, 2, 3]);
      expect(decoded.value.missingFragments).toEqual([1]);
    }
  });

  it('decodes whole-message delivery ACKs through the Command discriminator', () => {
    const wire = encodeBushMeshDeliveryAckPacketWire(
      91,
      92,
      BushMeshDeliveryAckStatus.Delivered,
    );
    const decoded = decodeBushMeshAckWire(wire);

    expect(decoded).toEqual({
      kind: 'delivery',
      value: {
        messageId: 91,
        status: BushMeshDeliveryAckStatus.Delivered,
      },
    });

    const typed = decodeBushMeshTypedPacket(wire);
    expect(typed.kind).toBe('ack');
    if (typed.kind === 'ack') {
      expect(typed.value.kind).toBe('delivery');
    }
  });
});
