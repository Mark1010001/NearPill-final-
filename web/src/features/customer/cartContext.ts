import { createContext, useContext } from 'react';
import type { CatalogListing, Order } from '../../api/types';
import type { CartLine } from './cart';

export type CartApi = {
  cart: CartLine[]; count: number; signedIn: boolean;
  add: (listing: CatalogListing, quantity?: number) => string | null;
  addOrderItems: (order: Order) => string | null;
};
export const CartContext = createContext<CartApi | null>(null);
export function useCart(): CartApi {
  const value = useContext(CartContext);
  if (!value) throw new Error('CartContext is required.');
  return value;
}
