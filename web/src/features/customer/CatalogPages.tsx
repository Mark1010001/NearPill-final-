import { type FormEvent, type ReactNode, type Ref, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { CatalogListing } from '../../api/types';
import { EmptyState, ErrorState, SkeletonCards, pesos } from '../../components/States';
import { NearbyMap } from './NearbyMap';
import { coordinate, distanceKm, formatDistance, useUserLocation } from './location';
import { SearchIcon } from '../../components/Icons';
import { useCart } from './cartContext';
import { useToast } from './toast';
import { type CartLine, cartCategory, listingIssue, listingKey, listingPath, nonnegativeInteger, positiveId, quantityLimit } from './cart';
import { MaterialIcon } from './MaterialIcon';

function SearchForm({ label, placeholder, search, onSearch }: {
  label: string;
  placeholder: string;
  search: string;
  onSearch: (query: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current && input.current.value !== search) input.current.value = search;
  }, [search]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(String(new FormData(event.currentTarget).get('query') ?? '').trim());
  }
  return <form className="shop-search" role="search" onSubmit={submit}>
    <label>{label}<input ref={input} name="query" type="search" defaultValue={search} maxLength={160} placeholder={placeholder} /></label>
    <button type="submit" className="primary">Search</button>
  </form>;
}

export const categoryFilters = [
  { value: 'non-prescription', label: 'Non-Prescriptions', kind: 'Non-prescription' },
  { value: 'prescription', label: 'Prescriptions', kind: 'Prescription' },
  { value: 'non-medicine', label: 'Non Medicines', kind: 'Non-medicine' },
] as const;

function listingDistance(listing: CatalogListing): string | null {
  const km = Number(listing.distanceKm);
  if (listing.distanceKm !== null && listing.distanceKm !== undefined && listing.distanceKm !== '' && Number.isFinite(km) && km >= 0) return formatDistance(km);
  const text = listing.distance?.trim();
  return text && !text.toLowerCase().includes('unavailable') ? text : null;
}

/** The app's "Search products" screen. */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const location = useUserLocation({ auto: true });
  const [query, setQuery] = useState(() => (params.get('q') ?? '').slice(0, 160));
  const category = categoryFilters.find((entry) => entry.value === params.get('category'));
  const settled = location.state === 'granted' || location.state === 'denied' || location.state === 'unavailable';
  const lat = location.position?.lat;
  const lng = location.position?.lng;
  const catalog = useQuery({
    queryKey: ['customer-catalog-all', lat === undefined ? null : Math.round(lat * 1000), lng === undefined ? null : Math.round(lng * 1000)],
    queryFn: ({ signal }) => api.catalogAll(lat === undefined || lng === undefined ? null : { lat, lng }, signal),
    enabled: settled,
    retry: false,
    staleTime: 0,
  });
  const text = query.trim().toLowerCase();
  const products = (catalog.data ?? []).filter((listing) =>
    (!category || cartCategory(listing.category) === category.kind)
    && (listing.name.toLowerCase().includes(text) || listing.drugstoreName.toLowerCase().includes(text)));
  const returned = useLocation().search;
  const loading = !settled || catalog.isPending || catalog.isFetching && !catalog.data;

  function pick(value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set('category', value); else next.delete('category');
    setParams(next, { replace: true });
  }
  const chip = (label: string, selected: boolean, onClick: () => void) =>
    <button type="button" className={`chip${selected ? ' chip-on' : ''}`} aria-pressed={selected} onClick={onClick}>{label}</button>;

  return <>
    <div className="screen-header">
      <h1>Search products</h1>
      <div className="screen-actions">
        {category && <button type="button" className="icon-button" aria-label="Clear category filter" onClick={() => pick(null)}><MaterialIcon name="close" size={24} /></button>}
        <button type="button" className="icon-button" aria-label="Refresh products" disabled={loading} onClick={() => void catalog.refetch()}><MaterialIcon name="refresh" size={24} /></button>
      </div>
    </div>
    <div className="search-field">
      <span aria-hidden="true"><SearchIcon /></span>
      <input type="search" aria-label="Search products, brands, or symptoms" placeholder="Search products, brands, or symptoms"
        maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} />
      {query && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><MaterialIcon name="closeRounded" size={24} /></button>}
    </div>
    <div className="chip-row" role="group" aria-label="Category">
      {chip('All Items', !category, () => pick(null))}
      {categoryFilters.map((entry) => chip(entry.label, category?.value === entry.value, () => pick(entry.value)))}
    </div>
    {!loading && location.message && <div className="location-banner" role="status">
      <span>{location.message}</span>
      <button type="button" className="shop-text-link" onClick={location.start}>Retry</button>
    </div>}
    {loading ? <SkeletonCards label="Loading products" count={4} />
      : catalog.isError ? <div role="alert" className="center-note">
        <p>Unable to load products. Please try again.</p>
        <button type="button" className="shop-text-link" onClick={() => void catalog.refetch()}>Try again</button>
      </div>
      : products.length === 0 ? <p className="center-note" role="status">{text ? 'No products match your search.' : category ? 'No products in this category.' : 'No products found.'}</p>
      : <ul className="product-list">
        {products.map((listing) => <li key={listingKey(listing)}><MedicineCard listing={listing} search={returned} /></li>)}
      </ul>}
  </>;
}

