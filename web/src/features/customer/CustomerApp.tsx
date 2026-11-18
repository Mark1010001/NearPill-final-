import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useMatch, useNavigate, useNavigationType } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import type { CatalogListing, Order, SessionUser } from '../../api/types';
import { useSession } from '../../auth/session';
import { EmptyState, ErrorState, FormFeedback, LoadingState } from '../../components/States';
import { MaterialIcon } from './MaterialIcon';
import { CustomerAuth, ForgotPasswordPage } from './AuthPages';
import { OnboardingPage, onboardingDone } from './Onboarding';
import { clearCart, loadCart, orderToCartLines, saveCart } from './cartStore';
import { CartContext } from './cartContext';
import { PharmaciesPage, ProductPage, SearchPage } from './CatalogPages';
import { HomePage } from './HomePage';
import { StoreDetailPage } from './StoreDetailPage';
import { MapPage } from './MapPage';
import { OrderHistoryPage, ProfilePage } from './ProfilePage';
import { SettingsPage } from './SettingsPage';
import { AssistantPage } from './AssistantPage';
import { OrdersHub } from './OrdersHub';
import { CartPage, CheckoutPage } from './OrderPages';
import { OrdersPage } from './MyOrders';
import { NotificationsPage } from './NotificationsPage';
import { useOrderUpdates } from './notifications';
import { type CartLine, isSelected, listingKey, positiveId, quantityLimit, removeReservedItems } from './cart';
import './customer.css';

export default function CustomerApp() {
  const { user, checking, logout, otherTabSignOuts } = useSession();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: async () => { if (user?.role === 'customer') clearCart(user.id); await logout(); },
    onSuccess: () => { if (user?.role === 'customer') void navigate('/app/', { replace: true }); },
  });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'NearPill Web App';
    return () => { document.title = previousTitle; };
  }, []);

  const customer = user?.role === 'customer' && positiveId(user.id) ? user : null;
  const logoutButton = <button className="secondary" type="button" disabled={checking || signOut.isPending} onClick={() => signOut.mutate()}>
    {signOut.isPending ? 'Signing out…' : 'Sign out'}
  </button>;

  return <Shop key={customer ? `${customer.id}:${otherTabSignOuts}` : 'guest'} customer={customer} staffSession={!!user && !customer}
    logoutButton={logoutButton} logoutError={signOut.error} />;
}

function signInDestination(value: unknown) {
  if (typeof value === 'string' && value.startsWith('/app/')) {
    const target = new URL(value, window.location.origin);
    if (target.origin === window.location.origin && target.pathname.startsWith('/app/') && target.pathname !== '/app/sign-in') {
      return target.pathname + target.search;
    }
  }
  return '/app/';
}

