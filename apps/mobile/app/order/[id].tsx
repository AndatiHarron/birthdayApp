import { DELIVERY_FLOW, DELIVERY_STATUS_LABELS, RealtimeEvent, type OrderDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Alert, View } from 'react-native';
import { money } from '../../src/components/gifting';
import { Badge, Button, Card, ErrorState, Loading, Row, Screen, Section, T } from '../../src/components/ui';
import { api, errorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { useRealtimeRoom } from '../../src/lib/realtime';
import { colors, spacing } from '../../src/theme';

/** Order and delivery tracking (spec §18, §58 rule 6). */
export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.get<OrderDto>(`/orders/${id}`) });
  useRealtimeRoom('order', id, {
    [RealtimeEvent.DELIVERY_UPDATED]: () => void queryClient.invalidateQueries({ queryKey: ['order', id] }),
    [RealtimeEvent.ORDER_UPDATED]: () => void queryClient.invalidateQueries({ queryKey: ['order', id] }),
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/orders/${id}/cancel`, { reason: 'Cancelled in app' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['order', id] }),
    onError: (error) => Alert.alert('Can’t cancel', errorMessage(error)),
  });
  const retryPayment = useMutation({
    mutationFn: () => api.post(`/payments/${order.data!.payment!.id}/verify`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['order', id] }),
  });

  if (order.isLoading) return <Loading />;
  if (!order.data) return <ErrorState error={order.error} />;
  const data = order.data;
  const isBuyer = data.buyerId === user?.id;
  const delivery = data.delivery;
  const currentIndex = delivery ? (DELIVERY_FLOW as readonly string[]).indexOf(delivery.status) : -1;

  return (
    <Screen refreshing={order.isRefetching} onRefresh={() => void order.refetch()}>
      <Stack.Screen options={{ title: data.reference }} />
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="heading">{isBuyer ? `Gift for ${data.recipient?.name ?? 'you'}` : '🎁 A gift for you'}</T>
          <Badge label={data.status.replace(/_/g, ' ').toLowerCase()} tone={data.status === 'FULFILLED' ? 'success' : data.status === 'CANCELLED' || data.status === 'REFUNDED' ? 'danger' : 'brand'} />
        </Row>
        {data.items.map((item) => (
          <Row key={item.id} style={{ justifyContent: 'space-between', marginTop: spacing.sm }}>
            <T style={{ flex: 1 }}>
              {item.quantity}× {item.name}
              {item.personalization ? <T color={colors.textMuted}> — “{item.personalization}”</T> : null}
            </T>
            {isBuyer ? <T>{money(item.totalMinor, data.currency)}</T> : null}
          </Row>
        ))}
        {isBuyer ? (
          <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
            <T color={colors.textMuted}>Delivery {money(data.deliveryFeeMinor, data.currency)}{data.discountMinor ? ` · discount −${money(data.discountMinor, data.currency)}` : ''}</T>
            <T variant="heading">Total {money(data.totalMinor, data.currency)}</T>
          </View>
        ) : null}
        {data.giftMessage ? <T style={{ marginTop: spacing.sm }}>💌 “{data.giftMessage}”</T> : null}
      </Card>

      {isBuyer && data.status === 'AWAITING_PAYMENT' && data.payment ? (
        <Card style={{ marginTop: spacing.md, backgroundColor: colors.goldSoft, borderColor: colors.goldSoft }}>
          <T>⏳ Waiting for payment confirmation ({data.payment.status.toLowerCase()}).</T>
          <Row style={{ marginTop: spacing.sm }}>
            <Button small title="Check payment" loading={retryPayment.isPending} onPress={() => retryPayment.mutate()} />
          </Row>
        </Card>
      ) : null}

      {delivery ? (
        <Section title="Delivery">
          <Card>
            {DELIVERY_FLOW.map((step, index) => {
              const reached = currentIndex >= index;
              return (
                <Row key={step} gap={spacing.md} style={{ paddingVertical: 6 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: reached ? colors.brand : colors.border, alignItems: 'center', justifyContent: 'center' }}>
                    {reached ? <T color={colors.white} style={{ fontSize: 12 }}>✓</T> : null}
                  </View>
                  <T variant={index === currentIndex ? 'label' : 'body'} color={reached ? colors.text : colors.textFaint}>
                    {DELIVERY_STATUS_LABELS[step]}
                  </T>
                </Row>
              );
            })}
            {['FAILED', 'RETURNED', 'CANCELLED'].includes(delivery.status) ? <Badge label={DELIVERY_STATUS_LABELS[delivery.status]} tone="danger" /> : null}
            {delivery.scheduledDate ? <T color={colors.textMuted} style={{ marginTop: spacing.sm }}>📅 Scheduled {delivery.scheduledDate} {delivery.scheduledWindow ? `(${delivery.scheduledWindow.toLowerCase()})` : ''}</T> : null}
            {delivery.trackingCode ? <T color={colors.textMuted}>🔎 Tracking: {delivery.trackingCode} {delivery.courier ? `· ${delivery.courier}` : ''}</T> : null}
            {isBuyer && delivery.addressLine1 ? <T color={colors.textMuted}>📍 {[delivery.addressLine1, delivery.area, delivery.city].filter(Boolean).join(', ')}</T> : null}
          </Card>
          {delivery.timeline.length ? (
            <View style={{ marginTop: spacing.md }}>
              {[...delivery.timeline].reverse().map((event, index) => (
                <T key={index} variant="caption" color={colors.textMuted}>
                  {new Date(event.at).toLocaleString()} — {DELIVERY_STATUS_LABELS[event.status]}{event.note ? `: ${event.note}` : ''}
                </T>
              ))}
            </View>
          ) : null}
        </Section>
      ) : null}

      <Row wrap style={{ marginTop: spacing.xl }}>
        {isBuyer && (data.status === 'AWAITING_PAYMENT' || (data.status === 'PAID' && (delivery?.status === 'PENDING' || delivery?.status === 'PROCESSING'))) ? (
          <Button small variant="danger" title="Cancel order" onPress={() => Alert.alert('Cancel this order?', data.status === 'PAID' ? 'You’ll be refunded.' : undefined, [{ text: 'Keep', style: 'cancel' }, { text: 'Cancel order', style: 'destructive', onPress: () => cancel.mutate() }])} />
        ) : null}
        {!isBuyer && data.status === 'FULFILLED' ? <Button icon="❤️" title="Say thank you" onPress={() => router.push({ pathname: '/thank-you', params: { giftType: 'ORDER', giftId: data.id } })} /> : null}
        {isBuyer && data.status === 'FULFILLED' && data.items[0] ? <Button small variant="secondary" title="Review" onPress={() => router.push({ pathname: '/review', params: { productId: data.items[0]!.productId } })} /> : null}
      </Row>
    </Screen>
  );
}
