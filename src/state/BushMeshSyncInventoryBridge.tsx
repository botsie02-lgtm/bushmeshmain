import {useEffect} from 'react';

import {
  BushMeshSyncNamespace,
  hashBushMeshInventoryKey,
} from '../bushmesh/protocol';
import {getBushMeshSyncManager} from '../bushmesh/runtime/BushMeshSyncHub';
import {useBushMesh} from './BushMeshContext';
import {useBushMeshLiveState} from './useBushMeshLiveState';

function stableGeneration(ids: number[]): number {
  let hash = 0x811c9dc5;
  for (const id of [...ids].sort((a, b) => a - b)) {
    hash ^= id >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash === 0 ? 1 : hash;
}

function inventoryId(namespace: string, key: string): number {
  return hashBushMeshInventoryKey(`${namespace}:${key}`);
}

/**
 * Keeps BushMesh sync summaries aligned with the state currently visible in
 * the app. Only compact hashed inventory identifiers enter the sync manager;
 * contact/channel contents are not copied into the Bloom summary itself.
 */
export function BushMeshSyncInventoryBridge(): null {
  const {
    contacts,
    channels,
    channelMessages,
    activeChannelIndex,
    meshCorePublicKey,
  } = useBushMesh();
  const {peerLocations} = useBushMeshLiveState();

  useEffect(() => {
    const sync = getBushMeshSyncManager();

    const messageIds = channelMessages.map(message =>
      inventoryId('message', message.id),
    );
    sync.setInventory(
      BushMeshSyncNamespace.Messages,
      messageIds,
      stableGeneration(messageIds),
    );

    const contactIds = contacts.map(contact =>
      inventoryId('contact', contact.publicKey),
    );
    sync.setInventory(
      BushMeshSyncNamespace.Contacts,
      contactIds,
      stableGeneration(contactIds),
    );

    const channelIds = channels
      .filter(channel => channel.channelName && channel.channelName !== 'Empty')
      .map(channel =>
        inventoryId(
          'channel',
          `${channel.channelIndex}:${channel.channelName}`,
        ),
      );
    sync.setInventory(
      BushMeshSyncNamespace.Channels,
      channelIds,
      stableGeneration(channelIds),
    );

    const markerIds = peerLocations.map(location =>
      inventoryId('map-peer', String(location.nodeId)),
    );
    sync.setInventory(
      BushMeshSyncNamespace.MapMarkers,
      markerIds,
      stableGeneration(markerIds),
    );

    const configurationKeys = [
      `active-channel:${activeChannelIndex ?? 'none'}`,
      `meshcore-node:${meshCorePublicKey ?? 'unknown'}`,
    ];
    const configurationIds = configurationKeys.map(key =>
      inventoryId('config', key),
    );
    sync.setInventory(
      BushMeshSyncNamespace.Configuration,
      configurationIds,
      stableGeneration(configurationIds),
    );
  }, [
    activeChannelIndex,
    channelMessages,
    channels,
    contacts,
    meshCorePublicKey,
    peerLocations,
  ]);

  return null;
}
