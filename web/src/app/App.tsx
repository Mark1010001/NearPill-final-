import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
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

/**
 * The public website lives at the root address: nearpill.xyz, nearpill.xyz/features, and so on.
 * nginx answers 404 for any other path, using the $nearpill_known_route map in deploy/nginx.conf.template
 * and web/nginx.conf. Keep that map and web/public/sitemap.xml in sync with this list and PORTAL_PATHS.
 */
const SITE_PATHS = ['/', '/features', '/partners', '/about', '/contact', '/policies'];

/** Old /site/... links keep working and move to the new address. */
function SiteRedirect() {
  const { pathname, hash } = useLocation();
  const rest = pathname.replace(/^\/site\/?/, '').replace(/\/+$/, '');
  const target = SITE_PATHS.includes(`/${rest}`) ? `/${rest}` : '/';
  return <Navigate to={`${target}${hash}`} replace />;
}

/**
 * Addresses that belong to the admin and partner portals. Anything else that is not a website page is "Page not found".
 * Mirrored by the $nearpill_known_route map in the nginx configs and by web/public/robots.txt.
 */
const PORTAL_PATHS = ['/portal', '/dashboard', '/pharmacies', '/orders', '/catalog', '/subscriptions', '/reports', '/staff', '/stock-submissions', '/partner'];

function Fallback() {
  const { pathname } = useLocation();
  if (PORTAL_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return <OperationsPortal />;
  return <Suspense fallback={<BrandLoading />}><SiteApp /></Suspense>;
}

export function App() {
  return <Routes>
    <Route path="/app/*" element={<Suspense fallback={<BrandLoading />}>
      <CustomerApp />
    </Suspense>} />
    {SITE_PATHS.map((path) => <Route key={path} path={path} element={<Suspense fallback={<BrandLoading />}>
      <SiteApp />
    </Suspense>} />)}
    <Route path="/site/*" element={<SiteRedirect />} />
    <Route path="*" element={<Fallback />} />
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
