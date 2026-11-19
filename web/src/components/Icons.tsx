import { NpIcon } from './NpIcon';
import type { NpIconName } from './npIcons';

/** Portal icons: thin wrappers over the shared NearPill icon set so every surface draws the same strokes. */
const make = (name: NpIconName, size = 22) => () => <NpIcon name={name} size={size} className="np-icon" />;

export const HomeIcon = make('home');
export const PillIcon = make('pill');
export const StoreIcon = make('store');
export const CartIcon = make('cart');
export const OrdersIcon = make('receipt');
export const UserIcon = make('user');
export const DashboardIcon = make('dashboard');
export const BoxIcon = make('box');
export const ChartIcon = make('chart');
export const CardIcon = make('card');
export const KeyIcon = make('key');
export const ShieldIcon = make('shield');

export const navIcons = {
  dashboard: DashboardIcon, pharmacies: StoreIcon, orders: OrdersIcon, catalog: PillIcon,
  subscriptions: CardIcon, reports: ChartIcon, overview: DashboardIcon, inventory: BoxIcon,
  password: KeyIcon, policy: ShieldIcon, staff: UserIcon, audit: ShieldIcon,
} as const;

export const SearchIcon = make('search');
export const MapIcon = make('map');
export const ChatIcon = make('message');