function MedicineCard({ listing, search, linkRef }: { listing: CatalogListing; search: string; linkRef?: Ref<HTMLAnchorElement> }) {
  const price = nonnegativeInteger(listing.priceCentavos);
  const issue = listingIssue(listing);
  const stock = nonnegativeInteger(listing.stockCount) ?? 0;
  const distance = listingDistance(listing);
  const path = { pathname: listingPath(listing), search };
  return <article className="card product-card">
    <div className="product-card-top">
      <span className="icon-tile" aria-hidden="true"><MaterialIcon name="addRounded" size={24} /></span>
      <div>
        <h3><Link ref={linkRef} to={path}>{listing.name}</Link></h3>
        <p className="shop-muted">{distance ? `${listing.drugstoreName} · ${distance}` : listing.drugstoreName}</p>
        <div className="product-meta">
          <span className={`pill ${issue ? 'pill-warn' : 'pill-ok'}`}><i aria-hidden="true" />{stock === 0 ? 'Out of stock' : issue ? 'Not available right now' : 'Available'}</span>
          {stock > 0 && <span>{stock} listed in stock</span>}
        </div>
      </div>
    </div>
    <hr />
    <div className="product-card-bottom">
      <div><span className="eyebrow">UNIT PRICE</span>
        <strong>{price === null ? 'Price unavailable' : `${pesos(price)}${listing.sellingUnit ? ` per ${listing.sellingUnit}` : ''}`}</strong></div>
      <Link className="pill-button" to={path} aria-label={`Add ${listing.name}`}><MaterialIcon name="add" size={18} /> Add</Link>
    </div>
  </article>;
}

function ListingStatus({ listing }: { listing: CatalogListing }) {
  const issue = listingIssue(listing);
  return <span className={`status ${issue ? 'status-pending' : 'status-active'}`}>{issue ?? 'Available'}</span>;
}

