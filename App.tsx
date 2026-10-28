import React, {useState} from 'react';
import {
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';

import {CarMessagingStatusBanner} from './src/components/CarMessagingStatusBanner';
import {ConvoyLossBanner} from './src/components/ConvoyLossBanner';
import {ConvoyReacquiredBanner} from './src/components/ConvoyReacquiredBanner';
import {ConvoyRecoveryBanner} from './src/components/ConvoyRecoveryBanner';
import {DriveNavigationBanner} from './src/components/DriveNavigationBanner';
import {FieldNavigationPrompt} from './src/components/FieldNavigationPrompt';
import {MapTrackExportBanner} from './src/components/MapTrackExportBanner';
import {NativeChannelMessageBridge} from './src/components/NativeChannelMessageBridge';
import {RadioMessageSpeechBridge} from './src/components/RadioMessageSpeechBridge';
import {RadioSpeechStatusBanner} from './src/components/RadioSpeechStatusBanner';
import {RouteGuidanceBanner} from './src/components/RouteGuidanceBanner';
import {SecureDataStatusBanner} from './src/components/SecureDataStatusBanner';
import {SpeechAlertBridge} from './src/components/SpeechAlertBridge';
import {SpeechPttPanel} from './src/components/SpeechPttPanel';
import {SpeechStatusBanner} from './src/components/SpeechStatusBanner';
import {BushMeshProvider} from './src/state/BushMeshContext';
import {CarMessagingProvider} from './src/state/CarMessagingContext';
import {ConvoyProvider} from './src/state/ConvoyContext';
import {DriveProvider} from './src/state/DriveContext';
import {RadioSessionProvider} from './src/state/RadioSessionContext';
import {LocationSessionProvider} from './src/state/LocationSessionContext';
import {OfflineMapProvider} from './src/state/OfflineMapContext';
import {RouteSessionProvider} from './src/state/RouteSessionContext';
import {SpeechProvider} from './src/state/SpeechContext';
import {DriveScreen} from './src/screens/DriveScreen';
import {DeviceHubScreen} from './src/screens/DeviceHubScreen';
import {RadioScreen} from './src/screens/RadioScreen';
import {ContactsScreen} from './src/screens/ContactsScreen';
import {ConvoyScreen} from './src/screens/ConvoyScreen';
import {LocationScreen} from './src/screens/LocationScreen';
import {MapScreen} from './src/screens/MapScreen';
import {colors} from './src/theme/colors';

type TabKey =
  | 'drive'
  | 'map'
  | 'channels'
  | 'convoy'
  | 'location'
  | 'contacts'
  | 'device';

const tabs: Array<{key: TabKey; label: string}> = [
  {key: 'drive', label: 'Drive'},
  {key: 'map', label: 'Map'},
  {key: 'channels', label: 'Radio'},
  {key: 'convoy', label: 'Convoy'},
  {key: 'location', label: 'GPS'},
  {key: 'contacts', label: 'Contacts'},
  {key: 'device', label: 'Device'},
];

function AppContent(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('drive');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      <View style={styles.header}>
        <Text style={styles.appName}>BushMesh</Text>
        <Text style={styles.subtitle}>Off-grid vehicle network</Text>
      </View>

      <ConvoyReacquiredBanner visible={activeTab === 'convoy'} />

      {activeTab === 'drive' ? (
        <>
          <ConvoyLossBanner />
          <RouteGuidanceBanner />
          <DriveNavigationBanner />
          <FieldNavigationPrompt />
          <SpeechStatusBanner />
        </>
      ) : null}
      {activeTab === 'map' ? <MapTrackExportBanner /> : null}
      {activeTab === 'convoy' ? <ConvoyRecoveryBanner /> : null}
      {activeTab === 'channels' ? (
        <>
          <SecureDataStatusBanner kind="messages" />
          <CarMessagingStatusBanner />
          <RadioSpeechStatusBanner />
          <SpeechPttPanel />
        </>
      ) : null}
      {activeTab === 'contacts' ? (
        <SecureDataStatusBanner kind="contacts" />
      ) : null}

      <View style={styles.content}>
        <View style={[styles.screenWrap, activeTab !== 'drive' && styles.hidden]}>
          <DriveScreen />
        </View>

        <View style={[styles.screenWrap, activeTab !== 'map' && styles.hidden]}>
          <MapScreen />
        </View>

        <View style={[styles.screenWrap, activeTab !== 'channels' && styles.hidden]}>
          <RadioScreen />
        </View>

        <View style={[styles.screenWrap, activeTab !== 'convoy' && styles.hidden]}>
          <ConvoyScreen />
        </View>

        <View style={[styles.screenWrap, activeTab !== 'location' && styles.hidden]}>
          <LocationScreen />
        </View>

        <View style={[styles.screenWrap, activeTab !== 'contacts' && styles.hidden]}>
          <ContactsScreen />
        </View>

        <View style={[styles.screenWrap, activeTab !== 'device' && styles.hidden]}>
          <DeviceHubScreen />
        </View>
      </View>

      <View style={styles.tabBar}>
        {tabs.map(tab => {
          const isActive = tab.key === activeTab;

          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabButton, isActive && styles.tabButtonActive]}
              onPress={() => setActiveTab(tab.key)}>
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <BushMeshProvider>
        <NativeChannelMessageBridge />
        <CarMessagingProvider>
          <ConvoyProvider>
            <DriveProvider>
              <SpeechProvider>
                <SpeechAlertBridge />
                <RadioMessageSpeechBridge />
                <RadioSessionProvider>
                  <OfflineMapProvider>
                    <LocationSessionProvider>
                      <RouteSessionProvider>
                        <AppContent />
                      </RouteSessionProvider>
                    </LocationSessionProvider>
                  </OfflineMapProvider>
                </RadioSessionProvider>
              </SpeechProvider>
            </DriveProvider>
          </ConvoyProvider>
        </CarMessagingProvider>
      </BushMeshProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  appName: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  screenWrap: {
    flex: 1,
  },
  hidden: {
    display: 'none',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderRadius: 12,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: colors.accent,
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '700',
  },
  tabTextActive: {
    color: colors.background,
  },
});

export default App;
