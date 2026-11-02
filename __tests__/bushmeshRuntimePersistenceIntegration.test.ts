import {
  BushMeshDatagramRuntime,
  type BushMeshRuntimeClock,
} from '../src/bushmesh/runtime/public';
import {
  BushMeshPacketType,
  BushMeshPriority,
  encodeBushMeshWire,
} from '../src/bushmesh/protocol/public';
import {BUSHMESH_MESHCORE_DEV_DATA_TYPE} from '../src/bushmesh/legacyProtocol';
import {
  BUSHMESH_CANONICAL_RUNTIME_STATE_KEY,
  RadioCoreBushMeshRuntimePersistence,
  type RadioCoreCanonicalRuntimeStateStore,
} from '../src/integration/RadioCoreBushMeshRuntimePersistence';

class MemoryRadioCoreRuntimeStore implements RadioCoreCanonicalRuntimeStateStore {
  value: string | null = null;

  async loadCanonicalRuntimeState(): Promise<string | null> {
    return this.value;
  }

  async saveCanonicalRuntimeState(serializedState: string): Promise<void> {
    this.value = serializedState;
  }

  async clearCanonicalRuntimeState(): Promise<void> {
    this.value = null;
  }
}

class TestRuntimeClock implements BushMeshRuntimeClock {
  constructor(private currentMs: number) {}

  now(): number {
    return this.currentMs;
  }

  setNow(value: number): void {
    this.currentMs = value;
  }

  setTimeout(handler: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    return setTimeout(handler, delayMs);
  }

  clearTimeout(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

function messageWire(messageId: number): number[] {
  return encodeBushMeshWire({
    type: BushMeshPacketType.Message,
    priority: BushMeshPriority.DirectMessage,
    messageId,
    ackRequested: true,
    payload: [0x72, 0x65, 0x73, 0x74, 0x61, 0x72, 0x74],
  });
}

function inbound(payload: number[], receivedAtMs: number) {
  return {
    channelIndex: 1,
    dataType: BUSHMESH_MESHCORE_DEV_DATA_TYPE,
    payload: Uint8Array.from(payload),
    receivedAtMs,
    transport: 'meshcore',
    source: 'live' as const,
    sourceNodeId: 0x1234,
  };
}

describe('radio-core canonical runtime persistence integration', () => {
  test('restores canonical dedup state after an application runtime restart', async () => {
    const store = new MemoryRadioCoreRuntimeStore();
    const persistence = new RadioCoreBushMeshRuntimePersistence(store);
    const clock = new TestRuntimeClock(1000);
    const wire = messageWire(701);

    const first = new BushMeshDatagramRuntime({persistence, clock});
    await first.initialize();
    expect(await first.acceptInbound(inbound(wire, 1000))).toMatchObject({
      status: 'accepted',
      kind: 'protocol',
    });
    await first.flush();
    expect(store.value).not.toBeNull();

    clock.setNow(1100);
    const restarted = new BushMeshDatagramRuntime({persistence, clock});
    expect(await restarted.initialize()).toBeGreaterThan(0);
    expect(await restarted.acceptInbound(inbound(wire, 1100))).toMatchObject({
      status: 'duplicate',
    });
  });

  test('fails closed if a future canonical runtime requests an unmapped secure-storage key', async () => {
    const persistence = new RadioCoreBushMeshRuntimePersistence(
      new MemoryRadioCoreRuntimeStore(),
    );

    await expect(
      persistence.getItem('bushmesh.runtime.future.v2'),
    ).rejects.toThrow('Unsupported canonical BushMesh runtime persistence key');
    await expect(
      persistence.setItem('bushmesh.runtime.future.v2', '{}'),
    ).rejects.toThrow('Unsupported canonical BushMesh runtime persistence key');
    await expect(
      persistence.removeItem?.('bushmesh.runtime.future.v2'),
    ).rejects.toThrow('Unsupported canonical BushMesh runtime persistence key');

    await expect(
      persistence.setItem(BUSHMESH_CANONICAL_RUNTIME_STATE_KEY, '{}'),
    ).resolves.toBeUndefined();
  });
});
