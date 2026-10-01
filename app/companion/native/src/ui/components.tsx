import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { colors, styles } from './styles';

export function Button({ title, onPress, disabled = false, variant = 'primary', busy = false, accessibilityLabel }: {
  title: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean; accessibilityLabel?: string;
}) {
  return <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled: disabled || busy, busy }}
    style={({ pressed }) => [styles.button, variant === 'secondary' && styles.buttonSecondary,
      variant === 'danger' && styles.buttonDanger, (disabled || busy) && styles.buttonDisabled,
      pressed && styles.buttonPressed]}>
    {busy && <ActivityIndicator size="small" color={colors.muted} />}
    <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonSecondaryText,
      variant === 'danger' && styles.buttonDangerText, (disabled || busy) && styles.buttonDisabledText]}>{title}</Text>
  </Pressable>;
}

export function TextButton({ title, onPress, disabled = false, accessibilityLabel }: {
  title: string; onPress: () => void; disabled?: boolean; accessibilityLabel?: string;
}) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled }}
    style={({ pressed }) => [styles.textButton, pressed && styles.buttonPressed]}>
    <Text style={[styles.textButtonText, disabled && styles.textButtonDisabled]}>{title}</Text>
  </Pressable>;
}

export function Badge({ children, tone = 'sage' }: { children: string; tone?: 'sage' | 'amber' | 'neutral' | 'red' }) {
  return <View style={[styles.badge, tone === 'amber' && styles.badgeAmber,
    tone === 'neutral' && styles.badgeNeutral, tone === 'red' && styles.badgeRed]}>
    <Text style={[styles.badgeText, tone === 'amber' && styles.badgeAmberText,
      tone === 'neutral' && styles.badgeNeutralText, tone === 'red' && styles.badgeRedText]}>{children}</Text>
  </View>;
}

export function Heading({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.screenHeading}><Text accessibilityRole="header" style={styles.title}>{title}</Text>
    <Text style={styles.subtitle}>{detail}</Text></View>;
}

export function Metadata({ label, value }: { label: string; value: string }) {
  return <View style={styles.metadataRow}><Text style={styles.metadataLabel}>{label}</Text>
    <Text selectable style={styles.value}>{value}</Text></View>;
}

export function ProofLinks({ receiptIds, onReceipt, disabled = false }: {
  receiptIds: string[]; onReceipt: (id: string) => void; disabled?: boolean;
}) {
  if (!receiptIds.length) return <Text style={styles.small}>No proof receipts attached.</Text>;
  return <View style={styles.section}>
    <Text style={styles.label}>PROOF RECEIPTS</Text>
    <View style={styles.wrap}>{receiptIds.map((id, index) => <TextButton key={id}
      title={`View receipt ${index + 1}`} accessibilityLabel={`View proof receipt ${index + 1}`}
      disabled={disabled} onPress={() => onReceipt(id)} />)}</View>
    {disabled && <Text style={styles.small}>Reconnect to open the supporting receipts.</Text>}
  </View>;
}
