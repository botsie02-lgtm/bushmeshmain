import React, {useEffect, useState} from 'react';
import {Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {CarMessagingStatusBanner} from '../components/CarMessagingStatusBanner';
import {RadioSpeechStatusBanner} from '../components/RadioSpeechStatusBanner';
import {SecureDataStatusBanner} from '../components/SecureDataStatusBanner';
import {SpeechPttPanel} from '../components/SpeechPttPanel';
import {SpeechStatusBanner} from '../components/SpeechStatusBanner';
import {meshCoreInboundDiagnostics} from '../meshcore/meshcoreInboundDiagnostics';
import {nativeOutboundDiagnostics} from '../meshcore/nativeOutboundDiagnostics';
import {useCarMessaging} from '../state/CarMessagingContext';
import {useSpeech} from '../state/SpeechContext';
import {colors} from '../theme/colors';

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
export function RadioMessagingSettingsScreen(): React.JSX.Element {
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
      <Section
        heading="Android Auto & notifications"
        detail="Android Auto read/reply depends on notification permission and compatible device support. Notification permission is separate from local speech and radio delivery.">
        {carSupported ? <CarMessagingStatusBanner /> : (
          <Text style={styles.detail}>Android Auto messaging is unavailable in this build.</Text>
        )}
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
      </Section>
      <Section
        heading="Incoming message auto-read"
        detail="Auto-read mute is a global local speech preference, not a per-conversation mute. Replay Last speaks the latest received channel message aloud, even when auto-read is off.">
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
      </Section>
      <Section
        heading="Push-to-talk diagnostics"
        detail="Hold to create a local speech draft, then review it before explicitly submitting text to the selected MeshCore carrier. Opening settings never activates the microphone.">
        <SpeechPttPanel />
      </Section>
      <Section
        heading="Message history & privacy"
        detail="MeshCore carrier traffic is not necessarily part of an authorised BushMesh convoy. A private carrier does not prove verified membership.">
        <SecureDataStatusBanner kind="messages" />
      </Section>
      <Section
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
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  content: {padding: 16, paddingBottom: 32, gap: 12},
  section: {backgroundColor: colors.surface, borderColor: colors.border,
    borderWidth: 1, borderRadius: 14, padding: 12, gap: 8},
  heading: {color: colors.textPrimary, fontSize: 16, fontWeight: '800'},
  detail: {color: colors.textSecondary, fontSize: 12, lineHeight: 18},
  warning: {color: colors.warning, fontSize: 12, lineHeight: 18},
  action: {minHeight: 48, borderRadius: 10, borderWidth: 1,
    borderColor: colors.border, justifyContent: 'center', paddingHorizontal: 12},
  actionText: {color: colors.accent, fontSize: 13, fontWeight: '800'},
});
