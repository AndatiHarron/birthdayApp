import { allowedDeliveryTransitions, DELIVERY_STATUS_LABELS, type OrderDto, type Paginated, type ProductDto, type VendorDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { money } from '../../src/components/gifting';
import { Badge, Button, Card, Chip, EmptyState, Field, InlineError, Loading, Row, Screen, Section, T } from '../../src/components/ui';
import { api, errorMessage, fieldError } from '../../src/lib/api';
import { colors, spacing } from '../../src/theme';

/** Vendor dashboard (spec §34): application, listings, orders, delivery. */
export default function VendorHome() {
  const vendor = useQuery({ queryKey: ['my-vendor'], queryFn: () => api.get<VendorDto | null>('/vendor/me') });
  if (vendor.isLoading) return <Loading />;
  return (
    <Screen refreshing={vendor.isRefetching} onRefresh={() => void vendor.refetch()}>
      <Stack.Screen options={{ title: 'Sell on Birthday' }} />
      {!vendor.data ? <Apply /> : vendor.data.status !== 'APPROVED' ? <PendingApproval vendor={vendor.data} /> : <Dashboard vendor={vendor.data} />}
    </Screen>
  );
}

function Apply() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', description: '', contactEmail: '', contactPhone: '+254', city: 'Nairobi', area: '', registrationNumber: '' });
  const apply = useMutation({
    mutationFn: () => api.post('/vendor/apply', { ...form, area: form.area || null, registrationNumber: form.registrationNumber || null, contactPhone: form.contactPhone.replace(/\s/g, '') }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['my-vendor'] }),
  });
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });
  return (
    <View>
      <T variant="title">Open your gift shop</T>
      <T color={colors.textMuted} style={{ marginVertical: spacing.md }}>
        Cake shops, florists, gift shops and experience providers can sell to people planning birthdays. We review every shop before it goes live.
      </T>
      <InlineError error={apply.error} />
      <Field label="Business name" value={form.name} onChangeText={set('name')} error={fieldError(apply.error, 'name')} />
      <Field label="About your business" multiline value={form.description} onChangeText={set('description')} error={fieldError(apply.error, 'description')} />
      <Field label="Contact email" keyboardType="email-address" autoCapitalize="none" value={form.contactEmail} onChangeText={set('contactEmail')} error={fieldError(apply.error, 'contactEmail')} />
      <Field label="Contact phone" keyboardType="phone-pad" value={form.contactPhone} onChangeText={set('contactPhone')} error={fieldError(apply.error, 'contactPhone')} />
      <Row gap={spacing.md}>
        <View style={{ flex: 1 }}><Field label="City" value={form.city} onChangeText={set('city')} /></View>
        <View style={{ flex: 1 }}><Field label="Area" value={form.area} onChangeText={set('area')} placeholder="Westlands" /></View>
      </Row>
      <Field label="Business registration / KRA PIN (optional)" value={form.registrationNumber} onChangeText={set('registrationNumber')} />
      <Button title="Submit application" loading={apply.isPending} onPress={() => apply.mutate()} />
    </View>
  );
}

function PendingApproval({ vendor }: { vendor: VendorDto }) {
  return (
    <EmptyState
      icon={vendor.status === 'PENDING' ? 'hourglass' : 'alert'}
      title={vendor.status === 'PENDING' ? `${vendor.name} is under review` : `${vendor.name} is ${vendor.status.toLowerCase()}`}
      message={vendor.status === 'PENDING' ? 'We’ll notify you as soon as your shop is approved.' : 'Contact support if you think this is a mistake.'}
    />
  );
}

