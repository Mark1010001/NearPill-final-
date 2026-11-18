import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { authorizationScope, useSession } from '../auth/session';
import { BrandLoading, ErrorState, FormFeedback, LoadingState } from '../components/States';
import { LoginPage } from '../features/auth/LoginPage';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { AdminDashboard, AdminOrdersPage, AdminReportsPage, CatalogPage, PharmaciesPage, SubscriptionsPage } from '../features/admin/AdminPages';
import { StaffAccountsPage, StockSubmissionsPage } from '../features/admin/AdminExtraPages';
import { PartnerDashboardPage, PartnerInventoryPage, PartnerOrdersPage, PartnerReportsPage } from '../features/partner/PartnerPages';
import { Shell } from './Shell';

const CustomerApp = lazy(() => import('../features/customer/CustomerApp'));
const SiteApp = lazy(() => import('../features/site/SiteApp'));

export function App() {
  return <Routes>
    <Route path="/app/*" element={<Suspense fallback={<BrandLoading />}>
      <CustomerApp />
    </Suspense>} />
    <Route path="/site/*" element={<Suspense fallback={<BrandLoading />}>
      <SiteApp />
    </Suspense>} />
    <Route path="*" element={<OperationsPortal />} />
  </Routes>;
}

function OperationsPortal() {
  const { user, loading, checking, error, retry, logout } = useSession();
  const signOut = useMutation({ mutationFn: logout });
  if (loading) return <BrandLoading label="Restoring secure session…" />;
  if (error) return <main className="centered"><ErrorState error={error} retry={retry} /></main>;
  if (!user) return <LoginPage />;
  if (!['admin', 'partner'].includes(String(user.role))) return <main className="centered"><section className="state-card">
    <h1>Portal access unavailable</h1>
    <p>This account does not have portal access.</p>
    <FormFeedback error={signOut.error} />
    <button className="secondary" disabled={checking || signOut.isPending} onClick={() => signOut.mutate()}>
      {signOut.isPending ? 'Signing out…' : 'Sign out to switch accounts'}
    </button>
  </section></main>;

  const admin = user.role === 'admin';
  return <>
    {checking && <BrandLoading label="Checking your session…" />}
    <div hidden={checking} key={authorizationScope(user)}><Routes>
    <Route element={<Shell />}>
      {admin ? <>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<AdminDashboard />} />
        <Route path="/pharmacies" element={<PharmaciesPage />} />
        <Route path="/orders" element={<AdminOrdersPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/reports" element={<AdminReportsPage />} />
        <Route path="/staff" element={<StaffAccountsPage />} />
        <Route path="/stock-submissions" element={<StockSubmissionsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </> : <>
        <Route index element={<Navigate to="/partner" replace />} />
        <Route path="/partner" element={<PartnerDashboardPage />} />
        <Route path="/partner/orders" element={<PartnerOrdersPage />} />
        <Route path="/partner/inventory" element={<PartnerInventoryPage />} />
        <Route path="/partner/reports" element={<PartnerReportsPage />} />
        <Route path="/partner/change-password" element={<ChangePasswordPage />} />
        <Route path="*" element={<Navigate to="/partner" replace />} />
      </>}
    </Route>
    </Routes></div>
  </>;
}
