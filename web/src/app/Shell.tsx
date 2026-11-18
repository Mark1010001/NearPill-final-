import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useRef, useState } from 'react';
import { useSession } from '../auth/session';
import { navIcons } from '../components/Icons';

type NavItem = readonly [to: string, label: string, icon: keyof typeof navIcons];

const adminNav: readonly NavItem[] = [
  ['/dashboard', 'Dashboard', 'dashboard'], ['/pharmacies', 'Pharmacies', 'pharmacies'], ['/orders', 'Orders', 'orders'],
  ['/catalog', 'Stocks', 'catalog'], ['/subscriptions', 'Subscriptions', 'subscriptions'], ['/staff', 'Partner pharmacy accounts', 'staff'], ['/stock-submissions', 'Stock submissions', 'catalog'], ['/reports', 'Reports', 'reports'],
] as const;
const partnerNav: readonly NavItem[] = [
  ['/partner', 'Overview', 'overview'], ['/partner/orders', 'Orders', 'orders'], ['/partner/inventory', 'Inventory', 'inventory'], ['/partner/reports', 'Reports & Plan', 'reports'],
  ['/partner/change-password', 'Change password', 'password'],
] as const;

export function Shell() {
  const { user, logout } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('np-sidebar') === 'collapsed'; } catch { return false; } });
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const nav = user?.role === 'admin' ? adminNav : partnerNav;
  const membership = user?.memberships?.find((item) => item.isActive !== false);
  const currentPage = [...nav].sort((a, b) => b[0].length - a[0].length).find(([to]) => location.pathname === to || location.pathname.startsWith(`${to}/`))?.[1];
  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('np-sidebar', next ? 'collapsed' : 'expanded'); } catch { /* preference is optional */ }
  }
  async function signOut() {
    setSigningOut(true);
    setLogoutError('');
    try { await logout(); }
    catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Try again.');
      setSigningOut(false);
    }
  }
  return <div className="portal-shell" data-collapsed={collapsed}>
    <a className="skip-link" href="#portal-content">Skip to content</a>
    <aside className="sidebar">
      <div className="sidebar-heading">
        <Link className="brand" to="/portal"><img className="brand-logo" src="/brand-mark.png" width="36" height="36" alt="" aria-hidden="true" />Near<span>Pill</span></Link>
        <button type="button" className="secondary menu-toggle" aria-expanded={menuOpen}
          aria-controls="portal-navigation" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? 'Close menu' : 'Menu'}
        </button>
        <button type="button" className="collapse-toggle" aria-pressed={collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleCollapsed}>{collapsed ? '»' : '«'}</button>
      </div>
      <div className="workspace">
        <strong>{user?.role === 'admin' ? 'Platform Operations' : membership?.drugstoreName || `Pharmacy ${membership?.drugstoreId ?? ''}`}</strong>
        <span>{user?.role === 'partner' ? membership?.membershipRole : 'Administrator'}</span>
      </div>
      <nav id="portal-navigation" aria-label="Portal navigation" data-open={menuOpen}>
        {nav.map(([to, label, icon]) => { const NavIcon = navIcons[icon]; return <NavLink key={to} to={to} end={to === '/partner'} onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          setMenuOpen(false);
          requestAnimationFrame(() => {
            window.scrollTo(0, 0);
            main.current?.focus({ preventScroll: true });
          });
        }}><NavIcon /><span className="nav-label">{label}</span></NavLink>; })}
        <a href="/policies.html"><navIcons.policy /><span className="nav-label">Privacy & terms</span></a>
      </nav>
      <div className="sidebar-user"><strong>{user?.fullName || user?.name || user?.email}</strong><small>{user?.email}</small></div>
    </aside>
    <div className="portal-main">
      <header className="topbar"><div><strong className="topbar-brand"><img src="/brand-mark.png" width="24" height="24" alt="" aria-hidden="true" />NearPill</strong><span>{currentPage}</span></div><button className="secondary" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? 'Signing out…' : 'Logout'}</button></header>
      {logoutError && <p className="form-error logout-error" role="alert">Could not sign out. {logoutError}</p>}
      <main id="portal-content" className="page" tabIndex={-1} ref={main}><Outlet /></main>
    </div>
  </div>;
}
