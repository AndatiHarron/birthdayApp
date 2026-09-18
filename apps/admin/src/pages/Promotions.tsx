import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Drawer, EmptyRow, ErrorBox, LoadingRows, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { date, humanise, money, number } from '../lib/format';

interface Promotion {
  id: string;
  code: string;
  type: 'PERCENTAGE_DISCOUNT' | 'FIXED_DISCOUNT' | 'FREE_DELIVERY' | 'BUNDLE';
  valueBps: number | null;
  valueMinor: number | null;
  currency: string | null;
  minSubtotalMinor: number;
  maxDiscountMinor: number | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usageCount: number;
  perUserLimit: number;
  description: string | null;
  isActive: boolean;
  vendor: { id: string; name: string } | null;
}

function describe(promotion: Promotion): string {
  switch (promotion.type) {
    case 'PERCENTAGE_DISCOUNT':
      return `${(promotion.valueBps ?? 0) / 100}% off${promotion.maxDiscountMinor ? ` (max ${money(promotion.maxDiscountMinor)})` : ''}`;
    case 'FIXED_DISCOUNT':
      return `${money(promotion.valueMinor ?? 0, promotion.currency ?? 'KES')} off`;
    case 'FREE_DELIVERY':
      return 'Free delivery';
    default:
      return humanise(promotion.type);
  }
}

