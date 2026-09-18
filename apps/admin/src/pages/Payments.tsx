import type { PaymentDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, EmptyRow, ErrorBox, LoadingRows, PageHeader, Pager, useCursorPager, useDebounced } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, humanise, money, number } from '../lib/format';

type AdminPayment = PaymentDto & {
  providerRef: string | null;
  referenceType: string;
  referenceId: string | null;
  user: { id: string; username: string };
  refunds: Array<{ id: string; amountMinor: number; status: string; createdAt: string }>;
};

interface Reconciliation {
  totals: Array<{ status: string; currency: string; count: number; amountMinor: number }>;
  stuckPayments: PaymentDto[];
  failedWebhooks: Array<{ id: string; provider: string; externalId: string; error: string | null; receivedAt: string }>;
  pendingRefunds: Array<{ id: string; paymentId: string; amountMinor: number; currency: string; reason: string; createdAt: string }>;
}

export function PaymentsPage() {
  const [tab, setTab] = useState<'transactions' | 'reconciliation'>('transactions');
  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Transactions, reconciliation and refunds"
        actions={
          <>
            <button className={`btn ${tab === 'transactions' ? 'btn-primary' : ''}`} onClick={() => setTab('transactions')}>Transactions</button>
            <button className={`btn ${tab === 'reconciliation' ? 'btn-primary' : ''}`} onClick={() => setTab('reconciliation')}>Reconciliation</button>
          </>
        }
      />
      {tab === 'transactions' ? <Transactions /> : <ReconciliationView />}
    </>
  );
}

function Transactions() {
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [q, setQ] = useState('');
  const pager = useCursorPager();
  const search = useDebounced(q);
  const payments = useQuery({
    queryKey: ['payments', status, provider, search, pager.cursor],
    queryFn: () => api.get<{ items: AdminPayment[]; nextCursor: string | null }>('/admin/payments', { status, provider, q: search || undefined, cursor: pager.cursor, limit: 30 }),
  });

  return (
    <div className="card">
      <div className="card-head">
        <div className="toolbar">
          <input className="input" placeholder="Reference or provider ref" value={q} onChange={(event) => { setQ(event.target.value); pager.reset(); }} />
          <select className="select" value={status} onChange={(event) => { setStatus(event.target.value); pager.reset(); }}>
            <option value="">All statuses</option>
            {['PENDING', 'SUCCESSFUL', 'FAILED', 'REFUNDED', 'CANCELLED'].map((value) => <option key={value} value={value}>{humanise(value)}</option>)}
          </select>
          <select className="select" value={provider} onChange={(event) => { setProvider(event.target.value); pager.reset(); }}>
            <option value="">All providers</option>
            {['MPESA', 'CARD', 'STRIPE', 'WALLET'].map((value) => <option key={value} value={value}>{humanise(value)}</option>)}
          </select>
        </div>
      </div>
      <ErrorBox error={payments.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>User</th>
              <th>Purpose</th>
              <th>Provider</th>
              <th>Status</th>
              <th className="num">Amount</th>
              <th>Created</th>
              <th>Settled</th>
            </tr>
          </thead>
          <tbody>
            {payments.isLoading ? <LoadingRows columns={8} /> : null}
            {payments.data && payments.data.items.length === 0 ? <EmptyRow columns={8} message="No payments match." /> : null}
            {payments.data?.items.map((payment) => (
              <tr key={payment.id}>
                <td className="mono">{payment.reference}<div className="muted">{payment.providerRef ?? ''}</div></td>
                <td>@{payment.user.username}</td>
                <td>{humanise(payment.purpose)}</td>
                <td>{humanise(payment.provider)}</td>
                <td><Badge value={payment.status} />{payment.failureReason ? <div className="muted">{payment.failureReason}</div> : null}{payment.refunds.length ? <div className="muted">{payment.refunds.length} refund(s)</div> : null}</td>
                <td className="num">{money(payment.amountMinor, payment.currency)}</td>
                <td>{dateTime(payment.createdAt)}</td>
                <td>{dateTime(payment.settledAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={pager.page} hasNext={Boolean(payments.data?.nextCursor)} onNext={() => pager.next(payments.data?.nextCursor)} onPrevious={pager.previous} />
    </div>
  );
}

function ReconciliationView() {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: ['reconciliation'], queryFn: () => api.get<Reconciliation>('/admin/payments/reconciliation') });
  const complete = useMutation({
    mutationFn: ({ id, providerRef }: { id: string; providerRef: string | null }) => api.post(`/admin/refunds/${id}/complete`, { providerRef }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reconciliation'] }),
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <ErrorBox error={data.error ?? complete.error} />
      <div className="card">
        <div className="card-head"><h2>Totals by status</h2></div>
        <table>
          <thead><tr><th>Status</th><th>Currency</th><th className="num">Count</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {data.data?.totals.map((row) => (
              <tr key={`${row.status}-${row.currency}`}><td><Badge value={row.status} /></td><td>{row.currency}</td><td className="num">{number(row.count)}</td><td className="num">{money(row.amountMinor, row.currency)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><h2>Pending for over 30 minutes</h2><span className="muted">The reconciliation job re-checks these with the provider every 10 minutes.</span></div>
        <table>
          <tbody>
            {data.data && data.data.stuckPayments.length === 0 ? <EmptyRow columns={4} message="Nothing stuck." /> : null}
            {data.data?.stuckPayments.map((payment) => (
              <tr key={payment.id}><td className="mono">{payment.reference}</td><td>{humanise(payment.provider)}</td><td className="num">{money(payment.amountMinor, payment.currency)}</td><td>{dateTime(payment.createdAt)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><h2>Manual refunds to complete</h2></div>
        <table>
          <tbody>
            {data.data && data.data.pendingRefunds.length === 0 ? <EmptyRow columns={4} message="No pending refunds." /> : null}
            {data.data?.pendingRefunds.map((refund) => (
              <tr key={refund.id}>
                <td>{refund.reason}<div className="muted mono">{refund.paymentId}</div></td>
                <td className="num">{money(refund.amountMinor, refund.currency)}</td>
                <td>{dateTime(refund.createdAt)}</td>
                <td>
                  <button className="btn btn-sm" disabled={complete.isPending} onClick={() => {
                    const providerRef = window.prompt('Provider transaction reference for the refund (e.g. M-Pesa reversal code):');
                    if (providerRef !== null) complete.mutate({ id: refund.id, providerRef: providerRef.trim() || null });
                  }}>Mark completed</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><h2>Webhook processing errors</h2></div>
        <table>
          <tbody>
            {data.data && data.data.failedWebhooks.length === 0 ? <EmptyRow columns={3} message="No webhook errors." /> : null}
            {data.data?.failedWebhooks.map((hook) => (
              <tr key={hook.id}><td>{humanise(hook.provider)}<div className="muted mono">{hook.externalId}</div></td><td>{hook.error}</td><td>{dateTime(hook.receivedAt)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
