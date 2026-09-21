import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '../lib/api';
import { colors, gradients, radius, shadow, spacing, type } from '../theme';
import { Icon, type IconName } from './Icon';

export { Icon, type IconName } from './Icon';

/* ------------------------------ typography ------------------------------ */

export function T({
  children,
  variant = 'body',
  color = colors.text,
  style,
  numberOfLines,
  center,
  onPress,
}: {
  children: ReactNode;
  variant?: keyof typeof type;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  center?: boolean;
  onPress?: () => void;
}) {
  return (
    <Text numberOfLines={numberOfLines} onPress={onPress} accessibilityRole={onPress ? 'link' : undefined} style={[type[variant], { color }, center && { textAlign: 'center' }, style]}>
      {children}
    </Text>
  );
}

/* -------------------------------- layout -------------------------------- */

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  padded = true,
  edges = ['bottom'],
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  edges?: Array<'top' | 'bottom' | 'left' | 'right'>;
  style?: StyleProp<ViewStyle>;
}) {
  const content = padded ? { padding: spacing.lg, paddingBottom: spacing.xxl * 2 } : undefined;
  return (
    <SafeAreaView edges={edges} style={[styles.screen, style]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={content}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.brand} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, content]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Row({ children, gap = spacing.sm, style, wrap }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Section({
  title,
  icon,
  action,
  children,
  style,
}: {
  title: string;
  icon?: IconName;
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ marginTop: spacing.xl }, style]}>
      <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
        <Row gap={spacing.sm} style={{ flex: 1 }}>
          {icon ? <Icon name={icon} size={18} color={colors.brand} /> : null}
          <T variant="heading" style={{ flexShrink: 1 }}>{title}</T>
        </Row>
        {action}
      </Row>
      {children}
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

/* -------------------------------- buttons -------------------------------- */

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  small,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  const tint = variant === 'primary' ? colors.white : variant === 'danger' ? colors.danger : colors.brand;
  const label = (
    <Row gap={6} style={{ justifyContent: 'center' }}>
      {loading ? <ActivityIndicator color={tint} size="small" /> : icon ? <Icon name={icon} size={small ? 15 : 18} color={tint} /> : null}
      <Text numberOfLines={1} style={[type.label, { fontSize: small ? 13 : 15, color: tint }]}>
        {title}
      </Text>
    </Row>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [{ opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1, borderRadius: radius.pill }, style]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.button, small && styles.buttonSmall]}>
          {label}
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.button,
            small && styles.buttonSmall,
            variant === 'secondary' && { backgroundColor: colors.brandSoft },
            variant === 'danger' && { backgroundColor: colors.dangerSoft },
          ]}
        >
          {label}
        </View>
      )}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName | null }) {
  const tint = selected ? colors.white : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && { backgroundColor: colors.text, borderColor: colors.text }]}
    >
      <Row gap={6}>
        {icon ? <Icon name={icon} size={14} color={selected ? colors.white : colors.textMuted} /> : null}
        <Text style={[type.label, { color: tint }]}>{label}</Text>
      </Row>
    </Pressable>
  );
}

/** An icon in a soft rounded square: list rows, menu items, feature tiles. */
export function IconTile({ name, size = 40, tone = 'brand' }: { name: IconName; size?: number; tone?: 'brand' | 'accent' | 'muted' | 'success' | 'danger' | 'gold' | 'onDark' }) {
  const [background, foreground] = {
    brand: [colors.brandSoft, colors.brand],
    accent: [colors.accentSoft, colors.accent],
    muted: [colors.surfaceMuted, colors.textMuted],
    success: [colors.successSoft, colors.success],
    danger: [colors.dangerSoft, colors.danger],
    gold: [colors.goldSoft, colors.gold],
    onDark: ['rgba(255,255,255,0.16)', colors.white],
  }[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: background, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={Math.round(size * 0.5)} color={foreground} />
    </View>
  );
}

/* --------------------------------- inputs --------------------------------- */

