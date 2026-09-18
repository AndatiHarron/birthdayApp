import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Drawer, EmptyRow, ErrorBox, LoadingRows, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { number } from '../lib/format';

interface Category {
  id: string;
  slug: string;
  label: string;
  emoji: string | null;
  parentId: string | null;
  position: number;
  isActive: boolean;
  productCount: number;
}

const blank = { slug: '', label: '', emoji: '', parentId: '', position: 0, isActive: true };

export function CategoriesPage() {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/admin/categories') });
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/categories/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['categories'] }),
  });

  return (
    <>
      <PageHeader title="Categories" subtitle="Gift taxonomy used for browsing and AI matching" actions={<button className="btn btn-primary" onClick={() => setEditing('new')}>New category</button>} />
      <ErrorBox error={categories.error ?? remove.error} />
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Category</th><th>Slug</th><th>Parent</th><th className="num">Order</th><th className="num">Products</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {categories.isLoading ? <LoadingRows columns={7} /> : null}
              {categories.data && categories.data.length === 0 ? <EmptyRow columns={7} message="No categories yet. Run the seed or add one." /> : null}
              {categories.data?.map((category) => (
                <tr key={category.id}>
                  <td>{category.emoji} <strong>{category.label}</strong></td>
                  <td className="mono">{category.slug}</td>
                  <td>{categories.data?.find((parent) => parent.id === category.parentId)?.label ?? '—'}</td>
                  <td className="num">{category.position}</td>
                  <td className="num">{number(category.productCount)}</td>
                  <td>{category.isActive ? <span className="badge ok">Active</span> : <span className="badge">Hidden</span>}</td>
                  <td className="toolbar">
                    <button className="btn btn-sm" onClick={() => setEditing(category)}>Edit</button>
                    <button className="btn btn-sm btn-danger" disabled={category.productCount > 0} title={category.productCount > 0 ? 'In use — hide it instead' : ''} onClick={() => window.confirm(`Delete “${category.label}”?`) && remove.mutate(category.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing ? <CategoryForm category={editing === 'new' ? null : editing} parents={categories.data ?? []} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function CategoryForm({ category, parents, onClose }: { category: Category | null; parents: Category[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(category ? { ...category, emoji: category.emoji ?? '', parentId: category.parentId ?? '' } : blank);
  const save = useMutation({
    mutationFn: () => {
      const body = { slug: form.slug, label: form.label, emoji: form.emoji || null, parentId: form.parentId || null, position: Number(form.position), isActive: form.isActive };
      return category ? api.put(`/admin/categories/${category.id}`, body) : api.post('/admin/categories', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Drawer title={category ? `Edit ${category.label}` : 'New category'} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox error={save.error} />
        <div className="row">
          <div className="field"><label htmlFor="label">Label</label><input id="label" className="input" required value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value, slug: category ? form.slug : event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} /></div>
          <div className="field" style={{ flex: '0 0 90px' }}><label htmlFor="emoji">Emoji</label><input id="emoji" className="input" value={form.emoji} onChange={(event) => setForm({ ...form, emoji: event.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="slug">Slug</label><input id="slug" className="input mono" required value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></div>
        <div className="row">
          <div className="field">
            <label htmlFor="parent">Parent</label>
            <select id="parent" className="select" value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })}>
              <option value="">None</option>
              {parents.filter((parent) => parent.id !== category?.id).map((parent) => <option key={parent.id} value={parent.id}>{parent.label}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="position">Order</label><input id="position" className="input" type="number" min={0} value={form.position} onChange={(event) => setForm({ ...form, position: Number(event.target.value) })} /></div>
        </div>
        <label style={{ display: 'flex', gap: 8, marginBottom: 14 }}><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Visible to shoppers</label>
        <button className="btn btn-primary" disabled={save.isPending}>Save</button>
      </form>
    </Drawer>
  );
}
