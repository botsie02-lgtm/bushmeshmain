import {
  BushMeshCapability,
  BushMeshNodeRole,
  negotiateBushMeshPeerPolicy,
} from '../src/bushmesh/protocol';
import {prepareBushMeshPeerTextChannelFrames} from '../src/meshcore/meshcoreBushMeshBridge';

const local = {
  nodeId: 1,
  role: BushMeshNodeRole.Handheld,
  protocolMinVersion: 1,
  protocolMaxVersion: 1,
  dictionaryVersion: 1,
  capabilities:
    BushMeshCapability.DictionaryText |
    BushMeshCapability.Fragmentation |
    BushMeshCapability.BinaryTransport |
    BushMeshCapability.StoreAndForward,
};

const remote = {
  nodeId: 2,
  role: BushMeshNodeRole.Vehicle,
  protocolMinVersion: 1,
  protocolMaxVersion: 1,
  dictionaryVersion: 1,
  capabilities:
    BushMeshCapability.DictionaryText |
    BushMeshCapability.Fragmentation |
    BushMeshCapability.BinaryTransport |
    BushMeshCapability.StoreAndForward,
};

describe('MeshCore capability-aware Bushmesh bridge', () => {
  test('uses text-safe carrier until binary is explicitly enabled', () => {
    const policy = negotiateBushMeshPeerPolicy(local, remote);
    const frames = prepareBushMeshPeerTextChannelFrames(
      'heading back to camp',
      100,
      policy,
    );
    expect(frames).toHaveLength(1);
    expect(frames[0].transport).toBe('text-safe');
    expect(frames[0].text?.startsWith('~BM1:')).toBe(true);
  });

  test('uses raw binary only when both nodes support it and experiment is enabled', () => {
    const policy = negotiateBushMeshPeerPolicy(local, remote, {
      allowExperimentalBinary: true,
    });
    const frames = prepareBushMeshPeerTextChannelFrames('need fuel', 101, policy);
    expect(frames[0].transport).toBe('binary');
    expect(frames[0].text).toBeUndefined();
    expect(frames[0].payloadBytes).toEqual(frames[0].wireBytes);
  });

  test('refuses oversized messages when remote node lacks fragmentation', () => {
    const policy = negotiateBushMeshPeerPolicy(local, {
      ...remote,
      capabilities: BushMeshCapability.DictionaryText,
    });
    expect(() =>
      prepareBushMeshPeerTextChannelFrames(
        'A very long unique message that cannot fit in an intentionally tiny carrier.',
        102,
        policy,
        {maxPayloadBytes: 12},
      ),
    ).toThrow(/does not support fragmentation/);
  });
});
