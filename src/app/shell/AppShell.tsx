import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  BackHandler,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {ScreenMountGate} from '../ScreenMountGate';
import {ConnectedFieldPulse} from '../fieldExperience/ConnectedFieldPulse';
import type {FieldPulseKind} from '../fieldExperience/fieldPulseModel';
import {useActiveOperationalConvoy} from '../activeContext/ActiveOperationalConvoyContext';
import {RadioMessagingNavigationContext} from './RadioMessagingNavigation';
import {DeviceGpsSettingsPanel} from '../../components/DeviceGpsSettingsPanel';
import {MapPackCatalogPanel} from '../../components/MapPackCatalogPanel';
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
import {RecoveryCheckpointBanner} from '../../components/RecoveryCheckpointBanner';
import {RecoveryEscalationNotice} from '../../components/RecoveryEscalationNotice';
import {RecoveryReferenceNotice} from '../../components/RecoveryReferenceNotice';
import {RouteGuidanceBanner} from '../../components/RouteGuidanceBanner';
import {SecureDataStatusBanner} from '../../components/SecureDataStatusBanner';
import {SpeechStatusBanner} from '../../components/SpeechStatusBanner';
import {ActiveConvoyCarrierProfile} from '../../convoy/carrierCredentials';
import {ConnectedConvoyEnrolment} from '../../convoy/ui/ConnectedConvoyEnrolment';
import {ConnectedDriveDashboard} from '../../drive/dashboard/ConnectedDriveDashboard';
import {ConnectedFieldReadinessDashboard} from '../../drive/fieldReadiness/ConnectedFieldReadinessDashboard';
import type {ConvoyMapMember} from '../../maps/convoyMapModel';
import {ContactsScreen} from '../../screens/ContactsScreen';
import {ConvoyScreen} from '../../screens/ConvoyScreen';
import {DeviceHubScreen} from '../../screens/DeviceHubScreen';
import {DriveScreen} from '../../screens/DriveScreen';
import {LocationScreen} from '../../screens/LocationScreen';
import {MapScreen} from '../../screens/MapScreen';
import {RadioScreen} from '../../screens/RadioScreen';
import {RadioMessagingSettingsScreen} from '../../screens/RadioMessagingSettingsScreen';
import {colors} from '../../theme/colors';

export type MainTab = 'drive' | 'radio' | 'convoy' | 'contacts' | 'device';
type DriveView = 'home' | 'dashboard' | 'map' | 'legacy';
type ConvoyView = 'select' | 'tools' | 'enrolment';
type DeviceView = 'hub' | 'gps' | 'maps';

/** Do not pass untrusted MeshCore contacts or legacy vehicle positions to
 * ConvoyMap as authorised members. Wire a Security v1 membership-scoped
 * position projection here when that separately verified source is available. */
const NO_AUTHORISED_MAP_MEMBER_POSITIONS: readonly ConvoyMapMember[] = [];

