import React, {useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {ScreenMountGate} from '../ScreenMountGate';
import {useActiveOperationalConvoy} from '../activeContext/ActiveOperationalConvoyContext';
import {useViewedConversation} from '../activeContext/ViewedConversationContext';
import {CarMessagingStatusBanner} from '../../components/CarMessagingStatusBanner';
import {ConvoyFormationBanner} from '../../components/ConvoyFormationBanner';
import {ConvoyFormationGapBanner} from '../../components/ConvoyFormationGapBanner';
import {ConvoyLinkWatchBanner} from '../../components/ConvoyLinkWatchBanner';
import {ConvoyLossBanner} from '../../components/ConvoyLossBanner';
import {ConvoyReacquiredBanner} from '../../components/ConvoyReacquiredBanner';
import {ConvoyRecoveryBanner} from '../../components/ConvoyRecoveryBanner';
import {ConvoyRecoveryHistoryStrip} from '../../components/ConvoyRecoveryHistoryStrip';
import {DriveNavigationBanner} from '../../components/DriveNavigationBanner';
import {FieldNavigationPrompt} from '../../components/FieldNavigationPrompt';
import {FormationProposalBanner} from '../../components/FormationProposalBanner';
import {MapTrackExportBanner} from '../../components/MapTrackExportBanner';
import {RadioSpeechStatusBanner} from '../../components/RadioSpeechStatusBanner';
import {RecoveryCheckpointBanner} from '../../components/RecoveryCheckpointBanner';
import {RecoveryEscalationNotice} from '../../components/RecoveryEscalationNotice';
import {RecoveryReferenceNotice} from '../../components/RecoveryReferenceNotice';
import {RouteGuidanceBanner} from '../../components/RouteGuidanceBanner';
import {SecureDataStatusBanner} from '../../components/SecureDataStatusBanner';
import {SpeechPttPanel} from '../../components/SpeechPttPanel';
import {SpeechStatusBanner} from '../../components/SpeechStatusBanner';
import {ActiveConvoyCarrierProfile} from '../../convoy/carrierCredentials';
import {ContactsScreen} from '../../screens/ContactsScreen';
import {ConvoyScreen} from '../../screens/ConvoyScreen';
import {DeviceHubScreen} from '../../screens/DeviceHubScreen';
import {DriveScreen} from '../../screens/DriveScreen';
import {LocationScreen} from '../../screens/LocationScreen';
import {MapScreen} from '../../screens/MapScreen';
import {RadioScreen} from '../../screens/RadioScreen';
import {useBushMesh} from '../../state/BushMeshContext';
import {colors} from '../../theme/colors';

export type MainTab = 'drive' | 'radio' | 'convoy' | 'contacts' | 'device';
type DriveView = 'home' | 'map' | 'legacy';
type ConvoyView = 'select' | 'tools';
type DeviceView = 'hub' | 'gps';

export const MAIN_TABS: ReadonlyArray<{key: MainTab; label: string}> = [
  {key: 'drive', label: 'Drive'},
  {key: 'radio', label: 'Radio'},
  {key: 'convoy', label: 'Convoy'},
  {key: 'contacts', label: 'Contacts'},
  {key: 'device', label: 'Device'},
];

function Action({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.action,
        secondary && styles.secondaryAction,
        disabled && styles.disabled,
      ]}>
      <Text style={[styles.actionText, secondary && styles.secondaryActionText]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Surface({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.surface}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {children}
    </View>
  );
}

function DriveHome({
  openConvoy,
  openMap,
  openLegacy,
}: {
  openConvoy: () => void;
  openMap: () => void;
  openLegacy: () => void;
}): React.JSX.Element {
  const {activeConvoy, status, notice} = useActiveOperationalConvoy();
  const {connectionStatus, activeChannel, contacts} = useBushMesh();

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <Text style={styles.eyebrow}>DRIVE / OPERATIONAL OVERVIEW</Text>
      <Text style={styles.heroTitle}>Ready for the road.</Text>
      <Text style={styles.lead}>
        Your driving home, with operational convoy status kept separate from
        nearby radio traffic.
      </Text>
      <Surface
        eyebrow="ACTIVE CONVOY"
        title={activeConvoy?.displayName ?? (status === 'checking'
          ? 'Checking convoy membership…'
          : 'No active convoy')}
        description={activeConvoy
          ? 'Membership verified by the Security v1 integration boundary. Shared vehicle positions will appear here after membership-scoped tracking is connected.'
          : 'No authorised convoy is selected. Public MeshCore contacts, carrier channels and received positions are not convoy members.'}>
        {notice ? <Text style={styles.warningText}>{notice}</Text> : null}
        <Action label={activeConvoy ? 'Manage active convoy' : 'Choose a convoy'} onPress={openConvoy} />
      </Surface>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>RADIO</Text>
          <Text style={styles.statValue}>
            {connectionStatus === 'Connected' ? 'Connected' : 'Offline'}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>MEMBERSHIP</Text>
          <Text style={styles.statValue}>{activeConvoy ? 'Verified' : 'Inactive'}</Text>
        </View>
      </View>
      <Surface
        eyebrow="SEPARATE RADIO CONTEXT"
        title={activeChannel
          ? 'Carrier: ' + activeChannel.channelName
          : 'No MeshCore carrier selected'}
        description={'Known MeshCore contacts: ' + (contacts?.length ?? 0) +
          '. Neither a carrier channel nor discovered contacts prove authorised convoy membership.'}>
        <Text style={styles.mutedText}>
          The legacy Radio view currently follows the carrier channel. Explicit
          conversation selection will be connected independently.
        </Text>
      </Surface>
      <Surface
        eyebrow="NAVIGATION"
        title="Offline maps"
        description="Open the existing map and location tools. Legacy radio positions on the map are not an authenticated convoy roster.">
        <Action label="Open map" onPress={openMap} secondary />
      </Surface>
      <Surface
        eyebrow="EXISTING DRIVE TOOLS"
        title="Legacy driver dashboard"
        description="Quick actions, trip readiness and unscoped radio telemetry remain available on request while verified convoy data filtering is integrated.">
        <Action label="Open legacy drive tools" onPress={openLegacy} secondary />
      </Surface>
    </ScrollView>
  );
}

