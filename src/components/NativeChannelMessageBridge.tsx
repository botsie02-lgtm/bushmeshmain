import {Buffer} from 'buffer';
import {useEffect, useRef} from 'react';

import {nativeMeshCoreSessionCoordinator} from '../meshcore/NativeMeshCoreSessionCoordinator';
import {nativeMessageReceipt} from '../native/NativeMessageReceipt';
import {useBushMesh} from '../state/BushMeshContext';

/**
 * Feeds Android-native MeshCore channel text into Bushmesh message history.
 *
 * The native radio may replay buffered/queued frames after reconnect or process
 * restart. A persistent SHA-256 frame receipt is therefore claimed before a
 * message enters history. Android Auto notifications intentionally use a
 * separate receipt registry so notification delivery cannot consume history.
 */
export function NativeChannelMessageBridge(): null {
  const {channels, addLocalChannelMessage} = useBushMesh();
  const lastObservedFrameRef = useRef<string | null>(null);
  const fallbackReceiptsRef = useRef(new Set<string>());

  useEffect(() => {
    let active = true;

    const ingestLatest = async () => {
      const response = nativeMeshCoreSessionCoordinator.getSnapshot().lastFrame;
      const channelMessage = response?.parsed?.channelMessage;
      if (!response || !channelMessage || response.bytes.length === 0) {
        return;
      }

      const text = channelMessage.text.trim();
      if (!text) {
        return;
      }

      const frameBase64 = Buffer.from(response.bytes).toString('base64');
      if (lastObservedFrameRef.current === frameBase64) {
        return;
      }
      lastObservedFrameRef.current = frameBase64;

      let firstSighting = true;
      if (nativeMessageReceipt.isSupported()) {
        try {
          firstSighting = await nativeMessageReceipt.claimFrame(frameBase64);
        } catch {
          // If durable receipt storage is temporarily unavailable, fall back to
          // process-local dedupe rather than dropping a legitimate radio text.
          firstSighting = !fallbackReceiptsRef.current.has(frameBase64);
          fallbackReceiptsRef.current.add(frameBase64);
        }
      } else {
        firstSighting = !fallbackReceiptsRef.current.has(frameBase64);
        fallbackReceiptsRef.current.add(frameBase64);
      }

      if (!active || !firstSighting) {
        return;
      }

      const channelName =
        channels.find(
          channel => channel.channelIndex === channelMessage.channelIndex,
        )?.channelName ?? `Channel ${channelMessage.channelIndex}`;

      addLocalChannelMessage({
        channelIndex: channelMessage.channelIndex,
        channelName,
        text,
        direction: 'received',
        status: 'confirmed',
      });
    };

    const unsubscribe = nativeMeshCoreSessionCoordinator.subscribe(() => {
      ingestLatest().catch(() => undefined);
    });
    ingestLatest().catch(() => undefined);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [addLocalChannelMessage, channels]);

  return null;
}
