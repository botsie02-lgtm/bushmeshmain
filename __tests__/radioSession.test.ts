import {BushMeshQuickActionCode} from '../src/bushmesh/protocol';
import {BushMeshRadioSession} from '../src/radio/BushMeshRadioSession';

describe('BushMeshRadioSession', () => {
  test('requires a radio-derived identity before queueing traffic', () => {
    const session = new BushMeshRadioSession();

    expect(() =>
      session.queueQuickAction({
        channelIndex: 0,
        sequence: 1,
        timestampSeconds: 100,
        action: BushMeshQuickActionCode.Ok,
      }),
    ).toThrow('identity is unavailable');
  });

  test('injects the current radio identity into queued actions', () => {
    const session = new BushMeshRadioSession();
    session.setIdentity('AABBCCDDEEFF');

    session.queueQuickAction({
      channelIndex: 1,
      sequence: 2,
      timestampSeconds: 200,
      action: BushMeshQuickActionCode.Stop,
    });

    expect(session.getSnapshot().queuedCount).toBe(1);
    expect(session.listOutbox()[0].description).toContain('AABBCCDDEEFF');
  });

  test('notifies subscribers when session readiness changes', () => {
    const session = new BushMeshRadioSession();
    let notifications = 0;
    const unsubscribe = session.subscribe(() => {
      notifications += 1;
    });

    session.setIdentity('001122334455');
    session.setTransport(async () => {});
    unsubscribe();
    session.setIdentity(null);

    expect(notifications).toBe(2);
  });

  test('drain updates accepted counts', async () => {
    const session = new BushMeshRadioSession();
    session.setIdentity('001122334455');
    session.setTransport(async () => {});
    session.queuePosition({
      channelIndex: 0,
      sequence: 4,
      timestampSeconds: 300,
      latitude: -37.8,
      longitude: 145.2,
    });

    const result = await session.drainOnce();

    expect(result.outcome).toBe('accepted');
    expect(session.getSnapshot().acceptedCount).toBe(1);
    expect(session.getSnapshot().queuedCount).toBe(0);
  });
});
