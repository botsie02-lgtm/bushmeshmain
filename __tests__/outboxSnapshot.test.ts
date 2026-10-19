import {BushMeshOutboxEntry} from '../src/bushmesh/outbox';
import {MemoryBushMeshPersistence} from '../src/persistence/BushMeshPersistence';
import {
  createOutboxSnapshot,
  decodeOutboxSnapshot,
  encodeOutboxSnapshot,
  restoreOutboxSnapshot,
} from '../src/persistence/outboxSnapshot';

function entry(overrides?: Partial<BushMeshOutboxEntry>): BushMeshOutboxEntry {
  return {
    id: 'outbox-7',
    channelIndex: 2,
    dataType: 0xff00,
    payload: Uint8Array.from([1, 2, 3, 4]),
    priority: 'safety',
    description: 'HELP from AABBCCDDEEFF',
    identityRef: 'AABBCCDDEEFF',
    expiresAtMs: null,
    createdAtMs: 1_000,
    maxAttempts: 5,
    attempts: 1,
    state: 'queued',
    nextAttemptAtMs: 3_000,
    lastError: 'radio offline',
    acceptedAtMs: null,
    ...overrides,
  };
}

describe('Bushmesh outbox snapshots', () => {
  test('round-trips binary payloads through JSON-safe base64', () => {
    const snapshot = createOutboxSnapshot([entry()], 5_000);
    const decoded = decodeOutboxSnapshot(encodeOutboxSnapshot(snapshot));
    const restored = restoreOutboxSnapshot(decoded, 6_000);

    expect(decoded.version).toBe(1);
    expect(decoded.savedAtMs).toBe(5_000);
    expect(restored).toHaveLength(1);
    expect(Array.from(restored[0].payload)).toEqual([1, 2, 3, 4]);
    expect(restored[0].identityRef).toBe('AABBCCDDEEFF');
    expect(restored[0].state).toBe('queued');
  });

  test('retains expiry so stale control traffic cannot resurrect after restart', () => {
    const snapshot = createOutboxSnapshot(
      [entry({expiresAtMs: 7_500})],
      5_000,
    );
    const restored = restoreOutboxSnapshot(snapshot, 6_000)[0];

    expect(snapshot.entries[0].expiresAtMs).toBe(7_500);
    expect(restored.expiresAtMs).toBe(7_500);
  });

  test('recovers an in-flight packet as queued for at-least-once retry', () => {
    const snapshot = createOutboxSnapshot(
      [entry({state: 'inflight', nextAttemptAtMs: 1_500})],
      2_000,
    );
    const restored = restoreOutboxSnapshot(snapshot, 9_000)[0];

    expect(restored.state).toBe('queued');
    expect(restored.nextAttemptAtMs).toBe(9_000);
    expect(restored.lastError).toContain('Recovered after restart');
    expect(restored.attempts).toBe(1);
  });

  test('keeps terminal delivery states terminal during restore', () => {
    const accepted = restoreOutboxSnapshot(
      createOutboxSnapshot(
        [entry({state: 'accepted', acceptedAtMs: 4_000, lastError: null})],
        5_000,
      ),
      6_000,
    )[0];

    expect(accepted.state).toBe('accepted');
    expect(accepted.acceptedAtMs).toBe(4_000);
  });

  test('rejects unknown future snapshot versions', () => {
    expect(() =>
      decodeOutboxSnapshot(
        JSON.stringify({version: 999, savedAtMs: 1, entries: []}),
      ),
    ).toThrow('Unsupported outbox snapshot version');
  });

  test('rejects corrupted persisted binary payloads instead of decoding leniently', () => {
    const snapshot = createOutboxSnapshot([entry()], 5_000);
    const corrupted = {
      ...snapshot,
      entries: [
        {
          ...snapshot.entries[0],
          payloadBase64: 'not-valid-base64!',
        },
      ],
    };

    expect(() => decodeOutboxSnapshot(JSON.stringify(corrupted))).toThrow(
      'invalid payload',
    );
  });

  test('memory adapter copies through the same validated serialization boundary', async () => {
    const persistence = new MemoryBushMeshPersistence();
    const snapshot = createOutboxSnapshot([entry()], 10_000);

    await persistence.saveOutbox(snapshot);
    const loaded = await persistence.loadOutbox();

    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(snapshot);

    await persistence.clearOutbox();
    expect(await persistence.loadOutbox()).toBeNull();
  });
});
