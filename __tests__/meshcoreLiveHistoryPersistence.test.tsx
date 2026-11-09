import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {NativeChannelMessageBridge} from '../src/components/NativeChannelMessageBridge';
import {meshCoreInboundInbox} from '../src/meshcore/meshcoreInboundInbox';
import {meshCoreInboundDiagnostics} from '../src/meshcore/meshcoreInboundDiagnostics';
import {androidMessagePersistence} from '../src/persistence/AndroidMessagePersistence';
import {BushMeshMessageSnapshotV1} from '../src/persistence/messageSnapshot';
import {BushMeshProvider, useBushMesh} from '../src/state/BushMeshContext';

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
async function until(test: () => boolean, name: string, timeout = 4_000): Promise<void> {
  const end = Date.now() + timeout;
  while (!test() && Date.now() < end) await pause(20);
  if (!test()) throw new Error(`Timed out waiting for ${name}`);
}

describe('MeshCore live Radio History durable bridge', () => {
  it('persists before acknowledgment, retries a storage failure, dedupes across remount/restart and keeps channel #4', async () => {
    meshCoreInboundDiagnostics.reset();
    let persisted: BushMeshMessageSnapshotV1 | null = null;
    let failOnce = true;
    jest.spyOn(androidMessagePersistence, 'isSupported').mockReturnValue(true);
    jest.spyOn(androidMessagePersistence, 'load').mockImplementation(async () => persisted);
    jest.spyOn(androidMessagePersistence, 'clear').mockResolvedValue(undefined);
    const save = jest.spyOn(androidMessagePersistence, 'save').mockImplementation(async snapshot => {
      if (failOnce && snapshot.messages.length > 0) {
        failOnce = false;
        throw new Error('Encrypted persistence temporary failure (not a durable receipt)');
      }
      persisted = snapshot;
    });

    let context: ReturnType<typeof useBushMesh> | null = null;
    const currentContext = (): ReturnType<typeof useBushMesh> | null => context;
    const storedSnapshot = (): BushMeshMessageSnapshotV1 | null => persisted;
    function Probe(): null {
      context = useBushMesh();
      return null;
    }
    function App(): React.JSX.Element {
      return (
        <BushMeshProvider>
          <NativeChannelMessageBridge />
          <Probe />
        </BushMeshProvider>
      );
    }
    let renderer: ReactTestRenderer.ReactTestRenderer | null = null;

    try {
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<App />);
        await pause(20);
      });
      await until(() => currentContext()?.messagePersistenceStatus === 'ready', 'encrypted store ready');
      await ReactTestRenderer.act(async () => {
        currentContext()?.setChannels([
          {channelIndex: '4', channelName: 'Existing private convoy', secret: 'Configured (redacted)'},
          {channelIndex: '2', channelName: 'Other private', secret: 'Configured (redacted)'},
        ]);
      });

      const incoming = {
        packetType: 'channel' as const, channelIndex: '4',
        text: 'B TO A LIVE 304', timestamp: 304,
        pathLength: 255, textType: 0, snr: 2,
      };
      await ReactTestRenderer.act(async () => {
        meshCoreInboundInbox.publish(incoming);
        await until(() => meshCoreInboundDiagnostics.snapshot().counts['persistence-error']! >= 1, 'failed first write');
      });
      expect(meshCoreInboundInbox.pendingCount()).toBe(1);
      expect(storedSnapshot()?.messages.some(message => message.text === incoming.text) ?? false).toBe(false);

      await ReactTestRenderer.act(async () => {
        await until(() => (storedSnapshot()?.messages.length ?? 0) === 1, 'durable retry', 4_000);
      });
      expect(currentContext()?.channelMessages).toHaveLength(1);
      expect(currentContext()?.channelMessages[0]).toMatchObject({
        channelIndex: '4', channelName: 'Existing private convoy', status: 'confirmed',
      });
      expect(meshCoreInboundInbox.pendingCount()).toBe(0);

      await ReactTestRenderer.act(async () => {
        // A different link quality / path is still the same queued text.
        meshCoreInboundInbox.publish({...incoming, snr: -1, pathLength: 2});
        await until(() => meshCoreInboundDiagnostics.snapshot().counts.duplicate! >= 1, 'duplicate suppressed');
      });
      expect(currentContext()?.channelMessages).toHaveLength(1);

      await ReactTestRenderer.act(async () => {renderer?.unmount();});
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<App />);
        await pause(20);
      });
      await until(() => currentContext()?.messagePersistenceStatus === 'ready', 'restart restore');
      await ReactTestRenderer.act(async () => {
        currentContext()?.setChannels([
          {channelIndex: '4', channelName: 'Existing private convoy', secret: 'Configured (redacted)'},
        ]);
      });
      await ReactTestRenderer.act(async () => {
        meshCoreInboundInbox.publish(incoming);
        await until(() => meshCoreInboundDiagnostics.snapshot().counts.duplicate! >= 2, 'restart duplicate');
      });
      expect(currentContext()?.channelMessages).toHaveLength(1);
      expect(storedSnapshot()?.messages).toHaveLength(1);
      expect(save).toHaveBeenCalled();
      expect(meshCoreInboundDiagnostics.snapshot().counts['history-visible']).toBe(1);
    } finally {
      await ReactTestRenderer.act(async () => {renderer?.unmount();});
      jest.restoreAllMocks();
    }
  }, 10_000);
});
