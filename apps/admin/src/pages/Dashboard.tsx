import type { AdminDashboardStats } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorBox, PageHeader, Stat } from '../components/ui';
import { api } from '../lib/api';
import { money, number } from '../lib/format';

export function DashboardPage() {
  const [days, setDays] = useState(30);
  const stats = useQuery({ queryKey: ['stats', days], queryFn: () => api.get<AdminDashboardStats>('/admin/stats', { days }) });
  const data = stats.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Platform health at a glance"
        actions={
          <select className="select" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        }
      />
      <ErrorBox error={stats.error} />

      <div className="grid stats">
        <Stat label="Total users" value={number(data?.totalUsers)} sub={`${number(data?.newUsers7d)} new this week`} />
        <Stat label="Active users (30d)" value={number(data?.activeUsers30d)} />
        <Stat label="Birthdays today" value={number(data?.birthdaysToday)} sub={`${number(data?.birthdaysNext7Days)} in the next 7 days`} />
        <Stat label="Gifts sent" value={number(data?.giftsSent)} sub={`${number(data?.digitalGiftsSent)} digital · ${number(data?.reservations)} reservations`} />
        <Stat label="Orders" value={number(data?.orders.total)} sub={`${number(data?.orders.awaitingPayment)} awaiting payment · ${number(data?.orders.processing)} in progress`} />
        <Stat label="Revenue (settled)" value={data ? money(data.revenueMinor, data.currency) : '—'} />
        <Stat label="Vendors" value={number(data?.vendors.approved)} sub={`${number(data?.vendors.pending)} awaiting approval`} />
        <Stat label="Failed payments (7d)" value={number(data?.failedPayments7d)} />
        <Stat label="Pending deliveries" value={number(data?.pendingDeliveries)} />
        <Stat label="Open complaints" value={number(data?.openReports)} />
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <h2>Revenue</h2>
          </div>
          <div className="card-pad" style={{ height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={data?.series ?? []}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#eee" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(value: number) => number(Math.round(value / 100))} width={60} />
                <Tooltip formatter={(value: number) => money(value, data?.currency)} />
                <Area type="monotone" dataKey="revenueMinor" name="Revenue" stroke="#7c3aed" fill="url(#rev)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Sign-ups and orders</h2>
          </div>
          <div className="card-pad" style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={data?.series ?? []}>
                <CartesianGrid stroke="#eee" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} width={40} />
                <Tooltip />
                <Bar dataKey="users" name="New users" fill="#ec4899" radius={[4, 4, 0, 0]} />
                <Bar dataKey="orders" name="Paid orders" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  );
}
