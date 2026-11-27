import React, {useEffect, useState} from 'react';
import {Linking, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View} from 'react-native';

import {CarMessagingStatusBanner} from '../components/CarMessagingStatusBanner';
import {RadioSpeechStatusBanner} from '../components/RadioSpeechStatusBanner';
import {SecureDataStatusBanner} from '../components/SecureDataStatusBanner';
import {VoiceReadinessPanel} from '../speech/VoiceReadinessPanel';
import {SpeechStatusBanner} from '../components/SpeechStatusBanner';
import {meshCoreInboundDiagnostics} from '../meshcore/meshcoreInboundDiagnostics';
import {nativeOutboundDiagnostics} from '../meshcore/nativeOutboundDiagnostics';
import {nativeCarMessaging} from '../native/NativeCarMessaging';
import {useCarMessaging} from '../state/CarMessagingContext';
import {useSpeech} from '../state/SpeechContext';
import {colors} from '../theme/colors';
import {NativeRadioSetupScreen} from './NativeRadioSetupScreen';
import {QuickMessageEditor} from '../radio/chatManagement/QuickMessageEditor';
import {chatPreferenceStore, DEFAULT_QUICK_MESSAGES} from '../radio/chatManagement/chatPreferences';
import {RadioQuarantineReview} from './radioMessenger/RadioQuarantineReview';
import {useBushMesh} from '../state/BushMeshContext';

export type RadioSettingsPage = 'hub' | 'connection' | 'quick' | 'notifications' | 'speech' | 'ptt' | 'history' | 'privacy' | 'diagnostics';
export const RADIO_SETTINGS_LABELS: Record<RadioSettingsPage, string> = {hub: 'Messaging settings', connection: 'Radio connection', quick: 'Quick messages', notifications: 'Notifications and Android Auto', speech: 'Speech and auto-read', ptt: 'Speech-to-text setup', history: 'Radio History', privacy: 'Privacy and storage', diagnostics: 'Advanced diagnostics'};

function Section({
  heading,
  detail,
  children,
}: {
  heading: string;
  detail: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{heading}</Text>
      <Text style={styles.detail}>{detail}</Text>
      {children}
    </View>
  );
}

