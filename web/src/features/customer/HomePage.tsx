import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { categoryFilters } from './CatalogPages';
import { FavouriteButton } from './FavouriteButton';
import { useFavourites } from './favourites';
import { MaterialIcon } from './MaterialIcon';

const categoryBlurb: Record<string, string> = {
  'non-prescription': 'OTC remedies, vitamins, supplements',
  prescription: 'Upload doctor\'s prescription',
  'non-medicine': 'Personal care, hygiene & supplies',
};
const categoryIcon: Record<string, 'medicalServicesOutlined' | 'assignmentOutlined' | 'shoppingBagOutlined'> = { 'non-prescription': 'medicalServicesOutlined', prescription: 'assignmentOutlined', 'non-medicine': 'shoppingBagOutlined' };

/** The app's Home tab. */
export function HomePage() {
  const stores = useQuery({ queryKey: ['home-pharmacies'], queryFn: ({ signal }) => api.publicPharmacies('', signal), retry: false, staleTime: 0 });
  const favourites = useFavourites();
  const [openOnly, setOpenOnly] = useState(false);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const all = stores.data ?? [];
  const list = all.filter((store) => (!openOnly || store.openNow === true) && (!favouritesOnly || favourites.has(store.store_id)));
  return <>
    <div className="screen-header"><h1>NearPill</h1>
      <Link className="pill-button" to="/app/assistant"><MaterialIcon name="chatBubbleOutline" size={20} /> Ask NearPill</Link></div>
    <Link className="card home-location" to="/app/map">
      <span className="icon-tile" aria-hidden="true"><MaterialIcon name="placeRounded" size={24} /></span>
      <span><strong>Cebu City, Philippines</strong><br /><span className="shop-muted">Use current location</span></span>
      <span aria-hidden="true" className="chev"><MaterialIcon name="chevronRight" size={24} /></span>
    </Link>
    <div className="screen-header home-section"><h2>Nearby Drugstores</h2>
      <Link className="shop-text-link" to="/app/map">See all pharmacies</Link></div>
    {stores.isPending ? <progress aria-label="Loading pharmacies" />
      : stores.isError ? <div><p role="status">Unable to load the latest pharmacy information.</p>
        <button type="button" className="shop-text-link" onClick={() => { void stores.refetch(); }}>Try again</button></div>
      : all.length === 0 ? <p>No pharmacies are listed yet.</p>
      : <>
        <ul className="filter-chips" aria-label="Filter pharmacies">
          <li><button type="button" aria-pressed={openOnly} onClick={() => setOpenOnly(!openOnly)}>Open now</button></li>
          {favourites.signedIn && <li><button type="button" aria-pressed={favouritesOnly} onClick={() => setFavouritesOnly(!favouritesOnly)}>Favourites</button></li>}
        </ul>
        {list.length === 0 ? <p role="status">{favouritesOnly && openOnly ? 'None of your favourite pharmacies are open right now.' : favouritesOnly ? 'You have no favourite pharmacies yet. Tap the heart on a pharmacy to add one.' : 'No pharmacies are open right now.'}</p>
      : <ul className="home-stores">
        {list.map((store) => {
          const km = Number(store.distanceKm);
          return <li key={store.store_id}><FavouriteButton storeId={store.store_id} name={store.store_name} /><Link className="card home-store" to={`/app/pharmacies/${store.store_id}`}>
            <span className="home-store-top"><span className="icon-tile" aria-hidden="true"><MaterialIcon name="localPharmacyOutlined" size={24} /></span>
              {store.distanceKm !== null && store.distanceKm !== undefined && Number.isFinite(km) && <span className="pill pill-muted">{km.toFixed(1)} km</span>}</span>
            <strong>{store.store_name}</strong>
            <span className="shop-muted">{store.address}</span>
            <span className={`pill ${store.openNow === true ? 'pill-ok' : 'pill-bad'}`}><i aria-hidden="true" />{store.openNow === true ? 'OPEN' : 'CLOSED'}</span>
          </Link></li>;
        })}
      </ul>}
      </>}
    <div className="screen-header home-section"><h2>Categories</h2></div>
    <ul className="home-categories">
      {categoryFilters.map((entry) => <li key={entry.value}><Link className="card home-category" to={`/app/search?category=${entry.value}`}>
        <span className="icon-tile" aria-hidden="true">{categoryIcon[entry.value] ? <MaterialIcon name={categoryIcon[entry.value]} size={24} /> : null}</span>
        <span><strong>{entry.label}</strong><br /><span className="shop-muted">{categoryBlurb[entry.value]}</span></span>
        <span aria-hidden="true" className="chev"><MaterialIcon name="chevronRight" size={24} /></span>
      </Link></li>)}
    </ul>
  </>;
}
