import { NpIcon } from '../../components/NpIcon';
import type { NpIconName } from '../../components/npIcons';

/** Website icons: the shared NearPill set, addressed by the names the site pages already use. */
const names = {
  pin: 'mapPin', search: 'search', box: 'box', store: 'store', wallet: 'wallet', receipt: 'receipt', bot: 'bot', shield: 'shield',
  lock: 'lock', pill: 'pill', file: 'file', clipboard: 'clipboard', check: 'check', arrow: 'arrowRight', phone: 'phone',
  calendar: 'calendar', home: 'home', user: 'user', plus: 'plus', menu: 'menu', close: 'x',
} as const satisfies Record<string, NpIconName>;

export type IconName = keyof typeof names;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <NpIcon name={names[name]} size={size} className="st-icon" />;
}
