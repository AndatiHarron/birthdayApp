import { allowedDeliveryTransitions, DELIVERY_STATUS_LABELS, type DeliveryStatus, type OrderDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Drawer, EmptyRow, ErrorBox, LoadingRows, PageHeader, Pager, useCursorPager, useDebounced } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, humanise, money } from '../lib/format';

type AdminOrder = OrderDto & { buyer: { id: string; displayName: string } };

export function OrdersPage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const pager = useCursorPager();
  const search = useDebounced(q);

  const orders = useQuery({
    queryKey: ['orders', status, search, pager.cursor],
    queryFn: () => api.get<{ items: AdminOrder[]; nextCursor: string | null }>('/admin/orders', { status, q: search || undefined, cursor: pager.cursor, limit: 25 }),
  });

  return (
    <>
      <PageHeader title="Orders" subtitle="Track gift orders, update delivery and issue refunds" />
      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <input className="input" placeholder="Reference or recipient" value={q} onChange={(event) => { setQ(event.target.value); pager.reset(); }} />
            <select className="select" value={status} onChange={(event) => { setStatus(event.target.value); pager.reset(); }}>
              <option value="">All statuses</option>
              {['AWAITING_PAYMENT', 'PAID', 'PROCESSING', 'FULFILLED', 'CANCELLED', 'REFUNDED'].map((value) => <option key={value} value={value}>{humanise(value)}</option>)}
            </select>
          </div>
        </div>
        <ErrorBox error={orders.error} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Buyer → recipient</th>
                <th>Items</th>
                <th>Order</th>
                <th>Delivery</th>
                <th className="num">Total</th>
                <th>Placed</th>
              </tr>
            </thead>
            <tbody>
              {orders.isLoading ? <LoadingRows columns={7} /> : null}
              {orders.data && orders.data.items.length === 0 ? <EmptyRow columns={7} message="No orders match." /> : null}
              {orders.data?.items.map((order) => (
                <tr key={order.id} className="clickable" onClick={() => setSelected(order.id)}>
                  <td className="mono">{order.reference}</td>
                  <td>{order.buyer.displayName} → {order.recipient?.name ?? '—'}</td>
                  <td>{order.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}</td>
                  <td><Badge value={order.status} /></td>
                  <td>{order.delivery ? <Badge value={order.delivery.status} /> : '—'}</td>
                  <td className="num">{money(order.totalMinor, order.currency)}</td>
                  <td>{dateTime(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={pager.page} hasNext={Boolean(orders.data?.nextCursor)} onNext={() => pager.next(orders.data?.nextCursor)} onPrevious={pager.previous} />
      </div>
      {selected ? <OrderDrawer orderId={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => api.get<OrderDto>(`/admin/orders/${orderId}`) });
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  const delivery = useMutation({
    mutationFn: (status: DeliveryStatus) => api.post<OrderDto>(`/admin/orders/${orderId}/delivery`, { status, note: note || undefined, trackingCode: tracking || undefined }),
    onSuccess: () => { setNote(''); refresh(); },
  });
  const orderStatus = useMutation({
    mutationFn: (status: 'PROCESSING' | 'CANCELLED') => api.post(`/admin/orders/${orderId}/status`, { status }),
    onSuccess: refresh,
  });
  const refund = useMutation({
    mutationFn: () =>
      api.post<{ manualActionRequired: boolean }>(`/admin/orders/${orderId}/refund`, {
        reason: refundReason,
        amountMinor: refundAmount ? Math.round(Number(refundAmount) * 100) : undefined,
      }),
    onSuccess: (result) => {
      setMessage(result.manualActionRequired ? 'Refund recorded. This provider needs the refund completed manually — see Payments → Reconciliation.' : 'Refund issued.');
      refresh();
    },
  });

  const data = order.data;
  const transitions = data?.delivery ? allowedDeliveryTransitions(data.delivery.status) : [];

  return (
    <Drawer title={data ? `Order ${data.reference}` : 'Order'} onClose={onClose}>
      <ErrorBox error={order.error ?? delivery.error ?? orderStatus.error ?? refund.error} />
      {message ? <div className="success-box">{message}</div> : null}
      {!data ? <div className="skeleton" style={{ height: 120 }} /> : (
        <>
          <div className="toolbar" style={{ marginBottom: 12 }}><Badge value={data.status} />{data.delivery ? <Badge value={data.delivery.status} /> : null}</div>
          <dl className="kv">
            <dt>Recipient</dt><dd>{data.recipient?.name ?? '—'} {data.recipient?.phone ?? ''}</dd>
            <dt>Deliver to</dt><dd>{data.delivery ? [data.delivery.addressLine1, data.delivery.addressLine2, data.delivery.area, data.delivery.city].filter(Boolean).join(', ') || (data.delivery.target === 'SENDER' ? 'Sender collects' : '—') : '—'}</dd>
            <dt>Instructions</dt><dd>{data.delivery?.instructions ?? '—'}</dd>
            <dt>Scheduled</dt><dd>{data.scheduledFor ? `${data.scheduledFor} · ${humanise(data.delivery?.scheduledWindow)}` : 'As soon as possible'}</dd>
            <dt>Gift message</dt><dd>{data.giftMessage ?? '—'} {data.isAnonymous ? <span className="badge">Anonymous</span> : null}</dd>
            <dt>Payment</dt><dd>{data.payment ? <>{humanise(data.payment.provider)} · <Badge value={data.payment.status} /></> : '—'}</dd>
            <dt>Totals</dt><dd>{money(data.subtotalMinor, data.currency)} + {money(data.deliveryFeeMinor, data.currency)} delivery − {money(data.discountMinor, data.currency)} {data.couponCode ? `(${data.couponCode})` : ''} = <strong>{money(data.totalMinor, data.currency)}</strong></dd>
          </dl>

          <div className="section-title">Items</div>
          <table>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.quantity}× {item.name}{item.personalization ? <div className="muted">“{item.personalization}”</div> : null}</td>
                  <td className="num">{money(item.totalMinor, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.delivery ? (
            <>
              <div className="section-title">Delivery timeline</div>
              <ul className="timeline">
                {data.delivery.timeline.map((event, index) => (
                  <li key={index}><strong>{DELIVERY_STATUS_LABELS[event.status]}</strong> <span className="muted">{dateTime(event.at)}</span>{event.note ? <div className="muted">{event.note}</div> : null}</li>
                ))}
              </ul>
              {transitions.length > 0 && data.status !== 'AWAITING_PAYMENT' ? (
                <>
                  <div className="row" style={{ marginTop: 12 }}>
                    <div className="field"><label htmlFor="note">Note</label><input id="note" className="input" value={note} onChange={(event) => setNote(event.target.value)} /></div>
                    <div className="field"><label htmlFor="tracking">Tracking code</label><input id="tracking" className="input" value={tracking} onChange={(event) => setTracking(event.target.value)} /></div>
                  </div>
                  <div className="toolbar">
                    {transitions.map((status) => (
                      <button key={status} className={`btn btn-sm ${status === 'CANCELLED' || status === 'FAILED' || status === 'RETURNED' ? 'btn-danger' : ''}`} disabled={delivery.isPending} onClick={() => delivery.mutate(status)}>
                        Mark {DELIVERY_STATUS_LABELS[status].toLowerCase()}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : null}

          <div className="section-title">Order actions</div>
          <div className="toolbar">
            {data.status === 'PAID' ? <button className="btn btn-sm" onClick={() => orderStatus.mutate('PROCESSING')}>Move to processing</button> : null}
            {data.status === 'AWAITING_PAYMENT' ? <button className="btn btn-sm btn-danger" onClick={() => window.confirm('Cancel this unpaid order?') && orderStatus.mutate('CANCELLED')}>Cancel unpaid order</button> : null}
          </div>

          {data.payment?.status === 'SUCCESSFUL' ? (
            <>
              <div className="section-title">Refund</div>
              <div className="row">
                <div className="field"><label htmlFor="amount">Amount ({data.currency}, blank = full)</label><input id="amount" className="input" type="number" min={0} step="0.01" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} /></div>
              </div>
              <div className="field"><label htmlFor="refund-reason">Reason</label><input id="refund-reason" className="input" value={refundReason} onChange={(event) => setRefundReason(event.target.value)} /></div>
              <button className="btn btn-danger" disabled={refund.isPending || refundReason.trim().length < 3} onClick={() => window.confirm('Issue this refund?') && refund.mutate()}>Issue refund</button>
            </>
          ) : null}
        </>
      )}
    </Drawer>
  );
}
