import {
  BushMeshDatagramRuntime,
  BushMeshPacketType,
  BushMeshPriority,
} from '../src/bushmesh';
import {encodeBushMeshWire} from '../src/bushmesh/protocol/public';
import {BUSHMESH_MESHCORE_DEV_DATA_TYPE} from '../src/bushmesh/legacyProtocol';
import {RadioCoreBushMeshTransportAvailability} from '../src/integration/RadioCoreBushMeshTransportAvailability';
import {BushMeshRadioSession} from '../src/radio/BushMeshRadioSession';

function messageWire(messageId: number): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Message,
    priority: BushMeshPriority.DirectMessage,
    messageId,
    ackRequested: false,
    payload: [0x61, 0x76, 0x61, 0x69, 0x6c],
  });
}

describe('radio-core transport availability integration', () => {
  test('reports carrier lifecycle without taking ownership of connection or send', async () => {
    const session = new BushMeshRadioSession();
    const availability = new RadioCoreBushMeshTransportAvailability(session);
    const runtime = new BushMeshDatagramRuntime({transportAvailability: availability});

    expect(availability.getAvailability()).toEqual({
      transport: 'meshcore',
      available: false,
      reason: 'carrier-not-started',
    });

    session.setTransport(async () => undefined);
    expect(availability.getAvailability()).toEqual({
      transport: 'meshcore',
      available: false,
      reason: 'radio-identity-pending',
    });

    const disconnected = await runtime.prepareOutbound(messageWire(801), {
      channelIndex: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: 'meshcore',
    });
    expect(disconnected.diagnostics.transportAvailable).toBe(false);

    session.setIdentity('radio-a');
    expect(availability.getAvailability()).toEqual({
      transport: 'meshcore',
      available: true,
    });

    const connected = await runtime.prepareOutbound(messageWire(802), {
      channelIndex: 1,
      dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
      transport: 'meshcore',
    });
    expect(connected.diagnostics.transportAvailable).toBe(true);

    session.setTransport(null);
    expect(availability.getAvailability()).toEqual({
      transport: 'meshcore',
      available: false,
      reason: 'carrier-not-started',
    });
  });

  test('forwards radio session lifecycle notifications through the canonical port', () => {
    const session = new BushMeshRadioSession();
    const availability = new RadioCoreBushMeshTransportAvailability(session);
    const states: boolean[] = [];
    const unsubscribe = availability.subscribe?.(value => {
      states.push(value.available);
    });

    session.setTransport(async () => undefined);
    session.setIdentity('radio-a');
    session.setTransport(null);
    unsubscribe?.();

    expect(states).toEqual([false, true, false]);
  });
});
