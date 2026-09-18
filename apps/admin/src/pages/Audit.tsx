import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { EmptyRow, ErrorBox, LoadingRows, PageHeader, Pager, useCursorPager } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, humanise } from '../lib/format';

interface AuditRow {
  id: string;
  action: string;
  actor: { id: string; displayName: string } | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export function AuditPage() {
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const pager = useCursorPager();
  const logs = useQuery({
    queryKey: ['audit', action, pager.cursor],
    queryFn: () => api.get<{ items: AuditRow[]; nextCursor: string | null }>('/admin/audit-logs', { action: action || undefined, cursor: pager.cursor, limit: 50 }),
  });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every privileged and money-moving action" />
      <div className="card">
        <div className="card-head">
          <select className="select" value={action} onChange={(event) => { setAction(event.target.value); pager.reset(); }}>
            <option value="">All actions</option>
            {['user.update', 'user.delete', 'vendor.review', 'product.review', 'order.refund', 'order.status', 'refund.complete_manual', 'category.create', 'category.update', 'category.delete', 'promotion.create', 'promotion.update', 'promotion.deactivate', 'notification.broadcast', 'report.resolve'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <ErrorBox error={logs.error} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Reason</th></tr></thead>
            <tbody>
              {logs.isLoading ? <LoadingRows columns={5} /> : null}
              {logs.data && logs.data.items.length === 0 ? <EmptyRow columns={5} message="No audit entries." /> : null}
              {logs.data?.items.map((row) => (
                <Fragment key={row.id}>
                  <tr className="clickable" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                    <td>{dateTime(row.createdAt)}</td>
                    <td>{row.actor?.displayName ?? 'System'}<div className="muted">{humanise(row.actorRole)}</div></td>
                    <td className="mono">{row.action}</td>
                    <td>{humanise(row.targetType)} <span className="mono muted">{row.targetId}</span></td>
                    <td>{row.reason ?? '—'}</td>
                  </tr>
                  {expanded === row.id ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="grid two">
                          <div><div className="section-title" style={{ marginTop: 0 }}>Before</div><pre className="mono">{JSON.stringify(row.before, null, 2) ?? '—'}</pre></div>
                          <div><div className="section-title" style={{ marginTop: 0 }}>After</div><pre className="mono">{JSON.stringify(row.after, null, 2) ?? '—'}</pre></div>
                        </div>
                        <div className="muted">IP {row.ip ?? 'unknown'}</div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={pager.page} hasNext={Boolean(logs.data?.nextCursor)} onNext={() => pager.next(logs.data?.nextCursor)} onPrevious={pager.previous} />
      </div>
    </>
  );
}