export function PromotionsPage() {
  const queryClient = useQueryClient();
  const promotions = useQuery({ queryKey: ['promotions'], queryFn: () => api.get<Promotion[]>('/admin/promotions') });
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/promotions/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['promotions'] }),
  });

  return (
    <>
      <PageHeader title="Promotions" subtitle="Discount codes, birthday promos and free delivery" actions={<button className="btn btn-primary" onClick={() => setEditing('new')}>New promotion</button>} />
      <ErrorBox error={promotions.error ?? deactivate.error} />
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Offer</th><th>Min. order</th><th className="num">Used</th><th>Runs</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {promotions.isLoading ? <LoadingRows columns={7} /> : null}
              {promotions.data && promotions.data.length === 0 ? <EmptyRow columns={7} message="No promotions yet." /> : null}
              {promotions.data?.map((promotion) => (
                <tr key={promotion.id}>
                  <td className="mono"><strong>{promotion.code}</strong>{promotion.vendor ? <div className="muted">{promotion.vendor.name}</div> : null}</td>
                  <td>{describe(promotion)}<div className="muted">{promotion.description}</div></td>
                  <td>{promotion.minSubtotalMinor ? money(promotion.minSubtotalMinor, promotion.currency ?? 'KES') : '—'}</td>
                  <td className="num">{number(promotion.usageCount)}{promotion.usageLimit ? ` / ${number(promotion.usageLimit)}` : ''}</td>
                  <td>{date(promotion.startsAt)} → {promotion.endsAt ? date(promotion.endsAt) : 'no end'}</td>
                  <td>{promotion.isActive ? <span className="badge ok">Active</span> : <span className="badge">Inactive</span>}</td>
                  <td className="toolbar">
                    <button className="btn btn-sm" onClick={() => setEditing(promotion)}>Edit</button>
                    {promotion.isActive ? <button className="btn btn-sm btn-danger" onClick={() => deactivate.mutate(promotion.id)}>Deactivate</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing ? <PromotionForm promotion={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

const toLocalInput = (value: string | null) => (value ? new Date(value).toISOString().slice(0, 16) : '');

function PromotionForm({ promotion, onClose }: { promotion: Promotion | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: promotion?.code ?? '',
    type: promotion?.type ?? 'PERCENTAGE_DISCOUNT',
    percent: promotion?.valueBps != null ? String(promotion.valueBps / 100) : '10',
    amount: promotion?.valueMinor != null ? String(promotion.valueMinor / 100) : '',
    minSubtotal: promotion ? String(promotion.minSubtotalMinor / 100) : '0',
    maxDiscount: promotion?.maxDiscountMinor != null ? String(promotion.maxDiscountMinor / 100) : '',
    startsAt: toLocalInput(promotion?.startsAt ?? null),
    endsAt: toLocalInput(promotion?.endsAt ?? null),
    usageLimit: promotion?.usageLimit != null ? String(promotion.usageLimit) : '',
    perUserLimit: String(promotion?.perUserLimit ?? 1),
    description: promotion?.description ?? '',
    isActive: promotion?.isActive ?? true,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code,
        type: form.type,
        valueBps: form.type === 'PERCENTAGE_DISCOUNT' ? Math.round(Number(form.percent) * 100) : undefined,
        valueMinor: form.type === 'FIXED_DISCOUNT' ? Math.round(Number(form.amount) * 100) : undefined,
        currency: 'KES',
        minSubtotalMinor: Math.round(Number(form.minSubtotal || 0) * 100),
        maxDiscountMinor: form.maxDiscount ? Math.round(Number(form.maxDiscount) * 100) : null,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
        perUserLimit: Number(form.perUserLimit || 1),
        description: form.description || null,
        isActive: form.isActive,
      };
      return promotion ? api.put(`/admin/promotions/${promotion.id}`, body) : api.post('/admin/promotions', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
      onClose();
    },
  });

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Drawer title={promotion ? `Edit ${promotion.code}` : 'New promotion'} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox error={save.error} />
        <div className="row">
          <div className="field"><label htmlFor="code">Code</label><input id="code" className="input mono" required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="BIRTHDAY10" /></div>
          <div className="field">
            <label htmlFor="type">Type</label>
            <select id="type" className="select" value={form.type} onChange={set('type')}>
              {['PERCENTAGE_DISCOUNT', 'FIXED_DISCOUNT', 'FREE_DELIVERY'].map((type) => <option key={type} value={type}>{humanise(type)}</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          {form.type === 'PERCENTAGE_DISCOUNT' ? <div className="field"><label htmlFor="percent">Percent off</label><input id="percent" className="input" type="number" min={1} max={100} step="0.5" required value={form.percent} onChange={set('percent')} /></div> : null}
          {form.type === 'PERCENTAGE_DISCOUNT' ? <div className="field"><label htmlFor="max">Max discount (KES)</label><input id="max" className="input" type="number" min={0} value={form.maxDiscount} onChange={set('maxDiscount')} /></div> : null}
          {form.type === 'FIXED_DISCOUNT' ? <div className="field"><label htmlFor="amount">Amount off (KES)</label><input id="amount" className="input" type="number" min={1} required value={form.amount} onChange={set('amount')} /></div> : null}
          <div className="field"><label htmlFor="min">Minimum order (KES)</label><input id="min" className="input" type="number" min={0} value={form.minSubtotal} onChange={set('minSubtotal')} /></div>
        </div>
        <div className="row">
          <div className="field"><label htmlFor="starts">Starts</label><input id="starts" className="input" type="datetime-local" value={form.startsAt} onChange={set('startsAt')} /></div>
          <div className="field"><label htmlFor="ends">Ends</label><input id="ends" className="input" type="datetime-local" value={form.endsAt} onChange={set('endsAt')} /></div>
        </div>
        <div className="row">
          <div className="field"><label htmlFor="limit">Total uses (blank = unlimited)</label><input id="limit" className="input" type="number" min={1} value={form.usageLimit} onChange={set('usageLimit')} /></div>
          <div className="field"><label htmlFor="peruser">Uses per person</label><input id="peruser" className="input" type="number" min={1} value={form.perUserLimit} onChange={set('perUserLimit')} /></div>
        </div>
        <div className="field"><label htmlFor="desc">Description</label><input id="desc" className="input" value={form.description} onChange={set('description')} placeholder="10% off every birthday gift" /></div>
        <label style={{ display: 'flex', gap: 8, marginBottom: 14 }}><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Active</label>
        <button className="btn btn-primary" disabled={save.isPending}>Save</button>
      </form>
    </Drawer>
  );
}
