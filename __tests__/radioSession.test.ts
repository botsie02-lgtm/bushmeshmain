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
    const owner = {};
    session.claimTransport(owner, async () => {});
    session.setIdentityForOwner(owner, 'AABBCCDDEEFF');

    session.queueQuickAction({
      channelIndex: 1,
      sequence: 2,
      timestampSeconds: 200,
      action: BushMeshQuickActionCode.Stop,
    });

    expect(session.getSnapshot().queuedCount).toBe(1);
    expect(session.listOutbox()[0].identityRef).toBe('AABBCCDDEEFF');
    expect(session.listOutbox()[0].description).toContain('AABBCCDDEEFF');
  });

  test('notifies subscribers when session readiness changes', () => {
    const session = new BushMeshRadioSession();
    const owner = {};
    let notifications = 0;
    const unsubscribe = session.subscribe(() => {
      notifications += 1;
    });

    session.claimTransport(owner, async () => {});
    session.setIdentityForOwner(owner, '001122334455');
    unsubscribe();
    session.releaseTransport(owner);

    expect(notifications).toBe(2);
  });

  test('drain updates accepted counts', async () => {
    const session = new BushMeshRadioSession();
    const owner = {};
    session.claimTransport(owner, async () => {});
    session.setIdentityForOwner(owner, '001122334455');
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

  test('an old client cannot release a newer transport lease', () => {
    const session = new BushMeshRadioSession();
    const oldOwner = {};
    const newOwner = {};

    session.claimTransport(oldOwner, async () => {});
    session.setIdentityForOwner(oldOwner, 'AAAAAAAAAAAA');
    session.claimTransport(newOwner, async () => {});
    session.setIdentityForOwner(newOwner, 'BBBBBBBBBBBB');

    expect(session.releaseTransport(oldOwner)).toBe(false);
    expect(session.getSnapshot().transportReady).toBe(true);
    expect(session.getSnapshot().identityRef).toBe('BBBBBBBBBBBB');
  });

  test('radio profile belongs to the active transport owner', () => {
    const session = new BushMeshRadioSession();
    const oldOwner = {};
    const newOwner = {};
    const oldProfile = {
      source: 'meshcore' as const,
      frequencyMhz: 915.2,
      txPower: 18,
      maxTxPower: 22,
      modem: {
        spreadingFactor: 9,
        bandwidthKhz: 125,
        codingRate: 5 as const,
      },
    };
    const newProfile = {
      source: 'meshcore' as const,
      frequencyMhz: 917.0,
      txPower: 20,
      maxTxPower: 22,
      modem: {
        spreadingFactor: 8,
        bandwidthKhz: 250,
        codingRate: 5 as const,
      },
    };

    session.claimTransport(oldOwner, async () => {});
    expect(session.setRadioProfileForOwner(oldOwner, oldProfile)).toBe(true);
    expect(session.getSnapshot().radioProfile?.frequencyMhz).toBe(915.2);

    session.claimTransport(newOwner, async () => {});
    expect(session.getSnapshot().radioProfile).toBeNull();
    expect(session.setRadioProfileForOwner(oldOwner, oldProfile)).toBe(false);
    expect(session.setRadioProfileForOwner(newOwner, newProfile)).toBe(true);
    expect(session.getSnapshot().radioProfile?.frequencyMhz).toBe(917.0);

    expect(session.releaseTransport(newOwner)).toBe(true);
    expect(session.getSnapshot().radioProfile).toBeNull();
  });

  test('a new radio identity cancels queued packets encoded for the old radio', () => {
    const session = new BushMeshRadioSession();
    const oldOwner = {};
    const newOwner = {};

    session.claimTransport(oldOwner, async () => {});
    session.setIdentityForOwner(oldOwner, 'AAAAAAAAAAAA');
    session.queuePosition({
      channelIndex: 0,
      sequence: 1,
      timestampSeconds: 100,
      latitude: -37.8,
      longitude: 145.2,
    });

    session.claimTransport(newOwner, async () => {});
    expect(session.getSnapshot().identityRef).toBeNull();
    session.setIdentityForOwner(newOwner, 'BBBBBBBBBBBB');

    expect(session.getSnapshot().queuedCount).toBe(0);
    expect(session.getSnapshot().cancelledCount).toBe(1);
    expect(session.listOutbox()[0].state).toBe('cancelled');
  });

  test('drain stays idle until the claimed radio has identified itself', async () => {
    const session = new BushMeshRadioSession();
    const oldOwner = {};
    const newOwner = {};
    let sendCount = 0;

    session.claimTransport(oldOwner, async () => {
      sendCount += 1;
    });
    session.setIdentityForOwner(oldOwner, 'AAAAAAAAAAAA');
    session.queuePosition({
      channelIndex: 0,
      sequence: 1,
      timestampSeconds: 100,
      latitude: -37.8,
      longitude: 145.2,
    });

    session.claimTransport(newOwner, async () => {
      sendCount += 1;
    });

    expect(await session.drainOnce()).toEqual({entry: null, outcome: 'idle'});
    expect(sendCount).toBe(0);
  });
});
