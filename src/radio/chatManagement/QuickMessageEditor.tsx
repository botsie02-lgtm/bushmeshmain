import React, {useState} from 'react';
import {Alert, KeyboardAvoidingView, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors} from '../../theme/colors';
import {validateCarrierText} from '../../screens/radioMessenger/messengerModel';
import {DEFAULT_QUICK_MESSAGES} from './chatPreferences';

export function QuickMessageEditor({initial, defaults = DEFAULT_QUICK_MESSAGES, onSave, onClose}: {
  initial: readonly string[]; defaults?: readonly string[]; onSave: (values: string[]) => Promise<void>; onClose: () => void;
}) {
  const [values, setValues] = useState([...initial]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(initial) !== JSON.stringify(values);
  const cancel = () => {
    if (saving) return;
    if (!dirty) onClose();
    else Alert.alert('Discard changes?', 'Unsaved templates will be lost.', [{text: 'Keep editing', style: 'cancel'}, {text: 'Discard', style: 'destructive', onPress: onClose}]);
  };
  const action = (label: string, press: () => void, disabled = false) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={disabled || saving} onPress={press} style={[styles.action, disabled && styles.disabled]}><Text style={styles.link}>{label}</Text></TouchableOpacity>;
  const move = (index: number, offset: number) => setValues(previous => {const next = [...previous]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next;});
  const valid = values.length > 0 && values.every(v => validateCarrierText(v).valid);
  return <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={cancel}><SafeAreaView style={styles.root}><KeyboardAvoidingView style={styles.root}>
    <View style={styles.header}>{action('Cancel', cancel)}<Text style={styles.title}>Quick messages</Text>{action('Save', () => {
      setSaving(true); setError('');
      onSave(values.map(v => v.trim())).then(onClose).catch(() => setError('Save failed. Existing templates retained.')).finally(() => setSaving(false));
    }, !valid)}</View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.body}>Edit and reorder templates. Selecting a saved template only fills the message draft.</Text>
      {values.map((value, index) => <View key={index} style={styles.item}>
        <TextInput accessibilityLabel={'Template ' + (index + 1)} multiline value={value} editable={!saving} onChangeText={text => setValues(current => current.map((v, i) => i === index ? text : v))} style={styles.input}/>
        <Text style={styles.body}>{validateCarrierText(value).bytes}/133 UTF-8 bytes</Text>
        <View style={styles.header}>{action('Move up ' + (index + 1), () => move(index, -1), index === 0)}{action('Move down ' + (index + 1), () => move(index, 1), index === values.length - 1)}{action('Delete ' + (index + 1), () => setValues(current => current.filter((_, i) => i !== index)))}</View>
      </View>)}
      {action('Add template', () => setValues(current => [...current, '']), values.length >= 24)}
      {action('Restore defaults', () => Alert.alert('Restore defaults?', 'Replaces the current draft library when saved.', [{text: 'Cancel', style: 'cancel'}, {text: 'Restore', onPress: () => setValues([...defaults])}]))}
      {!!error && <Text accessibilityRole="alert" style={styles.body}>{error}</Text>}
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView></Modal>;
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background}, header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6}, title: {color: colors.textPrimary, fontSize: 18, fontWeight: '800'}, content: {padding: 16, paddingBottom: 40, gap: 12}, item: {backgroundColor: colors.surface, borderRadius: 14, padding: 12}, input: {color: colors.textPrimary, minHeight: 68, backgroundColor: colors.surfaceSoft, padding: 12, borderRadius: 10}, body: {color: colors.textSecondary, marginVertical: 6}, action: {minHeight: 48, paddingHorizontal: 8, justifyContent: 'center'}, link: {color: colors.accent, fontWeight: '700'}, disabled: {opacity: 0.4},
});
