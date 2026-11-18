import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { CatalogListing } from '../../api/types';
import { pesos } from '../../components/States';
import { SearchIcon } from '../../components/Icons';
import { categoryFilters } from './CatalogPages';
import { cartCategory, listingKey, nonnegativeInteger, positiveId, quantityLimit } from './cart';
import { useCart } from './cartContext';
import { useToast } from './toast';
import { FavouriteButton } from './FavouriteButton';
import { MaterialIcon } from './MaterialIcon';

const hoursText = (hours: unknown) => typeof hours === 'string' ? hours : '';

/** The app's pharmacy screen (StoreDetailScreen). */
export function StoreDetailPage() {
  const id = positiveId(useParams().storeId);
  const location = useLocation();
  const cart = useCart();
  const { show, toast } = useToast();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const pending = useRef<{ key: string; total: number; timer?: number }>({ key: '', total: 0 });
  useEffect(() => { const t = window.setTimeout(() => setDebounced(text.trim().toLowerCase()), 300); return () => window.clearTimeout(t); }, [text]);
  useEffect(() => () => window.clearTimeout(pending.current.timer), []);
  const inventory = useQuery({
    queryKey: ['store-inventory', id],
    queryFn: ({ signal }) => api.publicInventory(id!, signal, true),
    enabled: !!id,
    retry: false,
  });
  const store = inventory.data?.store;
  const items = (inventory.data?.inventory ?? []).filter((item) =>
    (!category || cartCategory(item.category) === category)
    && (!debounced || `${item.name} ${item.genericName ?? ''}`.toLowerCase().includes(debounced)));
  const hours = hoursText(store?.operating_hours);
  const open = store?.openNow;

  function addToCart(item: CatalogListing, quantity: number) {
    const listing = { ...item, drugstoreName: store?.store_name ?? item.drugstoreName, drugstoreId: item.drugstoreId ?? id! };
    if (quantity <= 0 || quantity > quantityLimit(listing)) return;
    if (cart.add(listing, quantity) !== null) { show('Could not save this item to your cart.'); return; }
    const key = listingKey(listing);
    const p = pending.current;
    p.total = p.key === key ? p.total + quantity : quantity;
    p.key = key;
    window.clearTimeout(p.timer);
    p.timer = window.setTimeout(() => {
      show(p.total > 1 ? `Added ${p.total} ${item.name} to cart` : `Added ${item.name} to cart`);
      p.key = ''; p.total = 0;
    }, 500);
  }

  return <>
    <Link className="shop-text-link shop-back-link" to={location.state?.from ?? '/app/pharmacies'}>Back</Link>
    {inventory.isPending && !!id ? <p role="status" className="center-note">Loading pharmacy details…</p>
      : !id || inventory.isError ? <div className="center-note" role="alert">
        <p>Unable to load pharmacy details and stock. Please retry.</p>
        {!!id && <button type="button" className="shop-text-link" onClick={() => void inventory.refetch()}>Retry</button>}
      </div> : <>
        <header className="store-head">
          <h1>{store?.store_name ?? 'Store'}</h1>
          {id && <FavouriteButton storeId={id} name={store?.store_name ?? 'this pharmacy'} />}
          <span className={`pill ${open === true ? 'pill-ok' : 'pill-muted'}`}>{open == null ? 'Hours not confirmed' : open ? 'Open now' : 'Closed'}</span>
        </header>
        {hours && <p className="shop-muted">Hours {hours}</p>}
        <div className="store-actions">
          <button type="button" className="secondary" disabled>Call</button>
          <button type="button" className="secondary" disabled>Message</button>
        </div>
        <div className="search-field">
          <span aria-hidden="true"><SearchIcon /></span>
          <input type="search" aria-label="Search in this store" placeholder="Search in this store" maxLength={160} value={text} onChange={(event) => setText(event.target.value)} />
        </div>
        <div className="chip-row" role="group" aria-label="Category">
          <button type="button" className={`chip${!category ? ' chip-on' : ''}`} aria-pressed={!category} onClick={() => setCategory(null)}>All</button>
          {categoryFilters.map((entry) => <button key={entry.value} type="button" className={`chip${category === entry.kind ? ' chip-on' : ''}`}
            aria-pressed={category === entry.kind} onClick={() => setCategory(entry.kind)}>{entry.label}</button>)}
        </div>
        {items.length === 0 ? <p className="center-note" role="status">No items found in this store.</p> : <ul className="product-list">
          {items.map((item) => {
            const key = String(item.id);
            const limit = quantityLimit(item);
            const quantity = Math.min(Math.max(1, quantities[key] ?? 1), limit);
            const price = nonnegativeInteger(item.priceCentavos);
            const label = categoryFilters.find((entry) => entry.kind === cartCategory(item.category))?.label ?? item.category ?? '';
            return <li key={key}><article className="card product-card">
              <div className="product-card-top">
                <span className="icon-tile icon-tile-sm" aria-hidden="true"><MaterialIcon name="medication" size={24} /></span>
                <div>
                  <h3><Link to={`/app/pharmacies/${id}/medicines/${positiveId(item.id)}`}>{item.name}</Link></h3>
                  <p className="shop-muted">{label}</p>
                  <p className="shop-muted">{(nonnegativeInteger(item.stockCount) ?? 0) === 0 ? 'Out of stock' : 'Available'}</p>
                </div>
              </div>
              <div className="store-item-actions">
                <strong>{price === null ? 'Price unavailable' : `${pesos(price)}${item.sellingUnit ? ` per ${item.sellingUnit}` : ''}`}</strong>
                <span className="stepper">
                  <button type="button" className="icon-button" aria-label={`Decrease quantity for ${item.name}`} disabled={quantity <= 1}
                    onClick={() => setQuantities((q) => ({ ...q, [key]: quantity - 1 }))}><MaterialIcon name="remove" size={24} /></button>
                  <span aria-label={`Quantity ${quantity}`}>{quantity}</span>
                  <button type="button" className="icon-button" aria-label={`Increase quantity for ${item.name}`} disabled={quantity >= limit}
                    onClick={() => setQuantities((q) => ({ ...q, [key]: quantity + 1 }))}><MaterialIcon name="add" size={24} /></button>
                </span>
                {cart.signedIn
                  ? <button type="button" className="primary" onClick={() => addToCart(item, quantity)}>Add to cart</button>
                  : <Link className="primary shop-button" to="/app/sign-in" state={{ returnTo: location.pathname }}>Sign in to add to cart</Link>}
              </div>
            </article></li>;
          })}
        </ul>}
      </>}
    {toast}
  </>;
}