function ConvoySelector({openTools}: {openTools: () => void}): React.JSX.Element {
  const {
    activeConvoy,
    selectableConvoys,
    status,
    notice,
    localIdentityRef,
    selectionDurable,
    selectConvoy,
    clearActiveConvoy,
    refresh,
  } = useActiveOperationalConvoy();

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <Text style={styles.eyebrow}>CONVOY / ACTIVE OPERATION</Text>
      <Text style={styles.heroTitle}>Choose your convoy.</Text>
      <Text style={styles.lead}>
        Only authenticated, authorised BushMesh memberships are eligible.
        MeshCore channels and discovered contacts are managed separately.
      </Text>
      <Surface
        eyebrow="OPERATIONAL STATE"
        title={activeConvoy?.displayName ?? 'No active convoy'}
        description={activeConvoy
          ? 'Verified for the current local identity.'
          : status === 'checking'
            ? 'Validating identity and saved selection…'
            : 'Connect a trusted identity and choose an authorised membership.'}>
        {notice ? <Text style={styles.warningText}>{notice}</Text> : null}
        {activeConvoy ? (
          <Action
            label="Leave active convoy"
            onPress={() => {clearActiveConvoy().catch(() => undefined);}}
            secondary
          />
        ) : null}
      </Surface>
      <Surface
        eyebrow="AUTHORISED MEMBERSHIPS"
        title={status === 'checking' ? 'Checking…' : String(selectableConvoys.length) + ' available'}
        description={!localIdentityRef
          ? 'No local radio identity is available yet. Connect or restore your device under Device.'
          : selectableConvoys.length === 0
            ? 'No verified memberships are available. Carrier setup alone does not enrol or authorise a member.'
            : 'Selecting a convoy revalidates membership before activation.'}>
        {selectableConvoys.map(item => (
          <View key={item.convoyId} style={styles.choice}>
            <View style={styles.choiceText}>
              <Text style={styles.choiceTitle}>{item.displayName}</Text>
              <Text style={styles.choiceDetail}>Verified membership • {item.convoyId}</Text>
            </View>
            <Action
              label={activeConvoy?.convoyId === item.convoyId ? 'Selected' : 'Select'}
              onPress={() => {selectConvoy(item.convoyId).catch(() => undefined);}}
              disabled={status === 'checking' || activeConvoy?.convoyId === item.convoyId}
              secondary
            />
          </View>
        ))}
        <Action label="Refresh memberships" onPress={() => {refresh().catch(() => undefined);}} secondary />
        {!selectionDurable ? (
          <Text style={styles.mutedText}>
            Convoy selection is session-only until native selection storage is integrated.
            Restart will default to No active convoy.
          </Text>
        ) : null}
      </Surface>
      <Surface
        eyebrow="CARRIER SETUP"
        title="MeshCore carrier and legacy tools"
        description="Create/join a channel, adjust carrier settings and inspect legacy positions. A carrier PSK or invite is not proof of BushMesh membership.">
        <Action label="Open carrier and legacy tools" onPress={openTools} secondary />
      </Surface>
    </ScrollView>
  );
}

