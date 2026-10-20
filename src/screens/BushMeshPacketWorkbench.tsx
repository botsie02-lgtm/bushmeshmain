import {Buffer} from 'buffer';
import React, {useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  BushMeshPriority,
  encodeBushMeshTextMessage,
  estimateLoRaAirtimeMs,
  inspectBushMeshPacket,
} from '../bushmesh/protocol';
import {colors} from '../theme/colors';

const SPREADING_FACTORS = [7, 9, 12] as const;

export function BushMeshPacketWorkbench(): React.JSX.Element {
  const [text, setText] = useState('heading back to camp in 20 minutes');
  const [spreadingFactor, setSpreadingFactor] = useState<number>(9);

  const analysis = useMemo(() => {
    try {
      const encoded = encodeBushMeshTextMessage(text, 1, {
        priority: BushMeshPriority.DirectMessage,
        ackRequested: true,
        storeAndForward: true,
        ttlHops: 4,
        semantic: true,
      });
      const inspected = inspectBushMeshPacket(encoded.wireBytes);
      const carrierBytes = Buffer.byteLength(encoded.textSafeCarrier, 'utf8');
      const rawAirtime = estimateLoRaAirtimeMs(encoded.wireBytes.length, {
        spreadingFactor,
        bandwidthHz: 125000,
        codingRateDenominator: 5,
      });
      const carrierAirtime = estimateLoRaAirtimeMs(carrierBytes, {
        spreadingFactor,
        bandwidthHz: 125000,
        codingRateDenominator: 5,
      });

      return {
        error: null,
        originalBytes: encoded.originalByteLength,
        payloadBytes: encoded.payloadByteLength,
        wireBytes: encoded.wireBytes.length,
        carrierBytes,
        compressionName: inspected.compressionName,
        hex: inspected.hex,
        textSafeCarrier: encoded.textSafeCarrier,
        rawAirtime,
        carrierAirtime,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Packet analysis failed.',
        originalBytes: 0,
        payloadBytes: 0,
        wireBytes: 0,
        carrierBytes: 0,
        compressionName: '--',
        hex: '',
        textSafeCarrier: '',
        rawAirtime: 0,
        carrierAirtime: 0,
      };
    }
  }, [spreadingFactor, text]);

  const savings = Math.max(0, analysis.originalBytes - analysis.payloadBytes);
  const savingsPercent =
    analysis.originalBytes > 0
      ? Math.round((savings / analysis.originalBytes) * 100)
      : 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Packet / Airtime Workbench</Text>
      <Text style={styles.body}>
        Preview how BushMesh would encode a message without transmitting it. Airtime
        estimates use a 125 kHz LoRa bandwidth and coding rate 4/5; MeshCore/radio
        framing overhead is not included.
      </Text>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        multiline
        textAlignVertical="top"
        placeholder="Enter a candidate BushMesh message"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>Spreading factor</Text>
      <View style={styles.sfRow}>
        {SPREADING_FACTORS.map(sf => (
          <TouchableOpacity
            key={sf}
            style={[styles.sfButton, spreadingFactor === sf && styles.sfButtonActive]}
            onPress={() => setSpreadingFactor(sf)}>
            <Text
              style={[
                styles.sfText,
                spreadingFactor === sf && styles.sfTextActive,
              ]}>
              SF{sf}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {analysis.error ? (
        <Text style={styles.errorText}>{analysis.error}</Text>
      ) : (
        <>
          <View style={styles.metricGrid}>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>Compression</Text>
              <Text style={styles.metricValue}>{analysis.compressionName}</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>UTF-8 input</Text>
              <Text style={styles.metricValue}>{analysis.originalBytes} B</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>Compressed payload</Text>
              <Text style={styles.metricValue}>{analysis.payloadBytes} B</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>Payload saving</Text>
              <Text style={styles.metricValue}>{savingsPercent}%</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>Raw BushMesh wire</Text>
              <Text style={styles.metricValue}>{analysis.wireBytes} B</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>~BM1 carrier</Text>
              <Text style={styles.metricValue}>{analysis.carrierBytes} B</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>Raw airtime</Text>
              <Text style={styles.metricValue}>{analysis.rawAirtime.toFixed(1)} ms</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>Safe-carrier airtime</Text>
              <Text style={styles.metricValue}>{analysis.carrierAirtime.toFixed(1)} ms</Text>
            </View>
          </View>

          <Text style={styles.label}>Wire HEX</Text>
          <ScrollView horizontal style={styles.codeBox}>
            <Text style={styles.codeText} selectable>{analysis.hex}</Text>
          </ScrollView>

          <Text style={styles.label}>Text-safe carrier</Text>
          <ScrollView horizontal style={styles.codeBox}>
            <Text style={styles.codeText} selectable>
              {analysis.textSafeCarrier}
            </Text>
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  body: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  input: {
    marginTop: 12,
    minHeight: 76,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    padding: 11,
    fontSize: 13,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 6,
  },
  sfRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sfButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 9,
    alignItems: 'center',
  },
  sfButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  sfText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '900',
  },
  sfTextActive: {
    color: colors.background,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  metricBox: {
    minWidth: '45%',
    flexGrow: 1,
    borderRadius: 10,
    backgroundColor: colors.background,
    padding: 9,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 3,
  },
  codeBox: {
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 9,
  },
  codeText: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 15,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 12,
  },
});
