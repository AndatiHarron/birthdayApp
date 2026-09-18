import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyRow, ErrorBox, LoadingRows, PageHeader, Stat } from '../components/ui';
import { api } from '../lib/api';
import { humanise, money, number } from '../lib/format';

interface EngagementReport {
  dailyActiveUsers: number;
  monthlyActiveUsers: number;
  stickiness: number;
  events: Array<{ name: string; count: number }>;
  topCategories: Array<{ label: string; count: number }>;
  paidOrders: number;
  averageOrderValueMinor: number;
  checkoutConversionPercent: number | null;
}

export function ReportsPage() {
  const [days, setDays] = useState(30);
  const report = useQuery({ queryKey: ['engagement', days], queryFn: () => api.get<EngagementReport>('/admin/reports/engagement', { days }) });
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Engagement, gifting and sales (anonymous product analytics)"
        actions={
          <select className="select" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
        }
      />
      <ErrorBox error={report.error} />
      <div className="grid stats">
        <Stat label="Daily active users" value={number(data?.dailyActiveUsers)} />
        <Stat label="Monthly active users" value={number(data?.monthlyActiveUsers)} sub={data ? `${data.stickiness}% DAU/MAU` : undefined} />
        <Stat label="Paid orders" value={number(data?.paidOrders)} />
        <Stat label="Average order value" value={data ? money(data.averageOrderValueMinor) : '—'} />
        <Stat label="Checkout conversion" value={data?.checkoutConversionPercent != null ? `${data.checkoutConversionPercent}%` : '—'} />
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <h2>Top gift categories</h2>
          </div>
          <div className="card-pad" style={{ height: 300 }}>
            {data && data.topCategories.length === 0 ? (
              <div className="empty">No paid orders in this period.</div>
            ) : (
              <ResponsiveContainer>
                <BarChart data={data?.topCategories ?? []} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid stroke="#eee" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} fontSize={11} />
                  <YAxis type="category" dataKey="label" fontSize={11} width={110} />
                  <Tooltip />
                  <Bar dataKey="count" name="Items sold" fill="#7c3aed" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Product events</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th className="num">Count</th>
                </tr>
              </thead>
              <tbody>
                {report.isLoading ? <LoadingRows columns={2} /> : null}
                {data && data.events.length === 0 ? <EmptyRow columns={2} message="No events recorded in this period." /> : null}
                {data?.events.map((event) => (
                  <tr key={event.name}>
                    <td>{humanise(event.name)}</td>
                    <td className="num">{number(event.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
