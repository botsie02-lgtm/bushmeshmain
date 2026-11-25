import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {colors} from '../../theme/colors';
import {
  ChatAvatarColor, ChatAvatarIcon, ChatPersonalisation, chatAvatarColors, chatAvatarIcons,
} from './chatPreferences';

const palette: Record<ChatAvatarColor, string> = {
  lime: '#D7FF4A', blue: '#8BC6FF', orange: '#FFBE81',
  purple: '#D1B2FF', teal: '#79E4CF', grey: '#C0CBD2',
};
const glyphs: Record<ChatAvatarIcon, string> = {
  initials: '', convoy: '▰', camp: '▲', mountain: '⛰', radio: '◉', people: '●●',
};

export function chatInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] ?? '').join('').toUpperCase() || '?';
}

export function ChatAvatar({name, avatarColor, avatarIcon, large = false}: {
  name: string; avatarColor: ChatAvatarColor; avatarIcon: ChatAvatarIcon; large?: boolean;
}): React.JSX.Element {
  return (
    <View accessible={false} style={[styles.avatar, large && styles.large,
      {backgroundColor: palette[avatarColor]}]}>
      <Text style={[styles.glyph, large && styles.largeGlyph]}>{glyphs[avatarIcon] || chatInitials(name)}</Text>
    </View>
  );
}

export function ChatAvatarPicker({name, value, onChange, disabled}: {
  name: string; value: ChatPersonalisation; onChange: (next: ChatPersonalisation) => void; disabled: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.group}>
      <View style={styles.preview}><ChatAvatar name={name} {...value} large/></View>
      <Text style={styles.label}>Avatar colour</Text>
      <View style={styles.choices}>
        {chatAvatarColors.map(color => (
          <TouchableOpacity key={color} accessibilityRole="button" accessibilityLabel={color}
            accessibilityState={{selected: value.avatarColor === color, disabled}}
            disabled={disabled} onPress={() => onChange({...value, avatarColor: color})}
            style={[styles.choice, value.avatarColor === color && styles.selected]}>
            <View style={[styles.swatch, {backgroundColor: palette[color]}]}/>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>Avatar icon</Text>
      <View style={styles.choices}>
        {chatAvatarIcons.map(icon => (
          <TouchableOpacity key={icon} accessibilityRole="button" accessibilityLabel={icon}
            accessibilityState={{selected: value.avatarIcon === icon, disabled}}
            disabled={disabled} onPress={() => onChange({...value, avatarIcon: icon})}
            style={[styles.choice, value.avatarIcon === icon && styles.selected]}>
            <Text style={styles.icon}>{glyphs[icon] || 'Aa'}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center'},
  large: {width: 76, height: 76, borderRadius: 38},
  glyph: {fontSize: 18, fontWeight: '800', color: colors.background},
  largeGlyph: {fontSize: 29},
  group: {gap: 8},
  preview: {alignItems: 'center', paddingVertical: 8},
  label: {fontSize: 14, fontWeight: '700', color: colors.textSecondary},
  choices: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  choice: {width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, backgroundColor: colors.surfaceSoft, borderWidth: 2, borderColor: colors.surfaceSoft},
  selected: {borderColor: colors.accent},
  swatch: {height: 26, width: 26, borderRadius: 13},
  icon: {fontSize: 20, color: colors.textPrimary},
});
