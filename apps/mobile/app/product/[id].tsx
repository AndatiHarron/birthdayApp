import type { DeliveryAddressDto, FriendDto, OrderDto, PaymentDto, PaymentProvider, ProductDto, ProductReviewDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Dimensions, ScrollView, View } from 'react-native';
import { PaymentMethodPicker, PaymentStatusBanner, usePaymentStatus } from '../../src/components/Payment';
import { money } from '../../src/components/gifting';
import { Avatar, Badge, Button, Card, Chip, ErrorState, Field, Icon, InfoRow, InlineError, Loading, Row, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api, idempotencyKey } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { colors, spacing } from '../../src/theme';

/** Product detail and checkout with delivery (spec §17, §18). */
export default function Product() {
  const params = useLocalSearchParams<{ id: string; wishlistItemId?: string; recipientUserId?: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const product = useQuery({ queryKey: ['product', params.id], queryFn: () => api.get<ProductDto>(`/products/${params.id}`) });
  const reviews = useQuery({ queryKey: ['reviews', params.id], queryFn: () => api.get<ProductReviewDto[]>(`/products/${params.id}/reviews`) });
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api.get<FriendDto[]>('/friends') });
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api.get<DeliveryAddressDto[]>('/addresses') });

  const [checkout, setCheckout] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [recipientUserId, setRecipientUserId] = useState<string | null>(params.recipientUserId ?? null);
  const [target, setTarget] = useState<'RECIPIENT' | 'SENDER'>('RECIPIENT');
  const [addressId, setAddressId] = useState<string | null>(null);
  const [address, setAddress] = useState({ recipientName: '', phone: '', addressLine1: '', area: '', city: 'Nairobi', instructions: '' });
  const [scheduleDate, setScheduleDate] = useState('');
  const [window, setWindow] = useState<'MORNING' | 'AFTERNOON' | 'EVENING' | null>(null);
  const [message, setMessage] = useState('');
  const [personalization, setPersonalization] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const [phone, setPhone] = useState(user?.phone ?? '+254');
  const [key] = useState(idempotencyKey);
  const [order, setOrder] = useState<{ order: OrderDto; payment: PaymentDto } | null>(null);
  const status = usePaymentStatus(order?.payment ?? null);

  const place = useMutation({
    mutationFn: () =>
      api.post<{ order: OrderDto; payment: PaymentDto }>('/orders', {
        items: [{ productId: params.id, quantity, personalization: personalization.trim() || null, wishlistItemId: params.wishlistItemId || null }],
        deliveryTarget: target,
        recipientUserId: recipientUserId ?? undefined,
        deliveryAddressId: target === 'RECIPIENT' ? addressId ?? undefined : undefined,
        deliveryAddress:
          target === 'RECIPIENT' && !addressId
            ? { recipientName: address.recipientName, phone: address.phone.trim() ? address.phone.replace(/\s/g, '') : null, addressLine1: address.addressLine1, area: address.area || null, city: address.city, instructions: address.instructions || null }
            : undefined,
        scheduledDate: scheduleDate || undefined,
        scheduledWindow: window ?? undefined,
        giftMessage: message.trim() || null,
        isAnonymous: anonymous,
        couponCode: coupon.trim() || undefined,
        provider,
        payerPhone: provider === 'MPESA' ? phone.replace(/\s/g, '') : undefined,
        idempotencyKey: key,
      }),
    onSuccess: (result) => {
      setOrder(result);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  if (product.isLoading) return <Loading />;
  if (!product.data) return <ErrorState error={product.error} />;
  const data = product.data;
  const width = Dimensions.get('window').width;

  if (order) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Order' }} />
        {status.payment ? <PaymentStatusBanner payment={status.payment} timedOut={status.timedOut} onRetryCheck={() => void status.check()} successText={`Order ${order.order.reference} confirmed!`} /> : null}
        {status.payment?.status === 'SUCCESSFUL' ? <Button title="Track delivery" onPress={() => router.replace(`/order/${order.order.id}`)} /> : null}
        {status.payment?.status === 'FAILED' ? <Button variant="secondary" title="View order" onPress={() => router.replace(`/order/${order.order.id}`)} /> : null}
      </Screen>
    );
  }

  const nextDays = Array.from({ length: 7 }, (_, index) => new Date(Date.now() + (index + 1) * 86_400_000).toISOString().slice(0, 10));
  const addressReady = target === 'SENDER' || addressId != null || (address.recipientName.trim() && address.addressLine1.trim().length >= 3 && address.city.trim());

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: data.name }} />
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
        {data.images.map((image) => (
          <Image key={image} source={{ uri: image }} style={{ width, height: width * 0.85 }} contentFit="cover" />
        ))}
      </ScrollView>
      <View style={{ padding: spacing.lg }}>
        <T variant="title">{data.name}</T>
        <Row style={{ marginTop: spacing.sm }} wrap>
          <T variant="title" color={colors.brand}>
            {money(data.priceMinor, data.currency)}
          </T>
          {data.compareAtPriceMinor ? <T color={colors.textFaint} style={{ textDecorationLine: 'line-through' }}>{money(data.compareAtPriceMinor, data.currency)}</T> : null}
          {data.rating ? <Badge icon="star" label={`${data.rating.toFixed(1)} (${data.reviewCount})`} tone="gold" /> : null}
          {data.stock === 0 ? <Badge label="Out of stock" tone="danger" /> : data.stock != null && data.stock < 5 ? <Badge label={`Only ${data.stock} left`} tone="gold" /> : <Badge label="Available" tone="success" />}
        </Row>
        <InfoRow icon="store" color={colors.textMuted}>
          {data.vendor.name}
          {data.location?.city ? ` · ${[data.location.area, data.location.city].filter(Boolean).join(', ')}` : ''}
        </InfoRow>
        <InfoRow icon="truck" color={colors.textMuted}>
          {data.deliveryEstimate ?? 'Delivery time confirmed by the shop'} · {data.deliveryFeeMinor ? `delivery ${money(data.deliveryFeeMinor, data.currency)}` : 'free delivery'}
        </InfoRow>
        <T style={{ marginTop: spacing.md, lineHeight: 22 }}>{data.description}</T>

        {!checkout ? (
          <Button icon="gift" title="Gift this" disabled={data.stock === 0} onPress={() => setCheckout(true)} style={{ marginTop: spacing.xl }} />
        ) : (
          <>
            <Section title="Who is it for?">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                <Chip label="Myself / someone else" selected={recipientUserId == null} onPress={() => setRecipientUserId(null)} />
                {friends.data?.map((friend) => (
                  <Chip key={friend.user.id} label={friend.user.displayName} selected={recipientUserId === friend.user.id} onPress={() => { setRecipientUserId(friend.user.id); setAddress((current) => ({ ...current, recipientName: current.recipientName || friend.user.displayName })); }} />
                ))}
              </ScrollView>
              <Row style={{ marginTop: spacing.md }}>
                <Chip label="−" onPress={() => setQuantity(Math.max(1, quantity - 1))} />
                <T variant="heading">{quantity}</T>
                <Chip label="+" onPress={() => setQuantity(Math.min(data.stock ?? 20, quantity + 1))} />
              </Row>
              {data.isPersonalizable ? <Field label="Personalisation (e.g. text on the cake)" value={personalization} onChangeText={setPersonalization} /> : null}
            </Section>

            <Section title="Delivery">
              <Row wrap>
                <Chip icon="truck" label="Deliver to them" selected={target === 'RECIPIENT'} onPress={() => setTarget('RECIPIENT')} />
                <Chip icon="care" label="Deliver to me" selected={target === 'SENDER'} onPress={() => setTarget('SENDER')} />
              </Row>
              {target === 'RECIPIENT' ? (
                <View style={{ marginTop: spacing.md }}>
                  {addresses.data?.map((saved) => (
                    <Chip key={saved.id} label={`${saved.label}: ${saved.addressLine1}`} selected={addressId === saved.id} onPress={() => setAddressId(addressId === saved.id ? null : saved.id)} />
                  ))}
                  {!addressId ? (
                    <View style={{ marginTop: spacing.md }}>
                      <Field label="Recipient name" value={address.recipientName} onChangeText={(value) => setAddress({ ...address, recipientName: value })} />
                      <Field label="Recipient phone" keyboardType="phone-pad" value={address.phone} onChangeText={(value) => setAddress({ ...address, phone: value })} placeholder="+254…" />
                      <Field label="Address" value={address.addressLine1} onChangeText={(value) => setAddress({ ...address, addressLine1: value })} placeholder="Building, street, house no." />
                      <Row gap={spacing.md}>
                        <View style={{ flex: 1 }}><Field label="Area" value={address.area} onChangeText={(value) => setAddress({ ...address, area: value })} /></View>
                        <View style={{ flex: 1 }}><Field label="City" value={address.city} onChangeText={(value) => setAddress({ ...address, city: value })} /></View>
                      </Row>
                      <Field label="Delivery instructions" value={address.instructions} onChangeText={(value) => setAddress({ ...address, instructions: value })} />
                    </View>
                  ) : null}
                </View>
              ) : null}
              <T variant="label" color={colors.textMuted} style={{ marginTop: spacing.md, marginBottom: 6 }}>
                Schedule (optional)
              </T>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                <Chip label="ASAP" selected={!scheduleDate} onPress={() => setScheduleDate('')} />
                {nextDays.map((day) => (
                  <Chip key={day} label={new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} selected={scheduleDate === day} onPress={() => setScheduleDate(day)} />
                ))}
              </ScrollView>
              {scheduleDate ? (
                <Row wrap style={{ marginTop: spacing.sm }}>
                  {(['MORNING', 'AFTERNOON', 'EVENING'] as const).map((option) => (
                    <Chip key={option} label={option.toLowerCase()} selected={window === option} onPress={() => setWindow(option)} />
                  ))}
                </Row>
              ) : null}
            </Section>

            <Section title="Message & payment">
              <Field label="Gift message" multiline value={message} onChangeText={setMessage} placeholder="Happy birthday!" />
              <Toggle label="Send anonymously" value={anonymous} onChange={setAnonymous} />
              <Field label="Promo code" autoCapitalize="characters" value={coupon} onChangeText={setCoupon} placeholder="BIRTHDAY10" />
              <Card style={{ marginBottom: spacing.md }}>
                <T>Subtotal: {money(data.priceMinor * quantity, data.currency)}</T>
                <T color={colors.textMuted}>Delivery and any discount are calculated when you pay.</T>
              </Card>
              <PaymentMethodPicker currency={data.currency} value={provider} onChange={setProvider} phone={phone} onPhoneChange={setPhone} />
              <InlineError error={place.error} />
              <Button title="Place order" loading={place.isPending} disabled={!addressReady || !provider} onPress={() => place.mutate()} />
            </Section>
          </>
        )}

        <Section title={`Reviews${data.reviewCount ? ` (${data.reviewCount})` : ''}`}>
          {reviews.data?.length === 0 ? <T color={colors.textMuted}>No reviews yet.</T> : null}
          {reviews.data?.map((review) => (
            <View key={review.id} style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Row gap={spacing.sm}>
                <Avatar name={review.author?.displayName ?? 'A'} uri={review.author?.avatarUrl} size={28} />
                <T variant="label">{review.author?.displayName ?? 'Customer'}</T>
                <Row gap={2}>{[1, 2, 3, 4, 5].map((value) => <Icon key={value} name="star" size={13} color={value <= review.rating ? colors.gold : colors.border} fill={value <= review.rating ? colors.gold : 'none'} />)}</Row>
              </Row>
              {review.title ? <T variant="label" style={{ marginTop: 4 }}>{review.title}</T> : null}
              {review.body ? <T color={colors.textMuted}>{review.body}</T> : null}
            </View>
          ))}
          <Button small variant="ghost" title="Write a review" onPress={() => router.push({ pathname: '/review', params: { productId: params.id } })} />
        </Section>
      </View>
    </Screen>
  );
}