export const MAIN_TABS: ReadonlyArray<{key: MainTab; label: string; symbol: string}> = [
  {key: 'drive', label: 'Drive', symbol: '➤'},
  {key: 'radio', label: 'Radio', symbol: '≋'},
  {key: 'convoy', label: 'Convoy', symbol: '◈'},
  {key: 'contacts', label: 'Contacts', symbol: '◎'},
  {key: 'device', label: 'Device', symbol: '⚙'},
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

function ConvoySelector({openTools, openEnrolment, openFieldSection}: {
  openTools: () => void;
  openEnrolment: () => void;
  openFieldSection: (section: FieldPulseKind) => void;
}): React.JSX.Element {
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
      <Text style={styles.heroTitle}>Travel together. Stay informed.</Text>
      <Text style={styles.lead}>Pick a verified convoy, review joining, or manage your carrier.</Text>
      <ConnectedFieldPulse onOpen={openFieldSection} />
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
          ? 'No authenticated Security identity is available. A MeshCore companion alone does not grant membership.'
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
        eyebrow="SECURE CONVOY ENROLMENT · NOT AVAILABLE"
        title="Authenticated joining is disabled"
        description="Preview the reviewed enrolment interface. No production Security v1 identity or Security v2 group transaction is connected, and no requests, approvals or group-key changes can be sent.">
        <Action label="View unavailable secure enrolment" onPress={openEnrolment} secondary />
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
  const [gpsView, setGpsView] = useState<'controls' | 'preferences'>('controls');
  const [carrierProfile, setCarrierProfile] =
    useState<ActiveConvoyCarrierProfile | null>(null);
  const {activeConvoy, status: convoyRestoreStatus} = useActiveOperationalConvoy();
  const [radioSettingsOpen, setRadioSettingsOpen] = useState(false);
  const openMessagingSettings = useCallback(() => {
    Keyboard.dismiss();
    setRadioSettingsOpen(true);
  }, []);
  const closeMessagingSettings = useCallback(() => setRadioSettingsOpen(false), []);
  const radioNavigation = useMemo(() => ({
    openMessagingSettings, closeMessagingSettings,
  }), [openMessagingSettings, closeMessagingSettings]);

  useEffect(() => {
    if (activeTab !== 'radio') {
      closeMessagingSettings();
      return;
    }
    if (!radioSettingsOpen) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeMessagingSettings();
      return true;
    });
    return () => subscription.remove();
  }, [activeTab, radioSettingsOpen, closeMessagingSettings]);

  const openConvoy = () => {
    setConvoyView('select');
    setActiveTab('convoy');
  };

  const openFieldSection = (section: FieldPulseKind) => {
    switch (section) {
      case 'radio':
        setActiveTab('radio');
        break;
      case 'gps':
        setDeviceView('gps');
        setGpsView('controls');
        setActiveTab('device');
        break;
      case 'maps':
        setDeviceView('maps');
        setActiveTab('device');
        break;
      case 'convoy':
        openConvoy();
        break;
    }
  };

  return (
    <View style={styles.shell}>
      {activeTab === 'radio' ? (radioSettingsOpen ? (
        <View style={styles.radioHeader}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to Radio"
            style={styles.radioHeaderButton} onPress={closeMessagingSettings}>
            <Text style={styles.radioHeaderAction}>‹ Back</Text>
          </TouchableOpacity>
          <View style={styles.radioHeaderCopy}>
            <Text style={styles.radioHeaderTitle}>Messaging settings</Text>
          </View>
        </View>
      ) : null) : (
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
              style={[styles.headerStatusValue,
                convoyRestoreStatus === 'ready' && activeConvoy &&
                styles.headerStatusActive]}>
              {convoyRestoreStatus === 'checking'
                ? 'Checking access…'
                : convoyRestoreStatus === 'ready' && activeConvoy
                  ? activeConvoy.displayName : 'No verified convoy'}
            </Text>
          </View>
        </View>
      </View>
      )}

      <View style={styles.content}>
        <ScreenMountGate active={activeTab === 'drive'}>
          {driveView === 'home' ? (
            <View style={styles.screen}>
              <ConnectedFieldPulse onOpen={openFieldSection} compact />
              <View style={styles.subnav}>
                <Action
                  label="Detailed Drive dashboard"
                  onPress={() => setDriveView('dashboard')}
                  secondary
                />
              </View>
              <ConnectedFieldReadinessDashboard
                onOpenMap={() => setDriveView('map')}
                onManageMapPacks={() => {
                  setDeviceView('maps');
                  setActiveTab('device');
                }}
                onOpenConvoy={openConvoy}
                onOpenRadio={() => setActiveTab('radio')}
                onOpenGpsSettings={() => {
                  setDeviceView('gps');
                  setGpsView('preferences');
                  setActiveTab('device');
                }}
                roster={null}
                verifiedAlerts={null}
                carrierBinding={null}
              />
            </View>
          ) : driveView === 'dashboard' ? (
            <View style={styles.screen}>
              <View style={styles.subnav}>
                <Action label="Back to Drive" onPress={() => setDriveView('home')} secondary />
                <Text style={styles.subnavLabel}>Detailed Drive dashboard</Text>
              </View>
              <ConnectedDriveDashboard
                onOpenConvoy={openConvoy}
                onOpenMap={() => setDriveView('map')}
                onOpenRadio={() => setActiveTab('radio')}
                onOpenDevice={() => {setDeviceView('hub'); setActiveTab('device');}}
                roster={null}
                verifiedAlerts={null}
                carrierBinding={null}
                showInlineMap={false}
              />
            </View>
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
                  <MapScreen
                    activeConvoyId={activeConvoy?.convoyId ?? null}
                    authorisedMembers={NO_AUTHORISED_MAP_MEMBER_POSITIONS}
                    showChannelFieldTest
                    onManageMapPacks={() => {
                      setDeviceView('maps');
                      setActiveTab('device');
                    }}
                  />
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
          <RadioMessagingNavigationContext.Provider value={radioNavigation}>
            {/* Keep only the messenger's local draft/navigation state alive while
                the settings subpage is open. All runtime owners are above AppShell.
                The entire Radio subtree still unmounts on leaving its tab. */}
            <View
              testID="radio-messenger-surface"
              style={[styles.screen, radioSettingsOpen && styles.radioCovered]}
              accessibilityElementsHidden={radioSettingsOpen}
              importantForAccessibility={radioSettingsOpen ? 'no-hide-descendants' : 'auto'}
              pointerEvents={radioSettingsOpen ? 'none' : 'auto'}>
              <RadioScreen
                enableChatManagement
                settingsVisible={radioSettingsOpen}
                onOpenMessagingSettings={openMessagingSettings}
                onOpenCarrierDetails={() => {
                  setConvoyView('tools');
                  setActiveTab('convoy');
                }}
              />
            </View>
            {radioSettingsOpen ? <RadioMessagingSettingsScreen /> : null}
          </RadioMessagingNavigationContext.Provider>
        </ScreenMountGate>

        <ScreenMountGate active={activeTab === 'convoy'}>
          {convoyView === 'select' ? (
            <ConvoySelector
              openTools={() => setConvoyView('tools')}
              openEnrolment={() => setConvoyView('enrolment')}
              openFieldSection={openFieldSection}
            />
          ) : convoyView === 'enrolment' ? (
            <View style={styles.screen}>
              <View style={styles.subnav}>
                <Action label="Back to convoy selection" onPress={() => setConvoyView('select')} secondary />
              </View>
              {/* Default null service/identity and false capabilities prevent production mutations. */}
              <ConnectedConvoyEnrolment
                onOpenDrive={() => {setDriveView('home'); setActiveTab('drive');}}
                onOpenMap={() => {setDriveView('map'); setActiveTab('drive');}}
              />
            </View>
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
                  <Action
                    label="GPS and location"
                    onPress={() => {setGpsView('controls'); setDeviceView('gps');}}
                    secondary
                  />
                  <Action
                    label="Offline map packs"
                    onPress={() => setDeviceView('maps')}
                    secondary
                  />
                </>
              ) : (
                <>
                  <Action label="Back to Device" onPress={() => setDeviceView('hub')} secondary />
                  <Text style={styles.subnavLabel}>
                    {deviceView === 'gps' ? 'GPS settings' : 'Offline map packs'}
                  </Text>
                  {deviceView === 'gps' ? (
                    <Action
                      label={gpsView === 'controls' ? 'GPS preferences' : 'GPS controls'}
                      onPress={() => setGpsView(gpsView === 'controls' ? 'preferences' : 'controls')}
                      secondary
                    />
                  ) : null}
                </>
              )}
            </View>
            {deviceView === 'gps' ? (
              gpsView === 'preferences' ? <DeviceGpsSettingsPanel /> : <LocationScreen />
            ) : deviceView === 'maps' ? (
              <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
                <Text style={styles.eyebrow}>DEVICE / OFFLINE RESOURCES</Text>
                <Text style={styles.heroTitle}>Offline map packs</Text>
                <Text style={styles.lead}>
                  Download, import and verify real regional archives here.
                  Open the map from Drive to inspect rendered tiles.
                  Verified archive metadata is not proof of a loaded image.
                </Text>
                <MapPackCatalogPanel />
              </ScrollView>
            ) : (
              <DeviceHubScreen onOpenMapPacks={() => setDeviceView('maps')} />
            )}
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
              accessibilityHint={'Open ' + tab.label + ' section'}
              onPress={() => {
                closeMessagingSettings();
                setActiveTab(tab.key);
              }}>
              <Text accessible={false}
                style={[styles.tabSymbol, selected && styles.tabLabelActive]}>
                {tab.symbol}
              </Text>
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
  radioHeader: {minHeight: 52, paddingHorizontal: 12, flexDirection: 'row',
    alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border},
  radioHeaderCopy: {flex: 1},
  radioHeaderTitle: {color: colors.textPrimary, fontSize: 19, fontWeight: '800'},
  radioHeaderButton: {minHeight: 48, justifyContent: 'center', paddingHorizontal: 8},
  radioHeaderAction: {color: colors.accent, fontWeight: '800', fontSize: 14},
  radioCovered: {display: 'none'},
  headerTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  brand: {color: colors.textPrimary, fontSize: 23, fontWeight: '800'},
  brandDetail: {color: colors.textSecondary, fontSize: 10, letterSpacing: 1, marginTop: 2},
  headerStatus: {maxWidth: '47%', alignItems: 'flex-end'},
  headerStatusLabel: {color: colors.textSecondary, fontSize: 10, fontWeight: '700'},
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
    minHeight: 56,
    backgroundColor: colors.accent,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 10,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  secondaryAction: {backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border},
  disabled: {opacity: 0.45},
  actionText: {color: colors.background, fontWeight: '800', fontSize: 14, textAlign: 'center'},
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
    flexWrap: 'wrap',
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
  tab: {flex: 1, minHeight: 64, justifyContent: 'center', alignItems: 'center',
    borderRadius: 12, gap: 3},
  tabActive: {backgroundColor: colors.accent},
  tabSymbol: {color: colors.textSecondary, fontSize: 19, fontWeight: '800'},
  tabLabel: {color: colors.textSecondary, fontSize: 12, fontWeight: '800'},
  tabLabelActive: {color: colors.background},
});
