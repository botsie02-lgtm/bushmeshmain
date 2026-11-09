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

import {AppProviders} from './src/app/AppProviders';
import {ScreenMountGate} from './src/app/ScreenMountGate';
import {CarMessagingStatusBanner} from './src/components/CarMessagingStatusBanner';
import {ConvoyFormationBanner} from './src/components/ConvoyFormationBanner';
import {ConvoyFormationGapBanner} from './src/components/ConvoyFormationGapBanner';
import {ConvoyLinkWatchBanner} from './src/components/ConvoyLinkWatchBanner';
import {ConvoyLossBanner} from './src/components/ConvoyLossBanner';
import {ConvoyReacquiredBanner} from './src/components/ConvoyReacquiredBanner';
import {ConvoyRecoveryBanner} from './src/components/ConvoyRecoveryBanner';
import {ConvoyRecoveryHistoryStrip} from './src/components/ConvoyRecoveryHistoryStrip';
import {DriveNavigationBanner} from './src/components/DriveNavigationBanner';
import {FieldNavigationPrompt} from './src/components/FieldNavigationPrompt';
import {FormationProposalBanner} from './src/components/FormationProposalBanner';
import {MapTrackExportBanner} from './src/components/MapTrackExportBanner';
import {RadioSpeechStatusBanner} from './src/components/RadioSpeechStatusBanner';
import {RecoveryCheckpointBanner} from './src/components/RecoveryCheckpointBanner';
import {RecoveryEscalationNotice} from './src/components/RecoveryEscalationNotice';
import {RecoveryReferenceNotice} from './src/components/RecoveryReferenceNotice';
import {RouteGuidanceBanner} from './src/components/RouteGuidanceBanner';
import {SecureDataStatusBanner} from './src/components/SecureDataStatusBanner';
import {SpeechPttPanel} from './src/components/SpeechPttPanel';
import {SpeechStatusBanner} from './src/components/SpeechStatusBanner';
import {ActiveConvoyCarrierProfile} from './src/convoy/carrierCredentials';
import {ContactsScreen} from './src/screens/ContactsScreen';
import {ConvoyScreen} from './src/screens/ConvoyScreen';
import {DeviceHubScreen} from './src/screens/DeviceHubScreen';
import {DriveScreen} from './src/screens/DriveScreen';
import {LocationScreen} from './src/screens/LocationScreen';
import {MapScreen} from './src/screens/MapScreen';
import {RadioScreen} from './src/screens/RadioScreen';
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
  const [activeCarrierProfile, setActiveCarrierProfile] =
    useState<ActiveConvoyCarrierProfile | null>(null);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      <View style={styles.header}>
        <Text style={styles.appName}>BushMesh</Text>
        <Text style={styles.subtitle}>Off-grid vehicle network</Text>
      </View>

      <ConvoyReacquiredBanner visible={activeTab === 'convoy'} />
      <RecoveryReferenceNotice
        visible={activeTab === 'drive' || activeTab === 'map'}
      />
      <RecoveryEscalationNotice
        visible={activeTab === 'drive' || activeTab === 'convoy'}
      />

      {activeTab === 'drive' ? (
        <>
          <ConvoyLossBanner />
          <ConvoyFormationGapBanner />
          <RouteGuidanceBanner />
          <DriveNavigationBanner />
          <FieldNavigationPrompt />
          <SpeechStatusBanner />
        </>
      ) : null}
      {activeTab === 'map' ? <MapTrackExportBanner /> : null}
      {activeTab === 'convoy' ? (
        <>
          <FormationProposalBanner />
          <ConvoyRecoveryBanner />
          <RecoveryCheckpointBanner />
          <ConvoyLinkWatchBanner />
          <ConvoyFormationBanner />
          <ConvoyRecoveryHistoryStrip />
        </>
      ) : null}
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
        <ScreenMountGate active={activeTab === 'drive'}>
          <View style={styles.screenWrap}>
            <DriveScreen />
          </View>
        </ScreenMountGate>
        <ScreenMountGate active={activeTab === 'map'}>
          <View style={styles.screenWrap}>
            <MapScreen />
          </View>
        </ScreenMountGate>
        <ScreenMountGate active={activeTab === 'channels'}>
          <View style={styles.screenWrap}>
            <RadioScreen
              onOpenCarrierDetails={() => setActiveTab('convoy')}
            />
          </View>
        </ScreenMountGate>
        <ScreenMountGate active={activeTab === 'convoy'}>
          <View style={styles.screenWrap}>
            <ConvoyScreen
              activeCarrierProfile={activeCarrierProfile}
              onActiveCarrierProfileChange={setActiveCarrierProfile}
            />
          </View>
        </ScreenMountGate>
        <ScreenMountGate active={activeTab === 'location'}>
          <View style={styles.screenWrap}>
            <LocationScreen />
          </View>
        </ScreenMountGate>
        <ScreenMountGate active={activeTab === 'contacts'}>
          <View style={styles.screenWrap}>
            <ContactsScreen />
          </View>
        </ScreenMountGate>
        <ScreenMountGate active={activeTab === 'device'}>
          <View style={styles.screenWrap}>
            <DeviceHubScreen />
          </View>
        </ScreenMountGate>
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
      <AppProviders>
        <AppContent />
      </AppProviders>
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
