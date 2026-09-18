import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AuditPage } from './pages/Audit';
import { BroadcastPage } from './pages/Broadcast';
import { CategoriesPage } from './pages/Categories';
import { ComplaintsPage } from './pages/Complaints';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { OrdersPage } from './pages/Orders';
import { PaymentsPage } from './pages/Payments';
import { ProductsPage } from './pages/Products';
import { PromotionsPage } from './pages/Promotions';
import { ReportsPage } from './pages/Reports';
import { UsersPage } from './pages/Users';
import { VendorsPage } from './pages/Vendors';

const NAV = [
  { section: 'Overview', items: [{ to: '/', label: '📊 Dashboard' }, { to: '/reports', label: '📈 Reports' }] },
  { section: 'People', items: [{ to: '/users', label: '👥 Users' }, { to: '/complaints', label: '🚩 Complaints' }] },
  {
    section: 'Marketplace',
    items: [
      { to: '/vendors', label: '🏪 Vendors' },
      { to: '/products', label: '🎁 Products' },
      { to: '/categories', label: '🗂️ Categories' },
      { to: '/promotions', label: '🏷️ Promotions' },
    ],
  },
  { section: 'Money', items: [{ to: '/orders', label: '📦 Orders' }, { to: '/payments', label: '💳 Payments' }] },
  { section: 'System', items: [{ to: '/broadcast', label: '📣 Notifications' }, { to: '/audit', label: '🧾 Audit log' }] },
];

export function App() {
  const { status, user, signOut } = useAuth();

  if (status === 'loading') {
    return (
      <div className="login">
        <div className="muted">Loading…</div>
      </div>
    );
  }
  if (status === 'signed-out') return <LoginPage />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">🎂</span> Birthday Admin
        </div>
        <nav className="nav">
          {NAV.map((group) => (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ padding: '24px 10px 0', fontSize: 12 }}>
          <div style={{ color: '#fff', fontWeight: 600 }}>{user?.displayName}</div>
          <div style={{ color: '#8b84a6', margin: '2px 0 10px' }}>{user?.role === 'SUPER_ADMIN' ? 'Super admin' : 'Admin'}</div>
          <button className="btn btn-sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/complaints" element={<ComplaintsPage />} />
          <Route path="/vendors" element={<VendorsPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/promotions" element={<PromotionsPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/broadcast" element={<BroadcastPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