function Dashboard({ vendor }: { vendor: VendorDto }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'orders' | 'products'>('orders');
  const products = useQuery({ queryKey: ['vendor-products'], queryFn: () => api.get<ProductDto[]>('/vendor/products') });
  const orders = useQuery({ queryKey: ['vendor-orders'], queryFn: () => api.get<Paginated<OrderDto>>('/vendor/orders', { limit: 50 }) });
  const advance = useMutation({
    mutationFn: (input: { orderId: string; status: string }) => api.post(`/vendor/orders/${input.orderId}/delivery`, { status: input.status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['vendor-orders'] }),
    onError: (error) => Alert.alert('Couldn’t update', errorMessage(error)),
  });

  return (
    <View>
      <Card>
        <T variant="title">{vendor.name}</T>
        <T color={colors.textMuted}>{[vendor.area, vendor.city].filter(Boolean).join(', ')} · commission {(vendor.commissionBps / 100).toFixed(1)}%</T>
      </Card>
      <Row style={{ marginVertical: spacing.lg }}>
        <Chip icon="package" label={`Orders (${orders.data?.items.length ?? 0})`} selected={tab === 'orders'} onPress={() => setTab('orders')} />
        <Chip icon="gift" label={`Products (${products.data?.length ?? 0})`} selected={tab === 'products'} onPress={() => setTab('products')} />
      </Row>

      {tab === 'orders' ? (
        <>
          {orders.isLoading ? <Loading /> : null}
          {orders.data?.items.length === 0 ? <EmptyState icon="package" title="No paid orders yet" /> : null}
          {orders.data?.items.map((order) => {
            const next = order.delivery ? allowedDeliveryTransitions(order.delivery.status).filter((status) => !['CANCELLED', 'RETURNED'].includes(status)) : [];
            return (
              <Card key={order.id} style={{ marginBottom: spacing.md }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="label">{order.reference}</T>
                  {order.delivery ? <Badge label={DELIVERY_STATUS_LABELS[order.delivery.status]} /> : null}
                </Row>
                {order.items.map((item) => (
                  <T key={item.id}>{item.quantity}× {item.name}{item.personalization ? ` — “${item.personalization}”` : ''}</T>
                ))}
                {order.delivery ? (
                  <T color={colors.textMuted} style={{ marginTop: 4 }}>
                    {order.delivery.target === 'SENDER' ? 'Buyer collects / delivers themselves' : `To ${order.delivery.recipientName}, ${[order.delivery.addressLine1, order.delivery.area, order.delivery.city].filter(Boolean).join(', ')}`}
                    {order.delivery.scheduledDate ? ` · ${order.delivery.scheduledDate} ${order.delivery.scheduledWindow?.toLowerCase() ?? ''}` : ''}
                  </T>
                ) : null}
                {order.delivery?.instructions ? <T variant="caption" color={colors.textMuted}>{order.delivery.instructions}</T> : null}
                {order.giftMessage ? <T variant="caption">Card: “{order.giftMessage}”</T> : null}
                <Row wrap style={{ marginTop: spacing.md }}>
                  {next.map((status) => (
                    <Button key={status} small variant={status === 'FAILED' ? 'danger' : 'primary'} title={DELIVERY_STATUS_LABELS[status]} loading={advance.isPending} onPress={() => advance.mutate({ orderId: order.id, status })} />
                  ))}
                </Row>
              </Card>
            );
          })}
        </>
      ) : (
        <>
          <Button icon="plus" title="Add product" onPress={() => router.push('/vendor/product')} style={{ marginBottom: spacing.lg }} />
          {products.data?.map((product) => (
            <Card key={product.id} onPress={() => router.push({ pathname: '/vendor/product', params: { id: product.id } })} style={{ marginBottom: spacing.sm }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="label" style={{ flex: 1 }}>{product.name}</T>
                <Badge label={product.status.replace('_', ' ').toLowerCase()} tone={product.status === 'ACTIVE' ? 'success' : product.status === 'REJECTED' ? 'danger' : 'gold'} />
              </Row>
              <T color={colors.textMuted}>{money(product.priceMinor, product.currency)} · stock {product.stock ?? '∞'}</T>
            </Card>
          ))}
        </>
      )}
    </View>
  );
}
