import { type ReactNode, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import type { LinkProps } from 'react-router';
import type { CatalogListing } from '../../api/types';
import { pesos } from '../../components/States';
import { cartCategory, cartTotal, listingIssue, listingKey, nonnegativeInteger, quantityLimit } from './cart';
import { useCart } from './cartContext';
import { MaterialIcon } from './MaterialIcon';
import { useToast } from './toast';

/** White thumbnail for a medicine without a photo: the Rx mark for prescriptions, a pharmacy or box icon otherwise. */
export function CategoryThumb({ category, large = false }: { category?: string | null; large?: boolean }) {
  const kind = cartCategory(category ?? null);
  return <span className={`cat-thumb${large ? ' cat-thumb-lg' : ''}${kind === 'Non-prescription' ? ' cat-thumb-otc' : ''}`} aria-hidden="true">
    {kind === 'Prescription' ? <img src="/rx-mark.png" alt="" /> : <MaterialIcon name={kind === 'Non-prescription' ? 'localPharmacyOutlined' : 'inventory'} size={large ? 30 : 22} />}
  </span>;
}

/** Add-to-cart with one coalesced toast per burst of taps (same behaviour as the Android app). */
export function useCatalogAdd(storeName?: string, storeId?: number) {
  const cart = useCart();
  const { show, toast } = useToast();
  const pending = useRef<{ key: string; total: number; timer?: number }>({ key: '', total: 0 });
  useEffect(() => () => window.clearTimeout(pending.current.timer), []);
  function add(item: CatalogListing, quantity: number) {
    const listing = { ...item, drugstoreName: storeName ?? item.drugstoreName, drugstoreId: item.drugstoreId ?? storeId! };
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
  return { add, toast };
}

const labelFor = (kind: ReturnType<typeof cartCategory>, fallback: string) =>
  kind === 'Prescription' ? 'Prescription' : kind === 'Non-prescription' ? 'Non-Prescription' : kind === 'Non-medicine' ? 'Non-Medicines' : fallback;

/** One catalog item, shared by the pharmacy page and the Search tab. */
export function CatalogCard({ listing, to, subtitle, quantity, onQuantity, onAdd, showAvailability = false }: {
  listing: CatalogListing;
  to: LinkProps['to'];
  subtitle?: string | null;
  quantity: number;
  onQuantity: (next: number) => void;
  onAdd: () => void;
  showAvailability?: boolean;
}) {
  const cart = useCart();
  const location = useLocation();
  const limit = quantityLimit(listing);
  const price = nonnegativeInteger(listing.priceCentavos);
  const kind = cartCategory(listing.category);
  const stock = nonnegativeInteger(listing.stockCount) ?? 0;
  const issue = showAvailability ? listingIssue(listing) : null;
  return <article className="card product-card">
    <div className="product-card-top">
      <CategoryThumb category={listing.category} large={kind === 'Prescription'} />
      <div>
        <p className="product-tags">
          <span className={`product-cat${kind === 'Prescription' ? ' product-cat-rx' : kind === 'Non-prescription' ? ' product-cat-otc' : ''}`}>{labelFor(kind, listing.category ?? '')}</span>
          <span className={`pill ${stock === 0 ? 'pill-bad' : issue ? 'pill-warn' : 'pill-ok'}`}>{stock === 0 ? 'Out of stock' : issue ? 'Not available right now' : `Stock (${stock})`}</span>
        </p>
        <h3><Link to={to}>{listing.name}</Link></h3>
        {subtitle && <p className="shop-muted">{subtitle}</p>}
        <p className="product-price"><strong>{price === null ? 'Price unavailable' : pesos(price)}</strong>{price !== null && listing.sellingUnit ? <span> / {listing.sellingUnit}</span> : null}</p>
      </div>
    </div>
    <div className="store-item-actions">
      <span className="store-stepper">
        <button type="button" className="icon-button" aria-label={`Decrease quantity for ${listing.name}`} disabled={quantity <= 1}
          onClick={() => onQuantity(quantity - 1)}><MaterialIcon name="remove" size={20} /></button>
        <span aria-label={`Quantity ${quantity}`}>{quantity}</span>
        <button type="button" className="icon-button store-stepper-add" aria-label={`Increase quantity for ${listing.name}`} disabled={quantity >= limit}
          onClick={() => onQuantity(quantity + 1)}><MaterialIcon name="add" size={20} /></button>
      </span>
      {cart.signedIn
        ? <button type="button" className="primary" onClick={onAdd}><MaterialIcon name="shoppingBagOutlined" size={18} />Add to cart</button>
        : <Link className="primary shop-button" to="/app/sign-in" state={{ returnTo: location.pathname + location.search }}>Sign in to add to cart</Link>}
    </div>
  </article>;
}

/** Filter pills: the selected one is solid green with a check. */
export function FilterChips({ items, selected, onPick }: {
  items: { key: string | null; label: string }[];
  selected: string | null;
  onPick: (key: string | null) => void;
}) {
  return <div className="chip-row chip-row-store" role="group" aria-label="Category">
    {items.map((entry) => {
      const on = selected === entry.key;
      return <button key={entry.key ?? 'all'} type="button" className={`chip${on ? ' chip-on' : ''}`} aria-pressed={on} onClick={() => onPick(entry.key)}>
        {on && <MaterialIcon name="check" size={16} />}{entry.label}</button>;
    })}
  </div>;
}

/** Cart summary bar shown while the cart has items. */
export function CartDock(): ReactNode {
  const cart = useCart();
  if (!cart.signedIn || cart.count <= 0) return null;
  const cents = cartTotal(cart.cart);
  return <aside className="cart-dock" aria-label="Cart summary">
    <span className="cart-dock-icon" aria-hidden="true"><MaterialIcon name="shoppingBagOutlined" size={22} /><b>{cart.count}</b></span>
    <span className="cart-dock-text"><span>{cart.count === 1 ? '1 item in cart' : `${cart.count} items in cart`}</span>{cents !== null && <strong>{pesos(cents)}</strong>}</span>
    <Link className="primary shop-button" to="/app/orders?tab=cart">View Cart<MaterialIcon name="chevronRight" size={18} /></Link>
  </aside>;
}
