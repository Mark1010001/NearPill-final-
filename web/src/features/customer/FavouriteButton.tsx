import { MaterialIcon } from './MaterialIcon';
import { useFavourites } from './favourites';

/** Heart toggle for a pharmacy. Only customers who are signed in can save favourites. */
export function FavouriteButton({ storeId, name }: { storeId: number; name: string }) {
  const favourites = useFavourites();
  if (!favourites.signedIn) return null;
  const on = favourites.has(storeId);
  return <button type="button" className="favourite-button" aria-pressed={on}
    aria-label={on ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
    title={on ? 'Remove from favourites' : 'Add to favourites'} onClick={() => favourites.toggle(storeId)}>
    <MaterialIcon name={on ? 'favoriteRounded' : 'favoriteBorderRounded'} size={22} />
  </button>;
}
