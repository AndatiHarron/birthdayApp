import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Drawer, EmptyRow, ErrorBox, LoadingRows, PageHeader, Pager, useCursorPager, useDebounced } from '../components/ui';
import { api } from '../lib/api';
import { date, humanise, money, number } from '../lib/format';

interface VendorRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  status: string;
  statusReason: string | null;
  contactEmail: string;
  contactPhone: string;
  city: string;
  area: string | null;
  registrationNumber: string | null;
  commissionBps: number;
  rating: number | null;
  owner: { id: string; username: string; email: string | null; phone: string | null };
  productCount: number;
  salesCount: number;
  grossSalesMinor: number;
  approvedAt: string | null;
  createdAt: string;
}

export function VendorsPage() {
  const [status, setStatus] = useState('PENDING');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<VendorRow | null>(null);
  const pager = useCursorPager();
  const search = useDebounced(q);

  const vendors = useQuery({
    queryKey: ['vendors', status, search, pager.cursor],
    queryFn: () => api.get<{ items: VendorRow[]; nextCursor: string | null }>('/admin/vendors', { status, q: search || undefined, cursor: pager.cursor, limit: 25 }),
  });

  return (
    <>
      <PageHeader title="Vendors" subtitle="Approve shops before their gifts go live, and track performance" />
      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <select className="select" value={status} onChange={(event) => { setStatus(event.target.value); pager.reset(); }}>
              <option value="">All</option>
              {['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'].map((value) => <option key={value} value={value}>{humanise(value)}</option>)}
            </select>
            <input className="input" placeholder="Search shops" value={q} onChange={(event) => { setQ(event.target.value); pager.reset(); }} />
          </div>
        </div>
        <ErrorBox error={vendors.error} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Shop</th>
                <th>Location</th>
                <th>Status</th>
                <th className="num">Products</th>
                <th className="num">Sales</th>
                <th className="num">Gross</th>
                <th className="num">Commission</th>
                <th>Applied</th>
              </tr>
            </thead>
            <tbody>
              {vendors.isLoading ? <LoadingRows columns={8} /> : null}
              {vendors.data && vendors.data.items.length === 0 ? <EmptyRow columns={8} message="No vendors here." /> : null}
              {vendors.data?.items.map((vendor) => (
                <tr key={vendor.id} className="clickable" onClick={() => setSelected(vendor)}>
                  <td><strong>{vendor.name}</strong><div className="muted">@{vendor.owner.username}</div></td>
                  <td>{[vendor.area, vendor.city].filter(Boolean).join(', ')}</td>
                  <td><Badge value={vendor.status} /></td>
                  <td className="num">{number(vendor.productCount)}</td>
                  <td className="num">{number(vendor.salesCount)}</td>
                  <td className="num">{money(vendor.grossSalesMinor)}</td>
                  <td className="num">{(vendor.commissionBps / 100).toFixed(1)}%</td>
                  <td>{date(vendor.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={pager.page} hasNext={Boolean(vendors.data?.nextCursor)} onNext={() => pager.next(vendors.data?.nextCursor)} onPrevious={pager.previous} />
      </div>
      {selected ? <VendorDrawer vendor={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function VendorDrawer({ vendor, onClose }: { vendor: VendorRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [commission, setCommission] = useState(String(vendor.commissionBps / 100));

  const review = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/admin/vendors/${vendor.id}`, { status, reason: reason || undefined, commissionBps: Math.round(Number(commission) * 100) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vendors'] });
      onClose();
    },
  });

  return (
    <Drawer title={vendor.name} onClose={onClose}>
      <ErrorBox error={review.error} />
      <div className="toolbar" style={{ marginBottom: 12 }}><Badge value={vendor.status} /></div>
      <dl className="kv">
        <dt>About</dt><dd>{vendor.description ?? '—'}</dd>
        <dt>Contact</dt><dd>{vendor.contactEmail}<br />{vendor.contactPhone}</dd>
        <dt>Location</dt><dd>{[vendor.area, vendor.city].filter(Boolean).join(', ')}</dd>
        <dt>Registration no.</dt><dd>{vendor.registrationNumber ?? 'Not provided'}</dd>
        <dt>Owner account</dt><dd>@{vendor.owner.username} · {vendor.owner.email ?? vendor.owner.phone ?? '—'}</dd>
        <dt>Performance</dt><dd>{vendor.salesCount} items sold · {money(vendor.grossSalesMinor)} gross · rating {vendor.rating?.toFixed(1) ?? '—'}</dd>
        {vendor.statusReason ? (<><dt>Last decision note</dt><dd>{vendor.statusReason}</dd></>) : null}
      </dl>
      <div className="section-title">Decision</div>
      <div className="row">
        <div className="field">
          <label htmlFor="commission">Commission (%)</label>
          <input id="commission" className="input" type="number" min={0} max={50} step={0.5} value={commission} onChange={(event) => setCommission(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="reason">Note to the vendor (and audit log)</label>
        <textarea id="reason" className="textarea" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <div className="toolbar">
        {vendor.status !== 'APPROVED' ? <button className="btn btn-primary" disabled={review.isPending} onClick={() => review.mutate('APPROVED')}>Approve</button> : <button className="btn" disabled={review.isPending} onClick={() => review.mutate('APPROVED')}>Save commission</button>}
        {vendor.status === 'PENDING' ? <button className="btn btn-danger" disabled={review.isPending} onClick={() => review.mutate('REJECTED')}>Reject</button> : null}
        {vendor.status === 'APPROVED' ? <button className="btn btn-danger" disabled={review.isPending} onClick={() => window.confirm('Suspend this shop? Its products disappear from the marketplace immediately.') && review.mutate('SUSPENDED')}>Suspend</button> : null}
      </div>
    </Drawer>
  );
}