/** Presentation only: runtime providers and bridges live above the tab shell. */
export function RadioMessagingSettingsScreen({page = 'hub', onNavigate, onBack}: {page?: RadioSettingsPage; onNavigate?: (page: RadioSettingsPage) => void; onBack?: () => void}): React.JSX.Element {
  if (page === 'connection') return <NativeRadioSetupScreen/>;
  if (page === 'quick') return <GlobalQuickMessages onBack={onBack ?? (() => undefined)}/>;
  if (page === 'history') return <HistoryPage onBack={onBack ?? (() => undefined)}/>;
  if (page === 'hub') return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>{(Object.keys(RADIO_SETTINGS_LABELS) as RadioSettingsPage[]).filter(key => key !== 'hub').map(key => <TouchableOpacity key={key} accessibilityRole="button" accessibilityLabel={RADIO_SETTINGS_LABELS[key]} style={styles.destination} onPress={() => onNavigate?.(key)}><Text style={styles.heading}>{RADIO_SETTINGS_LABELS[key]}</Text><Text style={styles.actionText}>›</Text></TouchableOpacity>)}</ScrollView>;
  return <SettingsDetail page={page}/>;
}
function HistoryPage({onBack}: {onBack: () => void}) {
  const {channelMessages} = useBushMesh();
  return <RadioQuarantineReview messages={channelMessages ?? []} allHistory onBack={onBack}/>;
}
function GlobalQuickMessages({onBack}: {onBack: () => void}) {
  const [values, setValues] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {let active = true; chatPreferenceStore.loadGlobalQuickMessages().then(v => {if (active) setValues(v);}).catch(() => {if (active) setFailed(true);}); return () => {active = false;};}, []);
  return values ? <QuickMessageEditor initial={values} defaults={DEFAULT_QUICK_MESSAGES} onSave={v => chatPreferenceStore.saveGlobalQuickMessages(v)} onClose={onBack}/> : <Text style={styles.detail}>{failed ? 'Protected templates could not be loaded. Existing storage retained.' : 'Loading templates…'}</Text>;
}
function NotificationPreviewSetting() {
  const [show, setShow] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {let alive = true; nativeCarMessaging.getNotificationPreview().then(value => {if (alive) setShow(value);}).catch(() => {if (alive) setError(true);}); return () => {alive = false;};}, []);
  return <View><Text style={styles.detail}>Show message text in new Android and Android Auto notifications. Applies globally, including native background reception. Channel labels remain visible.</Text>
    {show !== null && <Switch accessibilityLabel="Show notification message previews" value={show} disabled={busy} onValueChange={value => {setBusy(true); setError(false); nativeCarMessaging.setNotificationPreview(value).then(() => setShow(value)).catch(() => setError(true)).finally(() => setBusy(false));}}/>}
    {error && <Text style={styles.warning}>Notification preview preference could not be loaded or saved.</Text>}
  </View>;
}
function SettingsDetail({page}: {page: RadioSettingsPage}): React.JSX.Element {
  const {supported, runtimeState, languageTag, errorMessage} = useSpeech();
  const {supported: carSupported} = useCarMessaging();
  const [inbound, setInbound] = useState(() => meshCoreInboundDiagnostics.snapshot());
  const [outbound, setOutbound] = useState(() => nativeOutboundDiagnostics.snapshot());
  const [settingsError, setSettingsError] = useState(false);

  useEffect(() => {
    const unsubscribeInbound = meshCoreInboundDiagnostics.subscribe(() => {
      setInbound(meshCoreInboundDiagnostics.snapshot());
    });
    const unsubscribeOutbound = nativeOutboundDiagnostics.subscribe(() => {
      setOutbound(nativeOutboundDiagnostics.snapshot());
    });
    return () => {
      unsubscribeInbound();
      unsubscribeOutbound();
    };
  }, []);

  const lastIssue = outbound.events.find(event =>
    event.stage === 'response-timeout' ||
    event.stage === 'firmware-rejected' ||
    event.stage === 'write-failed' ||
    event.stage === 'stop-failed' ||
    event.stage === 'session-disconnected',
  );

  return (
    <ScrollView
      accessibilityLabel="Radio messaging settings content"
      style={styles.screen}
      contentContainerStyle={styles.content}>
      {page === 'notifications' && <Section
        heading="Android Auto & notifications"
        detail="Android Auto read/reply depends on notification permission and compatible device support. Notification permission is separate from local speech and radio delivery.">
        {carSupported ? <CarMessagingStatusBanner /> : (
          <Text style={styles.detail}>Android Auto messaging is unavailable in this build.</Text>
        )}
        {nativeCarMessaging.previewSupported() && <NotificationPreviewSetting/>}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open system notification settings"
          style={styles.action}
          onPress={() => {
            setSettingsError(false);
            Linking.openSettings().catch(() => setSettingsError(true));
          }}>
          <Text style={styles.actionText}>Open system app settings</Text>
        </TouchableOpacity>
        {settingsError ? (
          <Text style={styles.warning}>Could not open settings. Use your device settings.</Text>
        ) : null}
      </Section>}
      {page === 'speech' && <><Section
        heading="Incoming message auto-read"
        detail="Global auto-read enables ordinary incoming speech. Each verified chat also has its own auto-read preference and timed speech mute. Explicit readback remains available.">
        {supported ? <RadioSpeechStatusBanner /> : (
          <Text style={styles.detail}>Local speech is unavailable in this build.</Text>
        )}
      </Section>
      <Section
        heading="Speech & critical alerts"
        detail="Critical voice alerts have a separate preference. Local voice playback can be heard by nearby people.">
        <Text style={styles.detail}>
          Voice runtime: {runtimeState}{languageTag ? ' · ' + languageTag : ''}
        </Text>
        {errorMessage ? <Text style={styles.warning}>{errorMessage}</Text> : null}
        <SpeechStatusBanner />
      </Section></>}
      {page === 'ptt' && <Section
        heading="Speech-to-text setup"
        detail="Choose or download an offline language for dictation. The microphone adds text to your draft only; you send messages yourself. Opening settings never activates the microphone.">
        <VoiceReadinessPanel />
      </Section>}
      {page === 'privacy' && <Section
        heading="Message history & privacy"
        detail="MeshCore carrier traffic is not necessarily part of an authorised BushMesh convoy. A private carrier does not prove verified membership.">
        <SecureDataStatusBanner kind="messages" />
      </Section>}
      {page === 'diagnostics' && <Section
        heading="Radio diagnostics"
        detail="Runtime counters are not delivery receipts. GATT confirmation and a matched MeshCore response do not establish peer delivery.">
        <Text style={styles.detail}>
          Commands queued: {outbound.counts['command-queued'] ?? 0}
          {' · GATT callbacks: '}{outbound.counts['gatt-write-confirmed'] ?? 0}
          {' · Matched responses: '}{outbound.counts['response-matched'] ?? 0}
        </Text>
        <Text style={styles.detail}>
          Timeouts: {outbound.counts['response-timeout'] ?? 0}
          {' · Write failures: '}{outbound.counts['write-failed'] ?? 0}
          {' · Firmware rejected: '}{outbound.counts['firmware-rejected'] ?? 0}
        </Text>
        <Text style={styles.detail}>
          Inbound persisted: {inbound.counts.persisted ?? 0}
          {' · History visible: '}{inbound.counts['history-visible'] ?? 0}
          {' · Duplicates: '}{inbound.counts.duplicate ?? 0}
        </Text>
        <Text style={styles.detail}>
          Drain errors: {inbound.counts['drain-error'] ?? 0}
          {' · Storage errors: '}{inbound.counts['persistence-error'] ?? 0}
        </Text>
        {lastIssue ? (
          <Text style={styles.warning}>
            Last native issue: {lastIssue.stage}{lastIssue.reason ? ' / ' + lastIssue.reason : ''}
          </Text>
        ) : null}
      </Section>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 32, gap: 12},
  destination: {minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 14, padding: 16},
  section: {backgroundColor: colors.surface, borderColor: colors.border,
    borderWidth: 1, borderRadius: 14, padding: 12, gap: 8},
  heading: {color: colors.textPrimary, fontSize: 16, fontWeight: '800'},
  detail: {color: colors.textSecondary, fontSize: 12, lineHeight: 18},
  warning: {color: colors.warning, fontSize: 12, lineHeight: 18},
  action: {minHeight: 48, borderRadius: 10, borderWidth: 1,
    borderColor: colors.border, justifyContent: 'center', paddingHorizontal: 12},
  actionText: {color: colors.accent, fontSize: 13, fontWeight: '800'},
});