function Shop({ customer, staffSession, logoutButton, logoutError }: {
  customer: SessionUser | null;
  staffSession: boolean;
  logoutButton: ReactNode;
  logoutError: Error | null;
}) {
  const [saved] = useState(() => customer ? loadCart(customer.id) : { lines: [] as CartLine[], grouped: false });
  const [cart, setCart] = useState<CartLine[]>(saved.lines);
  const [groupedCart, setGroupedCart] = useState(saved.grouped);
  const { loading, checking, error, retry } = useSession();
  const location = useLocation();
  const navigationType = useNavigationType();
  const onCatalog = useMatch('/app');
  const onListing = useMatch('/app/pharmacies/:storeId/medicines/:medicineId');
  const onCart = useMatch('/app/cart');
  const onPickup = useMatch('/app/checkout');
  const onSignIn = useMatch('/app/sign-in');
  const main = useRef<HTMLElement>(null);
  const lastPath = useRef(location.pathname);
  const signInState = onSignIn ? location.state : { returnTo: location.pathname + location.search };
  const cartCount = !checking && !error ? cart.reduce((sum, line) => sum + line.quantity, 0) : 0;
  const orderUpdates = useOrderUpdates(customer && !checking && !error ? String(customer.id) : null);
  const unreadUpdates = orderUpdates.unreadCount;
  const returnsToListing = !!onCatalog && typeof location.state?.returnListing === 'string';
  const signInLink = (label: string) => <Link className="primary shop-button" to="/app/sign-in" state={signInState}>{label}</Link>;

  useLayoutEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    if (returnsToListing) return;
    if (navigationType !== 'POP') window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [location.pathname, navigationType, returnsToListing]);

  useEffect(() => {
    if (cart.length === 0) setGroupedCart(false);
  }, [cart.length]);

  useEffect(() => { if (customer) saveCart(customer.id, cart, groupedCart); }, [customer, cart, groupedCart]);

  /** Merges lines into the cart. Returns an error message (and changes nothing) when a selling unit differs or stock is exceeded. */
  function mergeLines(lines: CartLine[]): string | null {
    let next = cart;
    for (const line of lines) {
      const key = listingKey(line.listing);
      const existing = next.find((entry) => listingKey(entry.listing) === key);
      if (existing && (existing.listing.sellingUnit ?? null) !== (line.listing.sellingUnit ?? null)) {
        return 'The selling unit changed. Remove the old item from your cart first.';
      }
      const quantity = (existing?.quantity ?? 0) + line.quantity;
      if (quantity > quantityLimit(line.listing)) return 'That is more than the listed stock.';
      next = existing ? next.map((entry) => entry === existing ? { listing: line.listing, quantity } : entry) : [...next, { listing: line.listing, quantity }];
    }
    setCart(next);
    return null;
  }

  function addOrderItems(order: Order) { return mergeLines(orderToCartLines(order)); }

  function add(listing: CatalogListing, quantity = 1) {
    if (!customer || checking || error || !positiveId(listing.id) || !positiveId(listing.drugstoreId)) return 'Sign in to add to cart.';
    return mergeLines([{ listing, quantity }]);
  }

  function changeQuantity(key: string, delta: number) {
    setCart((current) => current.map((line) => {
      if (listingKey(line.listing) !== key) return line;
      const quantity = line.quantity + delta;
      return quantity >= 1 && quantity <= quantityLimit(line.listing) ? { ...line, quantity } : line;
    }));
  }

  function setSelected(key: string, value: boolean) {
    setCart((current) => current.map((line) => listingKey(line.listing) === key ? { ...line, selected: value } : line));
  }

  function setPharmacySelected(storeId: number | undefined, value: boolean) {
    setCart((current) => current.map((line) => positiveId(line.listing.drugstoreId) === storeId ? { ...line, selected: value } : line));
  }

  function privatePage(render: (user: SessionUser) => ReactNode) {
    if (error && !checking) return <ErrorState error={error} retry={retry} />;
    if (customer) return <>
      {checking && <LoadingState label="Checking your session…" />}
      <div hidden={checking}>{render(customer)}</div>
    </>;
    if (loading || checking) return <div className="auth-gate" role="status">
      <img className="auth-gate-logo" src="/brand-mark.png" alt="" aria-hidden="true" width="96" height="96" />
      <span className="visually-hidden">Checking your session…</span>
    </div>;
    return <EmptyState>
      <h1>Sign in to continue</h1>
      <p>Use your NearPill customer account to manage your cart and orders.</p>
      {signInLink('Customer sign-in')}
    </EmptyState>;
  }

  const orderActive = useMatch('/app/orders');
  const onHome = !!onCatalog;
  const intro = !customer && !onboardingDone() && onHome;
  const navLabel = (label: string, extra?: string) => extra ? `${label}, ${extra}` : undefined;
  const cartNote = cartCount ? `cart has ${cartCount} ${cartCount === 1 ? 'item' : 'items'}` : undefined;

  if (intro) return <Navigate to="/app/welcome" replace />;

  return <CartContext.Provider value={{ cart, count: cartCount, signedIn: !!customer && !checking && !error, add, addOrderItems }}><div className="shop">
    <a className="skip-link" href="#customer-content" tabIndex={0}>Skip to main content</a>
    <header className="shop-header">
      <div className="shop-container shop-header-inner">
        <Link className="shop-brand" to="/app/"><span className="brand-mark" aria-hidden="true"><img src="/brand-mark.png" alt="" /></span>NearPill</Link>
        <nav className="shop-nav" aria-label="NearPill customer navigation">
          {([
            ['/app/', 'Home', !!onCatalog, 'homeRounded', 'homeOutlined', undefined],
            ['/app/search', 'Search', location.pathname.startsWith('/app/search'), 'search', 'search', undefined],
            ['/app/map', 'Map', location.pathname.startsWith('/app/map'), 'mapRounded', 'mapOutlined', undefined],
            ['/app/orders', 'Orders', !!(orderActive || onCart || onPickup), 'receiptRounded', 'receiptOutlined', navLabel('Orders', cartNote)],
            ['/app/profile', 'Profile', location.pathname.startsWith('/app/profile') || location.pathname.startsWith('/app/notifications'), 'personRounded', 'personOutlined',
              unreadUpdates > 0 ? `Profile, ${unreadUpdates} new order ${unreadUpdates === 1 ? 'update' : 'updates'}` : undefined],
          ] as const).map(([to, label, active, filled, outlined, aria]) => <Link key={to} to={to} aria-label={aria}
            aria-current={active ? 'page' : undefined} className={active ? 'shop-nav-on' : undefined}>
            <span className="shop-nav-icon"><MaterialIcon name={active ? filled : outlined} size={24} />
              {((label === 'Orders' && cartCount > 0) || (label === 'Profile' && unreadUpdates > 0)) && <span className="shop-dot" aria-hidden="true" />}</span>
            <span>{label}</span>
          </Link>)}
        </nav>
        <div className="shop-account">
          {customer ? logoutButton : <NavLink className="secondary shop-button" to="/app/sign-in" state={signInState}>Sign in</NavLink>}
        </div>
      </div>
    </header>
    <main className="shop-container shop-main" id="customer-content" ref={main} tabIndex={-1}>
      <FormFeedback error={logoutError} />
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="welcome" element={<OnboardingPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="pharmacies" element={<PharmaciesPage />} />
        <Route path="pharmacies/:storeId" element={<StoreDetailPage />} />
        <Route path="pharmacies/:storeId/medicines/:medicineId" element={<ProductPage
          signIn={checking ? <span role="status">Checking your session…</span> : !customer || error ? signInLink('Sign in to add to cart') : null} />} />
        <Route path="map" element={<MapPage />} />
        <Route path="assistant" element={privatePage((user) => <AssistantPage user={user} />)} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="sign-in" element={customer && !checking && !error
          ? <Navigate to={signInDestination(location.state?.returnTo)} replace />
          : <section className="shop-login" aria-label="Customer sign-in">
            {checking && <p role="status">Checking your session…</p>}
            {error && !checking && <ErrorState error={error} retry={retry} />}
            {customer ? null : staffSession ? <>
              <h1>Sign in to NearPill</h1>
              <p>A staff account is signed in. Sign out to use your customer account.</p>
              <div className="shop-actions">{logoutButton}<a className="shop-text-link" href="/">Go to Operations Portal</a></div>
            </> : <CustomerAuth disabled={loading || checking || !!error} />}
          </section>} />
        <Route path="cart" element={<Navigate to="/app/orders?tab=cart" replace />} />
        <Route path="checkout" element={privatePage((user) => <CheckoutPage cart={cart.filter(isSelected)} user={user}
          onReserved={(items) => setCart((current) => removeReservedItems(current, items))} />)} />
        <Route path="orders" element={privatePage((user) => <OrdersHub cartCount={cartCount}
          cart={<CartPage accountId={String(user.id)} cart={cart} changeQuantity={changeQuantity} setSelected={setSelected} setPharmacySelected={setPharmacySelected}
            testCheckout={user.xenditTestCheckout} continueGrouped={groupedCart} onGroupedReview={() => setGroupedCart(true)}
            remove={(key) => setCart((current) => current.filter((line) => listingKey(line.listing) !== key))} />}
          orders={<OrdersPage user={user} retrySession={retry} hasRemainingCart={cart.length > 0} />} />)} />
        <Route path="profile" element={privatePage((user) => <ProfilePage user={user} />)} />
        <Route path="profile/orders" element={privatePage((user) => <OrderHistoryPage user={user} />)} />
        <Route path="settings" element={privatePage((user) => <SettingsPage user={user} signOutButton={logoutButton} />)} />
        <Route path="notifications" element={privatePage((user) => <NotificationsPage user={user} />)} />
        <Route path="*" element={<EmptyState>
          <h1>Page unavailable</h1>
          <p>Use the navigation above to continue.</p>
          <Link className="primary shop-button" to="/app/search">Find medicines</Link>
        </EmptyState>} />
      </Routes>
    </main>
    <footer className="shop-footer"><div className="shop-container">
      <a className="shop-text-link" href="/policies.html">Privacy and service information</a>
      <a className="shop-text-link" href="/">Operations Portal</a>
    </div></footer>
  </div></CartContext.Provider>;
}