export function Field({ label, error, hint, ...props }: TextInputProps & { label: string; error?: string; hint?: string }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <T variant="label" color={colors.textMuted} style={{ marginBottom: 6 }}>
        {label}
      </T>
      <TextInput
        placeholderTextColor={colors.textFaint}
        {...props}
        style={[styles.input, props.multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }, error && { borderColor: colors.danger }, props.style]}
      />
      {error ? (
        <T variant="caption" color={colors.danger} style={{ marginTop: 4 }}>
          {error}
        </T>
      ) : hint ? (
        <T variant="caption" color={colors.textMuted} style={{ marginTop: 4 }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

export function Toggle({ label, value, onChange, description }: { label: string; value: boolean; onChange: (value: boolean) => void; description?: string }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} style={{ paddingVertical: spacing.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <T variant="body">{label}</T>
          {description ? (
            <T variant="caption" color={colors.textMuted}>
              {description}
            </T>
          ) : null}
        </View>
        <View style={[styles.track, value && { backgroundColor: colors.brand }]}>
          <View style={[styles.thumb, value && { transform: [{ translateX: 18 }] }]} />
        </View>
      </Row>
    </Pressable>
  );
}

/* --------------------------------- media --------------------------------- */

const AVATAR_TINTS = ['#E8EAFE', '#E0F2FE', '#DCFCE7', '#FEF3C7', '#EEF1F5'];

export function Avatar({ name, uri, size = 44 }: { name: string; uri?: string | null; size?: number }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const tint = AVATAR_TINTS[(name.charCodeAt(0) || 0) % AVATAR_TINTS.length];
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint }} contentFit="cover" transition={150} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
      {initials ? <Text style={{ fontWeight: '700', color: colors.text, fontSize: size * 0.38 }}>{initials}</Text> : <Icon name="user" size={size * 0.5} color={colors.textMuted} />}
    </View>
  );
}

export function Badge({ label, tone = 'brand', icon }: { label: string; tone?: 'brand' | 'accent' | 'success' | 'danger' | 'gold' | 'muted' | 'info'; icon?: IconName }) {
  const palette = {
    brand: [colors.brandSoft, colors.brandDark],
    accent: [colors.accentSoft, colors.accent],
    success: [colors.successSoft, colors.success],
    danger: [colors.dangerSoft, colors.danger],
    gold: [colors.goldSoft, '#92400E'],
    muted: [colors.surfaceMuted, colors.textMuted],
    info: [colors.infoSoft, colors.info],
  }[tone];
  return (
    <View style={{ backgroundColor: palette[0], paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {icon ? <Icon name={icon} size={12} color={palette[1]} strokeWidth={2.4} /> : null}
      <Text style={[type.caption, { color: palette[1], fontWeight: '700' }]}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <View style={{ height: 10, backgroundColor: colors.surfaceMuted, borderRadius: radius.pill, overflow: 'hidden' }}>
      <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.max(2, Math.min(100, percent))}%`, height: '100%' }} />
    </View>
  );
}

/* --------------------------------- states --------------------------------- */

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ padding: spacing.xxl, alignItems: 'center', gap: spacing.md }}>
      <ActivityIndicator color={colors.brand} />
      {label ? <T color={colors.textMuted}>{label}</T> : null}
    </View>
  );
}

export function SkeletonCard({ height = 88 }: { height?: number }) {
  return <View style={[styles.card, { height, backgroundColor: colors.surfaceMuted, borderColor: colors.surfaceMuted, marginBottom: spacing.md }]} />;
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.sm }}>
      <View style={{ marginBottom: spacing.xs }}>
        <IconTile name={icon} size={56} tone="muted" />
      </View>
      <T variant="heading" center>
        {title}
      </T>
      {message ? (
        <T color={colors.textMuted} center>
          {message}
        </T>
      ) : null}
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.sm }}>
      <IconTile name="alert" size={48} tone="muted" />
      <T color={colors.textMuted} center>
        {errorMessage(error)}
      </T>
      {onRetry ? <Button title="Try again" variant="secondary" small onPress={onRetry} /> : null}
    </View>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <View style={{ backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
      <T color={colors.danger}>{errorMessage(error)}</T>
    </View>
  );
}

/** A detail line with a leading icon: phone, date, location, delivery. */
export function InfoRow({ icon, children, color = colors.text, style }: { icon: IconName; children: ReactNode; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Row gap={spacing.sm} style={[{ alignItems: 'flex-start', marginTop: 6 }, style]}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={icon} size={15} color={colors.textMuted} />
      </View>
      <T color={color} style={{ flex: 1 }}>
        {children}
      </T>
    </Row>
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  button: { minHeight: 50, paddingHorizontal: spacing.xl, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { minHeight: 38, paddingHorizontal: spacing.lg },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, fontSize: 16, color: colors.text },
  track: { width: 46, height: 28, borderRadius: 14, backgroundColor: colors.border, padding: 3 },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white },
});