export function PharmaciesPage() {
  const [params, setParams] = useSearchParams();
  const heading = useRef<HTMLHeadingElement>(null);
  const search = (params.get('q') ?? '').trim().slice(0, 160);
  const pharmacies = useQuery({
    queryKey: ['customer-pharmacies', search],
    queryFn: ({ signal }) => api.publicPharmacies(search, signal),
  });
  const location = useUserLocation();
  const verified = pharmacies.data?.filter((store) => store.verified === true) ?? [];
  const here = location.position;
  const withDistance = verified.map((store) => {
    const lat = coordinate(store.latitude, 90);
    const lng = coordinate(store.longitude, 180);
    const point = lat !== null && lng !== null ? { lat, lng } : null;
    return { store, point, km: here && point ? distanceKm(here, point) : null };
  });
  const stores = here
    ? [...withDistance].sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity))
    : withDistance;
  const mapped = stores.filter((entry) => entry.point && entry.km !== null).slice(0, 8);
  return <>
    <div className="shop-hero">
      <div className="page-heading">
        <h1>Find a pharmacy</h1>
        <p>Search verified pharmacies by name, street, or area.</p>
      </div>
      <SearchForm label="Pharmacy or area" placeholder="Name, street, or area" search={search}
        onSearch={(query) => setParams(query ? { q: query } : {})} />
      {search && <Link className="shop-text-link" to="/app/pharmacies">Show all pharmacies</Link>}
    </div>
    <section className="card location-panel" aria-labelledby="location-heading">
      <h2 id="location-heading">Your location</h2>
      {location.state === 'granted' && here ? <>
        <p role="status">Showing pharmacies nearest to you. Your position stays on this device and is not saved to your account.
          {here.accuracy > 500 ? ` It is only accurate to about ${Math.round(here.accuracy / 100) / 10} km, so distances are rough.` : ''}</p>
        <div className="location-actions">
          <a className="shop-text-link" href={`https://www.google.com/maps/search/?api=1&query=${here.lat},${here.lng}`} target="_blank" rel="noopener noreferrer">See my location in Google Maps</a>
          <button type="button" className="secondary" onClick={location.stop}>Stop using my location</button>
        </div>
        {mapped.length > 0 && <div className="location-map">
          <NearbyMap position={here} pharmacies={mapped.map(({ store, point }) => ({ id: store.store_id, name: store.store_name, ...point! }))} />
          <ol className="location-legend" aria-label="Nearest pharmacies">
            {mapped.map(({ store, km }) => <li key={store.store_id}><span>{store.store_name}</span> <span className="shop-muted">{formatDistance(km!)}</span></li>)}
          </ol>
        </div>}
      </> : <>
        <p>{location.message ?? 'Share your location to see the pharmacies closest to you and where they are around you.'}</p>
        <button type="button" className="primary" onClick={location.start} disabled={location.state === 'asking'}>
          {location.state === 'asking' ? 'Finding your location…' : location.state === 'idle' ? 'Use my location' : 'Try again'}
        </button>
      </>}
    </section>
    <div className="shop-section-heading">
      <h2 ref={heading} tabIndex={-1}>{search ? `Pharmacies matching “${search}”` : 'Verified pharmacies'}</h2>
    </div>
    {pharmacies.isPending ? <SkeletonCards label="Finding pharmacies…" count={4} />
      : pharmacies.isError ? <ErrorState error={pharmacies.error} retry={() => {
        heading.current?.focus();
        void pharmacies.refetch();
      }} />
      : stores.length === 0 ? <EmptyState>
        <strong>No verified pharmacies found.</strong>
        <p>{search ? 'Try another name or area.' : 'Check back when more pharmacies are available.'}</p>
      </EmptyState>
      : <ul className="shop-grid">
        {stores.map(({ store, point, km }) => <li key={store.store_id}><article className="card shop-listing">
          <div className="shop-card-meta">
            <span className="status status-verified">Verified</span>
            <span className={`status ${store.openNow === true ? 'status-active' : ''}`}>
              {store.openNow === true ? 'Open' : store.openNow === false ? 'Closed' : 'Confirm hours'}
            </span>
          </div>
          <h3>{store.store_name}</h3>
          <p className="shop-muted">{store.address}</p>
          {here && <p className="shop-distance">{km !== null ? formatDistance(km) : 'Distance unavailable'}</p>}
          {point && <a className="shop-text-link" href={`https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`} target="_blank" rel="noopener noreferrer"
            aria-label={`Directions to ${store.store_name} in Google Maps (opens a new tab)`}>Directions</a>}
          <Link className="secondary shop-button" to={`/app/pharmacies/${store.store_id}`} aria-label={`Browse medicines at ${store.store_name}`}>Browse medicines</Link>
        </article></li>)}
      </ul>}
  </>;
}

