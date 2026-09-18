import type { ProductDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Drawer, EmptyRow, ErrorBox, LoadingRows, PageHeader, Pager, useCursorPager, useDebounced } from '../components/ui';
import { api } from '../lib/api';
import { date, humanise, money, number } from '../lib/format';

type AdminProduct = ProductDto & { vendorStatus: string; isFeatured: boolean; statusReason: string | null; purchaseCount: number };

export function ProductsPage() {
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<AdminProduct | null>(null);
  const pager = useCursorPager();
  const search = useDebounced(q);

  const products = useQuery({
    queryKey: ['admin-products', status, search, pager.cursor],
    queryFn: () => api.get<{ items: AdminProduct[]; nextCursor: string | null }>('/admin/products', { status, q: search || undefined, cursor: pager.cursor, limit: 25 }),
  });

  return (
    <>
      <PageHeader title="Products" subtitle="Review listings, feature great gifts, remove problems" />
      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <select className="select" value={status} onChange={(event) => { setStatus(event.target.value); pager.reset(); }}>
              <option value="">All</option>
              {['PENDING_REVIEW', 'ACTIVE', 'OUT_OF_STOCK', 'REJECTED', 'ARCHIVED', 'DRAFT'].map((value) => <option key={value} value={value}>{humanise(value)}</option>)}
            </select>
            <input className="input" placeholder="Search products" value={q} onChange={(event) => { setQ(event.target.value); pager.reset(); }} />
          </div>
        </div>
        <ErrorBox error={products.error} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Product</th>
                <th>Vendor</th>
                <th>Status</th>
                <th className="num">Price</th>
                <th className="num">Stock</th>
                <th className="num">Sold</th>
                <th>Listed</th>
              </tr>
            </thead>
            <tbody>
              {products.isLoading ? <LoadingRows columns={8} /> : null}
              {products.data && products.data.items.length === 0 ? <EmptyRow columns={8} message="Nothing to review." /> : null}
              {products.data?.items.map((product) => (
                <tr key={product.id} className="clickable" onClick={() => setSelected(product)}>
                  <td>{product.images[0] ? <img src={product.images[0]} alt="" width={44} height={44} style={{ objectFit: 'cover', borderRadius: 8 }} /> : null}</td>
                  <td><strong>{product.name}</strong>{product.isFeatured ? <div><span className="badge brand">Featured</span></div> : null}</td>
                  <td>{product.vendor.name} {product.vendorStatus !== 'APPROVED' ? <Badge value={product.vendorStatus} /> : null}</td>
                  <td><Badge value={product.status} /></td>
                  <td className="num">{money(product.priceMinor, product.currency)}</td>
                  <td className="num">{product.stock == null ? '∞' : number(product.stock)}</td>
                  <td className="num">{number(product.purchaseCount)}</td>
                  <td>{date(product.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={pager.page} hasNext={Boolean(products.data?.nextCursor)} onNext={() => pager.next(products.data?.nextCursor)} onPrevious={pager.previous} />
      </div>
      {selected ? <ProductDrawer product={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function ProductDrawer({ product, onClose }: { product: AdminProduct; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const review = useMutation({
    mutationFn: (body: { status: 'ACTIVE' | 'REJECTED' | 'ARCHIVED'; isFeatured?: boolean }) => api.patch(`/admin/products/${product.id}`, { ...body, reason: reason || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      onClose();
    },
  });

  return (
    <Drawer title={product.name} onClose={onClose}>
      <ErrorBox error={review.error} />
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 14 }}>
        {product.images.map((image) => <img key={image} src={image} alt="" height={120} style={{ borderRadius: 10 }} />)}
      </div>
      <dl className="kv">
        <dt>Status</dt><dd><Badge value={product.status} /></dd>
        <dt>Vendor</dt><dd>{product.vendor.name}</dd>
        <dt>Price</dt><dd>{money(product.priceMinor, product.currency)} {product.compareAtPriceMinor ? <span className="muted">(was {money(product.compareAtPriceMinor, product.currency)})</span> : null}</dd>
        <dt>Categories</dt><dd>{product.categories.map((category) => category.label).join(', ')}</dd>
        <dt>Tags</dt><dd>{product.tags.join(', ') || '—'}</dd>
        <dt>Delivery</dt><dd>{product.deliveryEstimate ?? '—'} · fee {money(product.deliveryFeeMinor ?? 0, product.currency)}</dd>
        <dt>Location</dt><dd>{[product.location?.area, product.location?.city].filter(Boolean).join(', ') || '—'}</dd>
        <dt>Description</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{product.description}</dd>
      </dl>
      <div className="field">
        <label htmlFor="reason">Reason (shown to the vendor when rejecting)</label>
        <textarea id="reason" className="textarea" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <div className="toolbar">
        {product.status !== 'ACTIVE' ? <button className="btn btn-primary" disabled={review.isPending} onClick={() => review.mutate({ status: 'ACTIVE' })}>Approve</button> : null}
        {product.status === 'ACTIVE' ? <button className="btn" disabled={review.isPending} onClick={() => review.mutate({ status: 'ACTIVE', isFeatured: !product.isFeatured })}>{product.isFeatured ? 'Unfeature' : 'Feature'}</button> : null}
        {product.status !== 'REJECTED' ? <button className="btn btn-danger" disabled={review.isPending || (!reason && product.status === 'PENDING_REVIEW')} onClick={() => review.mutate({ status: 'REJECTED' })}>Reject</button> : null}
        {product.status !== 'ARCHIVED' ? <button className="btn btn-danger" disabled={review.isPending} onClick={() => window.confirm('Remove this product from the marketplace?') && review.mutate({ status: 'ARCHIVED' })}>Remove</button> : null}
      </div>
      {!reason && product.status === 'PENDING_REVIEW' ? <p className="muted">Add a reason to reject.</p> : null}
    </Drawer>
  );
}
