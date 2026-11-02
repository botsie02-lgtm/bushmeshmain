import {PermissionsAndroid, Platform} from 'react-native';

export async function requestAndroidPreciseLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) {
    return true;
  }

  const result = await PermissionsAndroid.request(permission, {
    title: 'Bushmesh GPS access',
    message:
      'Bushmesh uses precise GPS for offline convoy positions, breadcrumbs and navigation when mobile coverage is unavailable.',
    buttonPositive: 'Allow GPS',
    buttonNegative: 'Not now',
  });

  return result === PermissionsAndroid.RESULTS.GRANTED;
}