export function ProductPage({ signIn }: { signIn: ReactNode }) {
  const location = useLocation();
  const params = useParams();
  const cartApi = useCart();
  const { show, toast } = useToast();
  const [quantity, setQuantity] = useState(1);
  const pending = useRef<{ total: number; timer?: number }>({ total: 0 });
  useEffect(() => () => window.clearTimeout(pending.current.timer), []);
  const storeId = positiveId(params.storeId);
  const medicineId = positiveId(params.medicineId);
  const inventory = useQuery({
    queryKey: ['customer-inventory', storeId],
    enabled: !!storeId && !!medicineId,
    queryFn: ({ signal }) => api.publicInventory(storeId!, signal),
  });
  const store = inventory.data?.store;
  const listing = store?.verified === true && store.store_id === storeId
    ? inventory.data?.inventory.find((row) => positiveId(row.id) === medicineId && positiveId(row.drugstoreId) === storeId)
    : undefined;
  const details = useQuery({
    queryKey: ['customer-medicine-description', medicineId],
    enabled: !!listing && cartApi.signedIn,
    retry: false,
    queryFn: ({ signal }) => api.medicineById(medicineId!, signal),
  });
  const price = nonnegativeInteger(listing?.priceCentavos);
  const cartLine = listing && cartApi.cart.find((line) => listingKey(line.listing) === listingKey(listing));
  const count = cartLine ? cartLine.quantity : 0;
  const unitChanged = cartLine && (cartLine.listing.sellingUnit ?? null) !== (listing?.sellingUnit ?? null);
  const limit = listing ? quantityLimit(listing) : 1;
  const atLimit = listing ? count >= limit : false;
  const chosen = Math.min(Math.max(1, quantity), limit);
  const description = (details.data?.description ?? '').split(/\[NEARPILL_STAGING_TEST_APPROVAL:[^\]]*\]/)[0].trim();
  const back = <Link className="shop-text-link shop-back-link" to={{ pathname: '/app/search', search: location.search }}
    state={storeId && medicineId ? { returnListing: `${storeId}:${medicineId}` } : undefined}>
    {location.search ? 'Back to results' : 'Browse medicines'}
  </Link>;

  function addChosen() {
    if (!listing) return;
    if (cartApi.add(listing, chosen) !== null) { show('Could not save this item to your cart.'); return; }
    const p = pending.current;
    p.total += chosen;
    window.clearTimeout(p.timer);
    p.timer = window.setTimeout(() => { show(`Added ${p.total} item${p.total === 1 ? '' : 's'} to cart`); p.total = 0; }, 500);
  }

  return <>
    {back}
    {!storeId || !medicineId ? <EmptyState><h1>Medicine listing unavailable</h1><p>Search for this medicine again.</p></EmptyState>
      : inventory.isPending ? <SkeletonCards label="Loading medicine details…" count={3} />
      : inventory.isError ? <ErrorState error={inventory.error} retry={() => { void inventory.refetch(); }} />
      : !listing || !store ? <EmptyState><h1>Medicine listing unavailable</h1><p>Look for another listing or pharmacy.</p></EmptyState>
      : <>
        <div className="screen-header"><h1>Medicine Details</h1></div>
        <article className="card shop-product">
          <div className="product-card-top">
            <span className="icon-tile" aria-hidden="true"><MaterialIcon name="medicalServices" size={24} /></span>
            <div>
              <h2 className="product-title">{listing.name}</h2>
              <p className="shop-muted shop-pharmacy-name">{store.store_name}</p>
              {listing.genericName && <p className="shop-muted">{listing.genericName}</p>}
            </div>
          </div>
          <p><ListingStatus listing={listing} /></p>
          <div className="price-row">
            <div>
              <span className="shop-muted">Price</span>
              <strong className="shop-product-price">{price === null ? 'Price unavailable' : pesos(price)}</strong>
              {listing.sellingUnit && <span>Per {listing.sellingUnit}</span>}
              {listing.packageSize && <span>Supplier package {listing.packageSize}</span>}
            </div>
            <span className="stepper stepper-pill">
              <button type="button" className="icon-button" aria-label="Decrease quantity" disabled={chosen <= 1} onClick={() => setQuantity(chosen - 1)}><MaterialIcon name="remove" size={24} /></button>
              <strong aria-label={`Quantity ${chosen}`}>{chosen}</strong>
              <button type="button" className="icon-button" aria-label="Increase quantity" disabled={chosen >= limit} onClick={() => setQuantity(chosen + 1)}><MaterialIcon name="add" size={24} /></button>
            </span>
          </div>
          <div className="shop-card-meta"><span className="shop-muted">Total</span><strong>{price === null ? 'Unavailable' : pesos(price * chosen)}</strong></div>
          {listingIssue(listing) && <p className="notice">You can save this listing to your cart. Checkout requires an eligible listing with confirmed stock.</p>}
          <div className="shop-actions">
            {signIn || <button className="primary add-wide" type="button" disabled={atLimit || !!unitChanged} onClick={addChosen}>
              {unitChanged ? 'Remove the old unit from your cart first' : atLimit ? 'Cart quantity limit reached' : `Add ${chosen} to cart`}
            </button>}
            {count > 0 && <Link className="secondary shop-button" to="/app/orders?tab=cart">View cart</Link>}
          </div>
          <p className="shop-muted" role="status">{count > 0 ? `${count} in your cart` : ''}</p>
        </article>
        <section className="card shop-product">
          <h2>Description</h2>
          <p className="shop-muted">{description || 'No description provided.'}</p>
          <div className="shop-card-meta"><span className="shop-muted">ID</span><strong>{String(listing.id)}</strong></div>
        </section>
        {toast}
      </>}
  </>;
}
