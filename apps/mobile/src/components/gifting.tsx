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
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { colors, radius, shadow, spacing } from '../theme';
import { Avatar, Badge, Button, Card, Icon, Photo, Row, T } from './ui';
import { PRIORITY_ICONS } from '../lib/icons';

export function money(amountMinor: number | null | undefined, currency = 'KES'): string {
  if (amountMinor == null) return '';
  return isSupportedCurrency(currency) ? formatMoney(amountMinor, currency) : `${currency} ${Math.round(amountMinor / 100)}`;
}

/** Birthday card on the home screen and calendar list (spec §6). */
export function BirthdayCard({ birthday, compact }: { birthday: TrackedBirthdayDto; compact?: boolean }) {
  const today = birthday.countdown.isToday;
  const open = () => router.push(`/birthday/${birthday.id}`);

  // Compact rows (calendar lists) stay tight; everywhere else the person's
  // photo is the card.
  if (compact) {
    return (
      <Card onPress={open} style={[{ marginBottom: spacing.md }, today && { borderColor: colors.accent, borderWidth: 2 }]}>
        <Row gap={spacing.md}>
          <Avatar name={birthday.name} uri={birthday.avatarUrl} size={52} />
          <View style={{ flex: 1 }}>
            <T variant="heading" numberOfLines={1}>
              {birthday.name}
            </T>
            <T color={colors.textMuted}>
              {birthday.birthday.label}
              {birthday.countdown.turningAge ? ` · turns ${birthday.countdown.turningAge}` : ''}
            </T>
          </View>
          <T variant="label" color={today ? colors.accent : colors.brand}>
            {birthday.countdown.label}
          </T>
        </Row>
      </Card>
    );
  }

  return (
    <View style={[{ marginBottom: spacing.lg, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surface }, shadow.card]}>
      <Pressable onPress={open} style={{ height: 230 }}>
        <Photo uri={birthday.avatarUrl} name={birthday.name} />
        <LinearGradient colors={['rgba(16,24,40,0.05)', 'rgba(16,24,40,0.82)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 }} />

        <View style={{ position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md, flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ backgroundColor: today ? colors.accent : 'rgba(255,255,255,0.22)', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
            <T variant="label" color={colors.white}>
              {today ? 'Today' : birthday.countdown.label}
            </T>
          </View>
          {birthday.newWishlistItemCount > 0 ? <Badge tone="gold" icon="sparkles" label={`${birthday.newWishlistItemCount} new`} /> : null}
        </View>

        <View style={{ position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg }}>
          <T variant="title" color={colors.white} numberOfLines={1}>
            {birthday.name}
          </T>
          <T color="rgba(255,255,255,0.88)">
            {birthday.birthday.label}
            {birthday.countdown.turningAge ? ` · turning ${birthday.countdown.turningAge}` : ''}
          </T>
        </View>
      </Pressable>

      <Row gap={spacing.sm} style={{ padding: spacing.md }}>
        {birthday.linkedUser && birthday.hasWishlist ? (
          <Button small variant="secondary" icon="gift" title="Wishlist" onPress={() => router.push(`/person/${birthday.linkedUser!.id}`)} style={{ flex: 1 }} />
        ) : null}
        <Button small variant="secondary" icon="bag" title="Gift" onPress={() => router.push({ pathname: '/send-gift', params: { birthdayId: birthday.id } })} style={{ flex: 1 }} />
        <Button small variant="secondary" icon="mail" title="Wish" onPress={() => router.push({ pathname: '/wish/send', params: { birthdayId: birthday.id } })} style={{ flex: 1 }} />
      </Row>
    </View>
  );
}

export function ProductCard({ product, onPress, width = 170 }: { product: ProductDto | GiftIdeaDto; onPress?: () => void; width?: number | 'fill' }) {
  const isProduct = 'vendor' in product;
  const image = isProduct ? product.images[0] : product.imageUrl;
  const price = product.priceMinor;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [width === 'fill' ? { flex: 1 } : { width }, { opacity: pressed ? 0.85 : 1 }]}>
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceMuted, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Photo uri={image} name={product.name} icon="gift" />
      </View>
      <T variant="label" numberOfLines={2} style={{ marginTop: spacing.sm }}>
        {product.name}
      </T>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="label" color={colors.brand}>
          {money(price, product.currency)}
        </T>
        {isProduct && product.rating ? <Row gap={3}><Icon name="star" size={12} color={colors.gold} fill={colors.gold} /><T variant="caption" color={colors.textMuted}>{product.rating.toFixed(1)}</T></Row> : null}
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
    <Card onPress={onPress} style={{ marginBottom: spacing.md, padding: item.imageUrl ? 0 : spacing.lg, overflow: 'hidden' }}>
      {item.imageUrl ? (
        <View style={{ height: 190, width: '100%' }}>
          <Photo uri={item.imageUrl} name={item.name} icon="gift" />
          {item.priceMinor != null ? (
            <View style={{ position: 'absolute', bottom: spacing.sm, right: spacing.sm, backgroundColor: 'rgba(16,24,40,0.72)', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 }}>
              <T variant="label" color={colors.white}>
                {money(item.priceMinor, item.currency)}
              </T>
            </View>
          ) : null}
        </View>
      ) : null}
      <Row gap={spacing.md} style={{ alignItems: 'flex-start', padding: item.imageUrl ? spacing.lg : 0 }}>
        {item.imageUrl ? null : (
          <View style={{ width: 84, height: 84, borderRadius: radius.md, overflow: 'hidden' }}>
            <Photo uri={null} name={item.name} icon="gift" radius={radius.md} />
          </View>
        )}
        <View style={{ flex: 1, gap: 3 }}>
          <T variant="heading" numberOfLines={2}>
            {item.name}
          </T>
          <Row gap={6} wrap>
            <Badge icon={PRIORITY_ICONS[item.priority]} label={priority.label} tone={item.priority === 'MUST_HAVE' ? 'danger' : item.priority === 'HIGH' ? 'gold' : 'muted'} />
            {item.quantity > 1 ? <Badge label={`×${item.quantity}`} tone="muted" /> : null}
          </Row>
          {item.priceMinor != null && !item.imageUrl ? <T variant="label" color={colors.brand}>{money(item.priceMinor, item.currency)}</T> : null}
          {[item.size && `Size ${item.size}`, item.color, item.merchant].filter(Boolean).length ? (
            <T variant="caption" color={colors.textMuted}>
              {[item.size && `Size ${item.size}`, item.color, item.merchant].filter(Boolean).join(' · ')}
            </T>
          ) : null}
          {/* Owners never see reservation state — the surprise must survive (spec §58 rule 2). */}
          {!isOwner && reservation ? (
            <T variant="caption" color={reservation.isMine ? colors.success : colors.accent} style={{ marginTop: 2 }}>
              {reservation.isMine ? 'You’re getting this' : reservation.reservedBy ? `${reservation.reservedBy.displayName} is getting this` : 'Someone is already getting this'}
            </T>
          ) : null}
          {!isOwner && item.groupGift ? (
            <T variant="caption" color={colors.brand}>
              Group gift · {item.groupGift.percentFunded}% funded
            </T>
          ) : null}
        </View>
      </Row>
      {actions ? <View style={{ marginTop: item.imageUrl ? 0 : spacing.md, paddingHorizontal: item.imageUrl ? spacing.lg : 0, paddingBottom: item.imageUrl ? spacing.lg : 0 }}>{actions}</View> : null}
    </Card>
  );
}
