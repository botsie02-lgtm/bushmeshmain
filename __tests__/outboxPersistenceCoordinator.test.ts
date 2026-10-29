import {BushMeshQuickActionCode} from '../src/bushmesh/protocol';
import {MemoryBushMeshPersistence} from '../src/persistence/BushMeshPersistence';
import {OutboxPersistenceCoordinator} from '../src/persistence/OutboxPersistenceCoordinator';
import {BushMeshTransmissionController} from '../src/radio/BushMeshTransmissionController';
import {LegacyBushMeshOutboundAdapter} from '../src/radio/LegacyBushMeshOutboundAdapter';

describe('OutboxPersistenceCoordinator', () => {
  test('restores queued traffic into a fresh transmission controller', async () => {
    const persistence = new MemoryBushMeshPersistence();
    const original = new BushMeshTransmissionController();
    const legacy = new LegacyBushMeshOutboundAdapter(original);
    legacy.enqueueQuickAction(
      2,
      {
        senderId: 'AABBCCDDEEFF',
        sequence: 8,
        timestampSeconds: 1_800_000_000,
        action: BushMeshQuickActionCode.Help,
        latitude: -37.5,
        longitude: 146.1,
        ttlSeconds: 900,
      },
      10_000,
    );

    await new OutboxPersistenceCoordinator(original, persistence).save(11_000);

    const restoredController = new BushMeshTransmissionController();
    const restoreResult = await new OutboxPersistenceCoordinator(
      restoredController,
      persistence,
    ).restore(12_000);

    expect(restoreResult).toEqual({restored: true, entryCount: 1});
    expect(restoredController.list()).toHaveLength(1);
    expect(restoredController.list()[0].state).toBe('queued');
    expect(restoredController.list()[0].identityRef).toBe('AABBCCDDEEFF');
  });

  test('restored generated ids do not collide with newly queued traffic', async () => {
    const persistence = new MemoryBushMeshPersistence();
    const original = new BushMeshTransmissionController();
    const legacy = new LegacyBushMeshOutboundAdapter(original);
    legacy.enqueueQuickAction(
      0,
      {
        senderId: '001122334455',
        sequence: 1,
        timestampSeconds: 100,
        action: BushMeshQuickActionCode.Ok,
      },
      1_000,
    );
    legacy.enqueueQuickAction(
      0,
      {
        senderId: '001122334455',
        sequence: 2,
        timestampSeconds: 101,
        action: BushMeshQuickActionCode.Ok,
      },
      1_001,
    );

    await new OutboxPersistenceCoordinator(original, persistence).save(2_000);

    const restored = new BushMeshTransmissionController();
    await new OutboxPersistenceCoordinator(restored, persistence).restore(3_000);
    const restoredLegacy = new LegacyBushMeshOutboundAdapter(restored);
    const newEntry = restoredLegacy.enqueueQuickAction(
      0,
      {
        senderId: '001122334455',
        sequence: 3,
        timestampSeconds: 102,
        action: BushMeshQuickActionCode.Ok,
      },
      3_001,
    );

    expect(newEntry.id).toBe('outbox-3');
  });

  test('clear removes persisted and runtime queue state', async () => {
    const persistence = new MemoryBushMeshPersistence();
    const controller = new BushMeshTransmissionController();
    const legacy = new LegacyBushMeshOutboundAdapter(controller);
    legacy.enqueueQuickAction(
      0,
      {
        senderId: '001122334455',
        sequence: 1,
        timestampSeconds: 100,
        action: BushMeshQuickActionCode.Ok,
      },
      1_000,
    );

    const coordinator = new OutboxPersistenceCoordinator(controller, persistence);
    await coordinator.save(2_000);
    await coordinator.clear();

    expect(controller.list()).toEqual([]);
    expect(await persistence.loadOutbox()).toBeNull();
  });
});
