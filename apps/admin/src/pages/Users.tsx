import type { AdminUserRow, Paginated, PaymentDto, UserRole, UserStatus } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, ConfirmButton, Drawer, EmptyRow, ErrorBox, LoadingRows, PageHeader, Pager, useCursorPager, useDebounced } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, humanise, money, number } from '../lib/format';

interface UserDetail {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  isPremium: boolean;
  premiumUntil: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  city: string | null;
  countryCode: string | null;
  vendor: { id: string; name: string; status: string } | null;
  identities: Array<{ provider: string; createdAt: string }>;
  devices: Array<{ platform: string; model: string | null; appVersion: string | null; lastSeenAt: string }>;
  counts: { orders: number; reservations: number; contributions: number; wishesSent: number; reportsFiled: number; reportsAgainst: number };
  recentPayments: PaymentDto[];
  lastActiveAt: string | null;
  createdAt: string;
}

export function UsersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const pager = useCursorPager();
  const search = useDebounced(q);

  const users = useQuery({
    queryKey: ['users', search, status, role, pager.cursor],
    queryFn: () => api.get<Paginated<AdminUserRow>>('/admin/users', { q: search || undefined, status, role, cursor: pager.cursor, limit: 25 }),
  });

  return (
    <>
      <PageHeader title="Users" subtitle="Search, verify, suspend and manage accounts" />
      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <input className="input" placeholder="Name, username, email or phone" value={q} onChange={(event) => { setQ(event.target.value); pager.reset(); }} style={{ width: 280 }} />
            <select className="select" value={status} onChange={(event) => { setStatus(event.target.value); pager.reset(); }}>
              <option value="">All statuses</option>
              {['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'DEACTIVATED'].map((value) => <option key={value} value={value}>{humanise(value)}</option>)}
            </select>
            <select className="select" value={role} onChange={(event) => { setRole(event.target.value); pager.reset(); }}>
              <option value="">All roles</option>
              {['USER', 'VENDOR', 'ADMIN', 'SUPER_ADMIN'].map((value) => <option key={value} value={value}>{humanise(value)}</option>)}
            </select>
          </div>
        </div>
        <ErrorBox error={users.error} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Role</th>
                <th className="num">Friends</th>
                <th className="num">Orders</th>
                <th>Last active</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.isLoading ? <LoadingRows columns={8} /> : null}
              {users.data && users.data.items.length === 0 ? <EmptyRow columns={8} message="No users match these filters." /> : null}
              {users.data?.items.map((user) => (
                <tr key={user.id} className="clickable" onClick={() => setSelected(user.id)}>
                  <td>
                    <strong>{user.displayName}</strong>
                    <div className="muted">@{user.username} {user.isPremium ? <span className="badge brand">Premium</span> : null}</div>
                  </td>
                  <td>
                    <div>{user.email ?? '—'} {user.email ? (user.emailVerified ? '✓' : '') : ''}</div>
                    <div className="muted">{user.phone ?? ''} {user.phone && user.phoneVerified ? '✓' : ''}</div>
                  </td>
                  <td><Badge value={user.status} /></td>
                  <td><Badge value={user.role} /></td>
                  <td className="num">{number(user.friendCount)}</td>
                  <td className="num">{number(user.orderCount)}</td>
                  <td>{dateTime(user.lastActiveAt)}</td>
                  <td>{dateTime(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={pager.page} hasNext={Boolean(users.data?.nextCursor)} onNext={() => pager.next(users.data?.nextCursor)} onPrevious={pager.previous} />
      </div>
      {selected ? <UserDrawer userId={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function UserDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const [reason, setReason] = useState('');
  const detail = useQuery({ queryKey: ['user', userId], queryFn: () => api.get<UserDetail>(`/admin/users/${userId}`) });

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<UserDetail>(`/admin/users/${userId}`, { ...body, reason: reason || undefined }),
    onSuccess: (data) => {
      queryClient.setQueryData(['user', userId], data);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/users/${userId}`, { reason: reason || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });

  const user = detail.data;
  const isSelf = me?.id === userId;

  return (
    <Drawer title={user ? user.displayName : 'User'} onClose={onClose}>
      <ErrorBox error={detail.error ?? update.error ?? remove.error} />
      {!user ? <div className="skeleton" style={{ height: 120 }} /> : (
        <>
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <Badge value={user.status} /> <Badge value={user.role} /> {user.isPremium ? <span className="badge brand">Premium</span> : null}
          </div>
          <dl className="kv">
            <dt>Username</dt><dd>@{user.username}</dd>
            <dt>Email</dt><dd>{user.email ?? '—'} {user.email ? <span className={`badge ${user.emailVerified ? 'ok' : 'warn'}`}>{user.emailVerified ? 'Verified' : 'Unverified'}</span> : null}</dd>
            <dt>Phone</dt><dd>{user.phone ?? '—'} {user.phone ? <span className={`badge ${user.phoneVerified ? 'ok' : 'warn'}`}>{user.phoneVerified ? 'Verified' : 'Unverified'}</span> : null}</dd>
            <dt>Location</dt><dd>{[user.city, user.countryCode].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Sign-in methods</dt><dd>{user.identities.map((identity) => humanise(identity.provider)).join(', ') || 'Password / OTP'}</dd>
            <dt>Vendor</dt><dd>{user.vendor ? <>{user.vendor.name} <Badge value={user.vendor.status} /></> : '—'}</dd>
            <dt>Activity</dt><dd>{user.counts.orders} orders · {user.counts.reservations} reservations · {user.counts.contributions} contributions · {user.counts.wishesSent} wishes</dd>
            <dt>Reports</dt><dd>{user.counts.reportsAgainst} against · {user.counts.reportsFiled} filed</dd>
            <dt>Last active</dt><dd>{dateTime(user.lastActiveAt)}</dd>
            <dt>Joined</dt><dd>{dateTime(user.createdAt)}</dd>
            {user.suspendedAt ? (<><dt>Suspended</dt><dd>{dateTime(user.suspendedAt)} — {user.suspensionReason ?? 'no reason given'}</dd></>) : null}
          </dl>

          <div className="section-title">Actions</div>
          <div className="field">
            <label htmlFor="reason">Reason (recorded in the audit log)</label>
            <input id="reason" className="input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Verified ID over the phone" />
          </div>
          <div className="toolbar">
            {user.status === 'SUSPENDED' ? (
              <button className="btn btn-sm" disabled={isSelf || update.isPending} onClick={() => update.mutate({ status: 'ACTIVE' })}>Reinstate</button>
            ) : (
              <ConfirmButton className="btn btn-sm btn-danger" disabled={isSelf || update.isPending} label="Suspend" confirm={`Suspend ${user.displayName}? They will be signed out everywhere.`} onConfirm={() => update.mutate({ status: 'SUSPENDED' })} />
            )}
            {user.email && !user.emailVerified ? <button className="btn btn-sm" onClick={() => update.mutate({ emailVerified: true })}>Verify email</button> : null}
            {user.phone && !user.phoneVerified ? <button className="btn btn-sm" onClick={() => update.mutate({ phoneVerified: true })}>Verify phone</button> : null}
            {user.status === 'PENDING_VERIFICATION' ? <button className="btn btn-sm" onClick={() => update.mutate({ status: 'ACTIVE' })}>Activate</button> : null}
            <button className="btn btn-sm" onClick={() => update.mutate({ isPremium: !user.isPremium })}>{user.isPremium ? 'Remove premium' : 'Grant premium'}</button>
          </div>
          {me?.role === 'SUPER_ADMIN' && !isSelf ? (
            <div className="toolbar" style={{ marginTop: 10 }}>
              <select className="select" value={user.role} onChange={(event) => update.mutate({ role: event.target.value })}>
                {['USER', 'VENDOR', 'ADMIN', 'SUPER_ADMIN'].map((value) => <option key={value} value={value}>{humanise(value)}</option>)}
              </select>
              <span className="muted">Changing a role signs the user out.</span>
            </div>
          ) : null}

          <div className="section-title">Recent payments</div>
          {user.recentPayments.length === 0 ? <div className="muted">No payments.</div> : (
            <table>
              <tbody>
                {user.recentPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="mono">{payment.reference}</td>
                    <td>{humanise(payment.purpose)}</td>
                    <td><Badge value={payment.status} /></td>
                    <td className="num">{money(payment.amountMinor, payment.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!isSelf ? (
            <>
              <div className="section-title">Danger zone</div>
              <ConfirmButton className="btn btn-danger" disabled={remove.isPending} label="Delete account" confirm={`Permanently delete ${user.displayName}'s account? Orders and ledgers are kept; personal identifiers are removed.`} onConfirm={() => remove.mutate()} />
            </>
          ) : null}
        </>
      )}
    </Drawer>
  );
}
