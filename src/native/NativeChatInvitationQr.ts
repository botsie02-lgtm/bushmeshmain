import {NativeModules, PermissionsAndroid, Platform} from 'react-native';
type Bridge = {showChatInvitationQr?: (value: string) => Promise<boolean>; scanChatInvitationQr?: () => Promise<string | null>; hideSharedChannelKey?: () => void};
const module = NativeModules.BushMeshRadioService as Bridge | undefined;
export const nativeChatInvitationQr = {
  supported: () => Platform.OS === 'android' && typeof module?.showChatInvitationQr === 'function' && typeof module?.scanChatInvitationQr === 'function',
  async show(value: string) {
    if (!module?.showChatInvitationQr || !await module.showChatInvitationQr(value)) throw new Error('QR unavailable.');
  },
  async scan(isCurrent: () => boolean = () => true) {
    if (!module?.scanChatInvitationQr) throw new Error('Scanner unavailable.');
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Camera permission not granted.');
    if (!isCurrent()) return null;
    return module.scanChatInvitationQr();
  },
  hide: () => module?.hideSharedChannelKey?.(),
};
