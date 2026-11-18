import type { ReactNode } from 'react';

/** Tiny stroke icon set shared by every surface. Decorative: always aria-hidden. */
function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return <svg className="np-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}

export const HomeIcon = () => <Icon><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></Icon>;
export const PillIcon = () => <Icon><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)" /><path d="m9.2 9.2 5.6 5.6" /></Icon>;
export const StoreIcon = () => <Icon><path d="M4 9.5 5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-5h4v5" /></Icon>;
export const CartIcon = () => <Icon><path d="M3 4h2.4l2 11h10.2l2-8H6.5" /><circle cx="9" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></Icon>;
export const OrdersIcon = () => <Icon><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9.5 8h5M9.5 12h5" /></Icon>;
export const UserIcon = () => <Icon><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5z" /></Icon>;
export const DashboardIcon = () => <Icon><rect x="3" y="3" width="7.5" height="9" rx="2" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="2" /><rect x="13.5" y="12" width="7.5" height="9" rx="2" /><rect x="3" y="15.5" width="7.5" height="5.5" rx="2" /></Icon>;
export const BoxIcon = () => <Icon><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9" /></Icon>;
export const ChartIcon = () => <Icon><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Icon>;
export const CardIcon = () => <Icon><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M2.5 10h19M6.5 15h4" /></Icon>;
export const KeyIcon = () => <Icon><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16 6.5l2.5 2.5" /></Icon>;
export const ShieldIcon = () => <Icon><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></Icon>;

export const navIcons = {
  dashboard: DashboardIcon, pharmacies: StoreIcon, orders: OrdersIcon, catalog: PillIcon,
  subscriptions: CardIcon, reports: ChartIcon, overview: DashboardIcon, inventory: BoxIcon,
  password: KeyIcon, policy: ShieldIcon, staff: UserIcon, audit: ShieldIcon,
} as const;

export const SearchIcon = () => <Icon><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Icon>;
export const MapIcon = () => <Icon><path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20" /></Icon>;
export const ChatIcon = () => <Icon><path d="M4 5h16v11H9l-5 4z" /></Icon>;
