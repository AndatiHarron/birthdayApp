import {
  PRIORITY_META,
  formatMoney,
  isSupportedCurrency,
  type GiftIdeaDto,
  type ProductDto,
  type TrackedBirthdayDto,
  type WishlistItemDto,
} from '@bday/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import { Avatar, Badge, Button, Card, Row, T } from './ui';

export function money(amountMinor: number | null | undefined, currency = 'KES'): string {
  if (amountMinor == null) return '';
  return isSupportedCurrency(currency) ? formatMoney(amountMinor, currency) : `${currency} ${Math.round(amountMinor / 100)}`;
}

/** Birthday card on the home screen and calendar list (spec §6). */
export function BirthdayCard({ birthday, compact }: { birthday: TrackedBirthdayDto; compact?: boolean }) {
  const today = birthday.countdown.isToday;
  return (
    <Card onPress={() => router.push(`/birthday/${birthday.id}`)} style={[{ marginBottom: spacing.md }, today && { borderColor: colors.pink, backgroundColor: '#FFF7FB' }]}>
      <Row gap={spacing.md}>
        <Avatar name={birthday.name} uri={birthday.avatarUrl} size={52} />
        <View style={{ flex: 1 }}>
          <T variant="heading" numberOfLines={1}>
            🎂 {birthday.name}
          </T>
          <T color={colors.textMuted}>
            {birthday.birthday.label}
            {birthday.countdown.turningAge ? ` · turns ${birthday.countdown.turningAge}` : ''}
          </T>
          <T variant="label" color={today ? colors.pink : colors.brand} style={{ marginTop: 2 }}>
            {birthday.countdown.label}
          </T>
        </View>
        {birthday.newWishlistItemCount > 0 ? <Badge label={`${birthday.newWishlistItemCount} new`} tone="gold" /> : null}
      </Row>
      {!compact ? (
        <Row gap={spacing.sm} style={{ marginTop: spacing.md }}>
          {birthday.linkedUser && birthday.hasWishlist ? (
            <Button small variant="secondary" icon="🎁" title="Wishlist" onPress={() => router.push(`/person/${birthday.linkedUser!.id}`)} style={{ flex: 1 }} />
          ) : null}
          <Button small variant="secondary" icon="🛍️" title="Send gift" onPress={() => router.push({ pathname: '/send-gift', params: { birthdayId: birthday.id } })} style={{ flex: 1 }} />
          <Button small variant="secondary" icon="💌" title="Wish" onPress={() => router.push({ pathname: '/wish/send', params: { birthdayId: birthday.id } })} style={{ flex: 1 }} />
        </Row>
      ) : null}
    </Card>
  );
}

export function ProductCard({ product, onPress, width = 170 }: { product: ProductDto | GiftIdeaDto; onPress?: () => void; width?: number | 'fill' }) {
  const isProduct = 'vendor' in product;
  const image = isProduct ? product.images[0] : product.imageUrl;
  const price = product.priceMinor;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [width === 'fill' ? { flex: 1 } : { width }, { opacity: pressed ? 0.85 : 1 }]}>
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceMuted, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
        {image ? <Image source={{ uri: image }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} /> : <T style={{ fontSize: 48 }}>🎁</T>}
      </View>
      <T variant="label" numberOfLines={2} style={{ marginTop: spacing.sm }}>
        {product.name}
      </T>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="label" color={colors.brand}>
          {money(price, product.currency)}
        </T>
        {isProduct && product.rating ? <T variant="caption" color={colors.textMuted}>⭐ {product.rating.toFixed(1)}</T> : null}
      </Row>
      {!isProduct ? (
        <T variant="caption" color={colors.textMuted} numberOfLines={2}>
          {product.reason}
        </T>
      ) : null}
    </Pressable>
  );
}

/** A wishlist item as seen by its owner or by a gifter (spec §10, §13). */
export function WishlistItemRow({ item, isOwner, onPress, actions }: { item: WishlistItemDto; isOwner: boolean; onPress?: () => void; actions?: React.ReactNode }) {
  const priority = PRIORITY_META[item.priority];
  const reservation = item.reservation;
  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.md }}>
      <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
          {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: 72, height: 72 }} contentFit="cover" /> : <T style={{ fontSize: 30 }}>🎁</T>}
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <T variant="heading" numberOfLines={2}>
            {item.name}
          </T>
          <Row gap={6} wrap>
            <Badge label={`${priority.emoji} ${priority.label}`} tone={item.priority === 'MUST_HAVE' ? 'danger' : item.priority === 'HIGH' ? 'gold' : 'muted'} />
            {item.quantity > 1 ? <Badge label={`×${item.quantity}`} tone="muted" /> : null}
          </Row>
          {item.priceMinor != null ? <T variant="label" color={colors.brand}>{money(item.priceMinor, item.currency)}</T> : null}
          {[item.size && `Size ${item.size}`, item.color, item.merchant].filter(Boolean).length ? (
            <T variant="caption" color={colors.textMuted}>
              {[item.size && `Size ${item.size}`, item.color, item.merchant].filter(Boolean).join(' · ')}
            </T>
          ) : null}
          {/* Owners never see reservation state — the surprise must survive (spec §58 rule 2). */}
          {!isOwner && reservation ? (
            <T variant="caption" color={reservation.isMine ? colors.success : colors.pink} style={{ marginTop: 2 }}>
              {reservation.isMine ? '✅ You’re getting this' : reservation.reservedBy ? `🎁 ${reservation.reservedBy.displayName} is getting this` : '🎁 Someone is already getting this'}
            </T>
          ) : null}
          {!isOwner && item.groupGift ? (
            <T variant="caption" color={colors.brand}>
              👥 Group gift · {item.groupGift.percentFunded}% funded
            </T>
          ) : null}
        </View>
      </Row>
      {actions ? <View style={{ marginTop: spacing.md }}>{actions}</View> : null}
    </Card>
  );
}
