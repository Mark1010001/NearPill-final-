import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { SearchIcon } from '../../components/Icons';
import { categoryFilters } from './CatalogPages';
import { cartCategory, positiveId, quantityLimit } from './cart';
import { CartDock, CatalogCard, FilterChips, useCatalogAdd } from './CatalogCard';
import { FavouriteButton } from './FavouriteButton';
import { MaterialIcon } from './MaterialIcon';


/** The app's pharmacy screen (StoreDetailScreen). */
export function StoreDetailPage() {
  const id = positiveId(useParams().storeId);
  const location = useLocation();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  useEffect(() => { const t = window.setTimeout(() => setDebounced(text.trim().toLowerCase()), 300); return () => window.clearTimeout(t); }, [text]);
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
  const open = store?.openNow;

  const { add: addToCart, toast } = useCatalogAdd(store?.store_name, id);

  return <>
    {inventory.isPending && !!id ? <><Link className="shop-text-link shop-back-link" to={location.state?.from ?? '/app/pharmacies'}>Back</Link><p role="status" className="center-note">Loading pharmacy details…</p></>
      : !id || inventory.isError ? <><Link className="shop-text-link shop-back-link" to={location.state?.from ?? '/app/pharmacies'}>Back</Link><div className="center-note" role="alert">
        <p>Unable to load pharmacy details and stock. Please retry.</p>
        {!!id && <button type="button" className="shop-text-link" onClick={() => void inventory.refetch()}>Retry</button>}
      </div></> : <>
        <header className="store-head">
          <Link className="round-back" to={location.state?.from ?? '/app/pharmacies'} aria-label="Back"><MaterialIcon name="arrowBack" size={24} /></Link>
          <div className="store-head-title">
            <h1>{store?.store_name ?? 'Store'}</h1>
            <span className={`pill ${open === true ? 'pill-ok' : 'pill-muted'}`}><i aria-hidden="true" />{open == null ? 'Hours not confirmed' : open ? 'Open now' : 'Closed'}</span>
          </div>
          {id && <FavouriteButton storeId={id} name={store?.store_name ?? 'this pharmacy'} />}
        </header>
        <div className="search-field store-search">
          <span aria-hidden="true"><SearchIcon /></span>
          <input type="search" aria-label="Search in this store" placeholder="Search in this store" maxLength={160} value={text} onChange={(event) => setText(event.target.value)} />
        </div>
        <FilterChips items={[{ key: null, label: 'All' }, ...categoryFilters.map((entry) => ({ key: entry.kind, label: entry.label }))]}
          selected={category} onPick={setCategory} />
        {items.length === 0 ? <p className="center-note" role="status">No items found in this store.</p> : <ul className="product-list">
          {items.map((item) => {
            const key = String(item.id);
            const quantity = Math.min(Math.max(1, quantities[key] ?? 1), quantityLimit(item));
            return <li key={key}><CatalogCard listing={item} to={`/app/pharmacies/${id}/medicines/${positiveId(item.id)}`} quantity={quantity}
              onQuantity={(next) => setQuantities((q) => ({ ...q, [key]: next }))} onAdd={() => addToCart(item, quantity)} /></li>;
          })}
        </ul>}
        <CartDock />
      </>}
    {toast}
  </>;
}
