import {appRadioConnectionService} from '../../radio/AppRadioConnectionService';
import {meshCoreInboundInbox} from '../../meshcore/meshcoreInboundInbox';
import {meshCoreSelfInfoToRadioProfile} from '../../radio/meshCoreRadioProfile';
import {nativeRadioService} from '../../native/NativeRadioService';
import type {BushMeshLocationFix} from '../../location/positionPlanner';
import {
  ChannelFieldLocationSession,
  type AndroidFieldLocationSnapshot,
  type ChannelFieldRadioPort,
} from './ChannelFieldLocationSession';

/** Read-only view of the existing LocationSessionProvider; no GPS ownership. */
export type ExistingLocationSessionView = {
  status: AndroidFieldLocationSnapshot['status'];
  providerLabel: string | null;
  latestFix: BushMeshLocationFix | null;
};

export function readRealAndroidLocation(
  view: ExistingLocationSessionView,
): AndroidFieldLocationSnapshot {
  return {
    providerId: view.providerLabel === 'Android GPS'
      ? 'android-gps'
      : view.providerLabel === 'Simulated route'
        ? 'simulated' : 'none',
    status: view.status,
    fix: view.latestFix ? {...view.latestFix} : null,
  };
}

/**
 * Uses existing AppRadioConnectionService owner (native or JS-GATT), the
 * single existing MeshCore inbox, and existing Android random-byte provider.
 * No second BLE client or radio transport is created.
 */
export function createExistingMeshCoreChannelPort(): ChannelFieldRadioPort {
  return {
    isConnected: () => appRadioConnectionService.hasUsableSendSession(),
    isPrivateChannel: index =>
      appRadioConnectionService.getSnapshot().channels.some(channel =>
        channel.channelIndex === String(index) &&
        channel.secret === 'Configured (redacted)'),
    currentModem: () => {
      const self = appRadioConnectionService.getSnapshot().selfInfo;
      return self ? meshCoreSelfInfoToRadioProfile(self).modem : null;
    },
    sendChannelMessage: (index, text) =>
      appRadioConnectionService.sendChannelMessage(index, text),
    subscribeMessages: listener => meshCoreInboundInbox.subscribeObserved(listener),
    subscribeConnection: listener => appRadioConnectionService.subscribe(listener),
    randomBytes: length => nativeRadioService.secureRandomBytes(length),
  };
}

/**
 * Explicit UI worker factory, NEVER mounted by default. Caller must pass a
 * current read of LocationSessionProvider and manually call start() after
 * showing the warning. Do not pass results to ConvoyMap.authorisedMembers.
 */
export function createChannelFieldLocationForUi(
  getLocationSession: () => ExistingLocationSessionView,
): ChannelFieldLocationSession {
  return new ChannelFieldLocationSession(
    createExistingMeshCoreChannelPort(),
    () => readRealAndroidLocation(getLocationSession()),
  );
}
