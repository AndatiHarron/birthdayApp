import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Drawer, EmptyRow, ErrorBox, LoadingRows, PageHeader, Pager, useCursorPager } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, humanise } from '../lib/format';

interface ReportRow {
  id: string;
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  targetStatus: string | null;
  reason: string;
  details: string | null;
  status: string;
  resolution: string | null;
  reporter: { id: string; username: string };
  resolvedBy: { id: string; username: string } | null;
  resolvedAt: string | null;
  createdAt: string;
}

export function ComplaintsPage() {
  const [status, setStatus] = useState('OPEN');
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const pager = useCursorPager();
  const reports = useQuery({
    queryKey: ['complaints', status, pager.cursor],
    queryFn: () => api.get<{ items: ReportRow[]; nextCursor: string | null }>('/admin/complaints', { status, cursor: pager.cursor, limit: 25 }),
  });

  return (
    <>
      <PageHeader title="Complaints" subtitle="Reports from users about people, shops, products and messages" />
      <div className="card">
        <div className="card-head">
          <select className="select" value={status} onChange={(event) => { setStatus(event.target.value); pager.reset(); }}>
            <option value="">All</option>
            {['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'].map((value) => <option key={value} value={value}>{humanise(value)}</option>)}
          </select>
        </div>
        <ErrorBox error={reports.error} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Target</th><th>Reason</th><th>Reporter</th><th>Status</th><th>Filed</th></tr></thead>
            <tbody>
              {reports.isLoading ? <LoadingRows columns={5} /> : null}
              {reports.data && reports.data.items.length === 0 ? <EmptyRow columns={5} message="No complaints here. 🎉" /> : null}
              {reports.data?.items.map((report) => (
                <tr key={report.id} className="clickable" onClick={() => setSelected(report)}>
                  <td>{humanise(report.targetType)}: {report.targetLabel ? `@${report.targetLabel}` : <span className="mono">{report.targetId}</span>}</td>
                  <td>{humanise(report.reason)}<div className="muted">{report.details?.slice(0, 80)}</div></td>
                  <td>@{report.reporter.username}</td>
                  <td><Badge value={report.status} /></td>
                  <td>{dateTime(report.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={pager.page} hasNext={Boolean(reports.data?.nextCursor)} onNext={() => pager.next(reports.data?.nextCursor)} onPrevious={pager.previous} />
      </div>
      {selected ? <ReportDrawer report={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function ReportDrawer({ report, onClose }: { report: ReportRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState(report.resolution ?? '');
  const [suspendTarget, setSuspendTarget] = useState(false);
  const resolve = useMutation({
    mutationFn: (status: string) => api.patch(`/admin/complaints/${report.id}`, { status, resolution: resolution || undefined, suspendTarget }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['complaints'] });
      onClose();
    },
  });
  const actionLabel = { USER: 'Suspend the reported user', VENDOR: 'Suspend the shop', PRODUCT: 'Reject the product', MESSAGE: 'Delete the message' }[report.targetType];

  return (
    <Drawer title="Complaint" onClose={onClose}>
      <ErrorBox error={resolve.error} />
      <dl className="kv">
        <dt>Status</dt><dd><Badge value={report.status} /></dd>
        <dt>Target</dt><dd>{humanise(report.targetType)} <span className="mono">{report.targetId}</span> {report.targetLabel ? `(@${report.targetLabel})` : ''} {report.targetStatus ? <Badge value={report.targetStatus} /> : null}</dd>
        <dt>Reason</dt><dd>{humanise(report.reason)}</dd>
        <dt>Details</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{report.details ?? '—'}</dd>
        <dt>Reporter</dt><dd>@{report.reporter.username}</dd>
        <dt>Filed</dt><dd>{dateTime(report.createdAt)}</dd>
        {report.resolvedBy ? (<><dt>Resolved by</dt><dd>@{report.resolvedBy.username} · {dateTime(report.resolvedAt)}</dd></>) : null}
      </dl>
      <div className="field">
        <label htmlFor="resolution">Resolution notes</label>
        <textarea id="resolution" className="textarea" value={resolution} onChange={(event) => setResolution(event.target.value)} />
      </div>
      {actionLabel ? (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input type="checkbox" checked={suspendTarget} onChange={(event) => setSuspendTarget(event.target.checked)} /> {actionLabel}
        </label>
      ) : null}
      <div className="toolbar">
        {report.status === 'OPEN' ? <button className="btn" disabled={resolve.isPending} onClick={() => resolve.mutate('UNDER_REVIEW')}>Mark under review</button> : null}
        <button className="btn btn-primary" disabled={resolve.isPending} onClick={() => resolve.mutate('RESOLVED')}>Resolve</button>
        <button className="btn" disabled={resolve.isPending} onClick={() => resolve.mutate('DISMISSED')}>Dismiss</button>
      </div>
    </Drawer>
  );
}
