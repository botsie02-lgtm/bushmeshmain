import React from 'react';
import {StatusBar, StyleSheet} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

import {AppProviders} from './src/app/AppProviders';
import {ActiveOperationalConvoyProvider} from './src/app/activeContext/ActiveOperationalConvoyContext';
import {ViewedConversationProvider} from './src/app/activeContext/ViewedConversationContext';
import {AppShell} from './src/app/shell/AppShell';
import {useRadioSession} from './src/state/RadioSessionContext';
import {colors} from './src/theme/colors';

/**
 * App-lifetime radio, BLE, receive, GPS and persistence providers remain
 * outside navigation. A tab change only mounts/unmounts its screen.
 */
function OperationalShell(): React.JSX.Element {
  const {snapshot} = useRadioSession();

  return (
    <ActiveOperationalConvoyProvider localIdentityRef={snapshot.identityRef}>
      <ViewedConversationProvider>
        <AppShell />
      </ViewedConversationProvider>
    </ActiveOperationalConvoyProvider>
  );
}

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <StatusBar barStyle="light-content" backgroundColor={colors.background} />
          <OperationalShell />
        </SafeAreaView>
      </AppProviders>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: colors.background},
});
