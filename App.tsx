import React, {useState} from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {BushMeshProvider} from './src/state/BushMeshContext';
import {BushMeshConvoyLifecycle} from './src/state/BushMeshConvoyLifecycle';
import {BushMeshRuntimeLifecycle} from './src/state/BushMeshRuntimeLifecycle';
import {BushMeshSyncInventoryBridge} from './src/state/BushMeshSyncInventoryBridge';
import {useBushMeshLiveState} from './src/state/useBushMeshLiveState';
import {ChannelsScreen} from './src/screens/ChannelsScreen';
import {ContactsScreen} from './src/screens/ContactsScreen';
import {ConvoyScreen} from './src/screens/ConvoyScreen';
import {DeviceScreen} from './src/screens/DeviceScreen';
import {DiagnosticsScreen} from './src/screens/DiagnosticsScreen';
import {EmergencyScreen} from './src/screens/EmergencyScreen';
import {MapScreen} from './src/screens/MapScreen';
import {colors} from './src/theme/colors';

type TabKey =
  | 'device'
  | 'channels'
  | 'contacts'
  | 'map'
  | 'convoy'
  | 'diagnostics'
  | 'emergency';

const tabs: Array<{key: TabKey; label: string}> = [
  {key: 'device', label: 'Device'},
  {key: 'channels', label: 'Channels'},
  {key: 'contacts', label: 'Contacts'},
  {key: 'map', label: 'Map'},
  {key: 'convoy', label: 'Convoy'},
  {key: 'diagnostics', label: 'Diag'},
  {key: 'emergency', label: 'SOS'},
];

function AppContent(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('device');
  const {unacknowledgedDistressCount} = useBushMeshLiveState();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      <View style={styles.header}>
        <Text style={styles.appName}>BushMesh</Text>
        <Text style={styles.subtitle}>MeshCore companion app</Text>
      </View>

      <View style={styles.content}>
        <View style={[styles.screenWrap, activeTab !== 'device' && styles.hidden]}>
          <DeviceScreen />
        </View>

        <View style={[styles.screenWrap, activeTab !== 'channels' && styles.hidden]}>
          <ChannelsScreen />
        </View>

        <View style={[styles.screenWrap, activeTab !== 'contacts' && styles.hidden]}>
          <ContactsScreen />
        </View>

        <View style={[styles.screenWrap, activeTab !== 'map' && styles.hidden]}>
          <MapScreen />
        </View>

        <View style={[styles.screenWrap, activeTab !== 'convoy' && styles.hidden]}>
          <ConvoyScreen />
        </View>

        <View
          style={[
            styles.screenWrap,
            activeTab !== 'diagnostics' && styles.hidden,
          ]}>
          <DiagnosticsScreen />
        </View>

        <View style={[styles.screenWrap, activeTab !== 'emergency' && styles.hidden]}>
          <EmergencyScreen />
        </View>
      </View>

      <View style={styles.tabBar}>
        {tabs.map(tab => {
          const isActive = tab.key === activeTab;
          const isEmergency = tab.key === 'emergency';
          const hasUnseenSos = isEmergency && unacknowledgedDistressCount > 0;

          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tabButton,
                isActive && styles.tabButtonActive,
                isEmergency && styles.sosTabButton,
                isEmergency && isActive && styles.sosTabButtonActive,
                hasUnseenSos && !isActive && styles.sosTabButtonUnread,
              ]}
              onPress={() => setActiveTab(tab.key)}>
              <View style={styles.tabLabelRow}>
                <Text
                  style={[
                    styles.tabText,
                    isActive && styles.tabTextActive,
                    isEmergency && styles.sosTabText,
                    isEmergency && isActive && styles.sosTabTextActive,
                  ]}>
                  {tab.label}
                </Text>
                {hasUnseenSos ? (
                  <View style={styles.sosBadge}>
                    <Text style={styles.sosBadgeText}>
                      {unacknowledgedDistressCount > 99
                        ? '99+'
                        : unacknowledgedDistressCount}
                    </Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function App(): React.JSX.Element {
  return (
    <BushMeshProvider>
      <BushMeshRuntimeLifecycle />
      <BushMeshConvoyLifecycle />
      <BushMeshSyncInventoryBridge />
      <AppContent />
    </BushMeshProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  appName: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 4,
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
    paddingHorizontal: 6,
    paddingVertical: 10,
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 2,
    borderRadius: 12,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: colors.accent,
  },
  tabLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  sosTabButton: {
    borderWidth: 1,
    borderColor: colors.danger,
  },
  sosTabButtonActive: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  sosTabButtonUnread: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 2,
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  tabTextActive: {
    color: colors.background,
  },
  sosTabText: {
    color: colors.danger,
    fontWeight: '900',
  },
  sosTabTextActive: {
    color: colors.textPrimary,
  },
  sosBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  sosBadgeText: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '900',
  },
});

export default App;