function LegacyNotice({kind}: {kind: 'map' | 'drive' | 'convoy'}): React.JSX.Element {
  const name = kind === 'map' ? 'Map' : kind === 'drive' ? 'Drive tools' : 'Convoy tools';
  return (
    <View style={styles.legacyNotice}>
      <Text style={styles.warningTitle}>{name}: unverified legacy telemetry</Text>
      <Text style={styles.warningText}>
        Incoming positions and known MeshCore contacts are not filtered by
        authorised convoy membership. Do not use this view as a verified roster.
      </Text>
    </View>
  );
}

export function AppShell(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<MainTab>('drive');
  const [driveView, setDriveView] = useState<DriveView>('home');
  const [convoyView, setConvoyView] = useState<ConvoyView>('select');
  const [deviceView, setDeviceView] = useState<DeviceView>('hub');
  const [carrierProfile, setCarrierProfile] =
    useState<ActiveConvoyCarrierProfile | null>(null);
  const {activeConvoy} = useActiveOperationalConvoy();
  const {viewedConversation} = useViewedConversation();

  const openConvoy = () => {
    setConvoyView('select');
    setActiveTab('convoy');
  };

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.brand}>BushMesh</Text>
            <Text style={styles.brandDetail}>OFF-GRID VEHICLE NETWORK</Text>
          </View>
          <View style={styles.headerStatus}>
            <Text style={styles.headerStatusLabel}>OPERATIONAL CONVOY</Text>
            <Text
              numberOfLines={1}
              style={[styles.headerStatusValue, activeConvoy && styles.headerStatusActive]}>
              {activeConvoy?.displayName ?? 'No active convoy'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.content}>
        <ScreenMountGate active={activeTab === 'drive'}>
          {driveView === 'home' ? (
            <DriveHome
              openConvoy={openConvoy}
              openMap={() => setDriveView('map')}
              openLegacy={() => setDriveView('legacy')}
            />
          ) : (
            <View style={styles.screen}>
              <View style={styles.subnav}>
                <Action label="Back to Drive" onPress={() => setDriveView('home')} secondary />
                <Text style={styles.subnavLabel}>
                  {driveView === 'map' ? 'Offline map' : 'Driver tools'}
                </Text>
              </View>
              <LegacyNotice kind={driveView === 'map' ? 'map' : 'drive'} />
              {driveView === 'map' ? (
                <>
                  <RecoveryReferenceNotice visible />
                  <MapTrackExportBanner />
                  <MapScreen />
                </>
              ) : (
                <>
                  <RecoveryReferenceNotice visible />
                  <RecoveryEscalationNotice visible />
                  <ConvoyLossBanner />
                  <ConvoyFormationGapBanner />
                  <RouteGuidanceBanner />
                  <DriveNavigationBanner />
                  <FieldNavigationPrompt />
                  <SpeechStatusBanner />
                  <DriveScreen />
                </>
              )}
            </View>
          )}
        </ScreenMountGate>

        <ScreenMountGate active={activeTab === 'radio'}>
          <View style={styles.screen}>
            <View style={styles.slimNotice}>
              <Text style={styles.slimText}>
                Radio traffic uses the selected MeshCore carrier channel, not
                necessarily the active authorised convoy.
              </Text>
              <Text style={styles.slimText}>
                {viewedConversation
                  ? 'Explicit conversation: ' + viewedConversation.kind
                  : 'Conversation router not yet connected; legacy Radio view follows the carrier.'}
              </Text>
            </View>
            <SecureDataStatusBanner kind="messages" />
            <CarMessagingStatusBanner />
            <RadioSpeechStatusBanner />
            <SpeechPttPanel />
            <RadioScreen
              onOpenCarrierDetails={carrierProfile
                ? () => {
                  setConvoyView('tools');
                  setActiveTab('convoy');
                }
                : undefined}
            />
          </View>
        </ScreenMountGate>

        <ScreenMountGate active={activeTab === 'convoy'}>
          {convoyView === 'select' ? (
            <ConvoySelector openTools={() => setConvoyView('tools')} />
          ) : (
            <View style={styles.screen}>
              <View style={styles.subnav}>
                <Action label="Back to convoy selection" onPress={() => setConvoyView('select')} secondary />
              </View>
              <LegacyNotice kind="convoy" />
              <ConvoyReacquiredBanner visible />
              <RecoveryEscalationNotice visible />
              <FormationProposalBanner />
              <ConvoyRecoveryBanner />
              <RecoveryCheckpointBanner />
              <ConvoyLinkWatchBanner />
              <ConvoyFormationBanner />
              <ConvoyRecoveryHistoryStrip />
              <ConvoyScreen
                activeCarrierProfile={carrierProfile}
                onActiveCarrierProfileChange={setCarrierProfile}
              />
            </View>
          )}
        </ScreenMountGate>

        <ScreenMountGate active={activeTab === 'contacts'}>
          <View style={styles.screen}>
            <View style={styles.slimNotice}>
              <Text style={styles.slimText}>
                Discovered MeshCore contacts are not automatically members of an authorised convoy.
              </Text>
            </View>
            <SecureDataStatusBanner kind="contacts" />
            <ContactsScreen />
          </View>
        </ScreenMountGate>

        <ScreenMountGate active={activeTab === 'device'}>
          <View style={styles.screen}>
            <View style={styles.subnav}>
              {deviceView === 'hub' ? (
                <>
                  <Action label="GPS and location" onPress={() => setDeviceView('gps')} secondary />
                  <Action
                    label="Offline map packs"
                    onPress={() => {
                      setDriveView('map');
                      setActiveTab('drive');
                    }}
                    secondary
                  />
                </>
              ) : (
                <>
                  <Action label="Back to Device" onPress={() => setDeviceView('hub')} secondary />
                  <Text style={styles.subnavLabel}>GPS settings</Text>
                </>
              )}
            </View>
            {deviceView === 'gps' ? <LocationScreen /> : <DeviceHubScreen />}
          </View>
        </ScreenMountGate>
      </View>

      <View style={styles.tabBar} accessibilityRole="tablist">
        {MAIN_TABS.map(tab => {
          const selected = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{selected}}
              style={[styles.tab, selected && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}>
              <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {flex: 1, backgroundColor: colors.background},
  header: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  brand: {color: colors.textPrimary, fontSize: 23, fontWeight: '800'},
  brandDetail: {color: colors.textMuted, fontSize: 9, letterSpacing: 1, marginTop: 2},
  headerStatus: {maxWidth: '47%', alignItems: 'flex-end'},
  headerStatusLabel: {color: colors.textMuted, fontSize: 9, fontWeight: '700'},
  headerStatusValue: {color: colors.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 4},
  headerStatusActive: {color: colors.success},
  content: {flex: 1},
  screen: {flex: 1},
  page: {flex: 1},
  pageContent: {padding: 16, paddingBottom: 28, gap: 14},
  eyebrow: {color: colors.accent, fontSize: 10, letterSpacing: 1.2, fontWeight: '800'},
  heroTitle: {color: colors.textPrimary, fontSize: 27, fontWeight: '800', marginTop: 3},
  lead: {color: colors.textSecondary, fontSize: 14, lineHeight: 21},
  surface: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 9,
  },
  sectionTitle: {color: colors.textPrimary, fontSize: 20, fontWeight: '800'},
  description: {color: colors.textSecondary, fontSize: 13, lineHeight: 20},
  action: {
    minHeight: 44,
    backgroundColor: colors.accent,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 10,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  secondaryAction: {backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border},
  disabled: {opacity: 0.45},
  actionText: {color: colors.background, fontWeight: '800', fontSize: 12},
  secondaryActionText: {color: colors.textPrimary},
  statsRow: {flexDirection: 'row', gap: 10},
  stat: {flex: 1, backgroundColor: colors.surfaceSoft, borderRadius: 12, padding: 14},
  statLabel: {color: colors.textMuted, fontSize: 10, fontWeight: '800'},
  statValue: {color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 5},
  choice: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8},
  choiceText: {flex: 1},
  choiceTitle: {color: colors.textPrimary, fontSize: 15, fontWeight: '700'},
  choiceDetail: {color: colors.textMuted, fontSize: 11, marginTop: 3},
  mutedText: {color: colors.textMuted, fontSize: 11, lineHeight: 16},
  warningTitle: {color: colors.warning, fontSize: 12, fontWeight: '800'},
  warningText: {color: colors.warning, fontSize: 12, lineHeight: 18},
  legacyNotice: {paddingHorizontal: 15, paddingVertical: 9, backgroundColor: colors.surfaceSoft},
  slimNotice: {backgroundColor: colors.surfaceSoft, paddingHorizontal: 14, paddingVertical: 8},
  slimText: {color: colors.textSecondary, fontSize: 11, lineHeight: 16},
  subnav: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 9,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subnavLabel: {color: colors.textSecondary, fontSize: 11, flex: 1, textAlign: 'right'},
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingVertical: 7,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.surface,
  },
  tab: {flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 10},
  tabActive: {backgroundColor: colors.accent},
  tabLabel: {color: colors.textSecondary, fontSize: 11, fontWeight: '800'},
  tabLabelActive: {color: colors.background},
});
