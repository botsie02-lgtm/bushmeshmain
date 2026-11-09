import {useEffect, useRef} from 'react';
import {meshCoreInboundMessageId} from '../meshcore/meshcoreInboundIdentity';
import {meshCoreInboundInbox} from '../meshcore/meshcoreInboundInbox';
import {meshCoreInboundDiagnostics} from '../meshcore/meshcoreInboundDiagnostics';
import {androidMessagePersistence} from '../persistence/AndroidMessagePersistence';
import {useBushMesh} from '../state/BushMeshContext';

/**
 * Application-lifetime inbox consumer for BOTH native-owned and JS-GATT
 * MeshCore channel text. Never use the coordinator's mutable lastFrame.
 * Persistence-first: only acknowledge the event after encrypted history save.
 * A failed write is retried, not prematurely claimed in a receipt registry.
 */
export function NativeChannelMessageBridge(): null {
  const {channels, addDurableChannelMessage} = useBushMesh();
  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  useEffect(() => meshCoreInboundInbox.setConsumer(async envelope => {
    const message = envelope.message;
    const index = Number(message.channelIndex);
    const stored = channelsRef.current.find(
      channel => channel.channelIndex === message.channelIndex,
    );
    const inserted = await addDurableChannelMessage({
      id: meshCoreInboundMessageId(message),
      channelIndex: message.channelIndex,
      channelName: stored?.channelName ?? `Channel ${index}`,
      text: message.text.trim(),
      direction: 'received',
      status: 'confirmed',
      createdAt: new Date(envelope.receivedAtMs).toISOString(),
    });
    if (inserted) {
      if (androidMessagePersistence.isSupported()) {
        meshCoreInboundDiagnostics.record('persisted', {channelIndex: index});
      }
      meshCoreInboundDiagnostics.record('history-visible', {channelIndex: index});
    } else {
      meshCoreInboundDiagnostics.record('duplicate', {channelIndex: index});
    }
  }), [addDurableChannelMessage]);

  return null;
}
