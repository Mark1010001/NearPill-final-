import { npIcons, type NpIconName } from '../../components/npIcons';

/**
 * The customer app's icons. Every name used by the screens maps onto the one NearPill icon set
 * (tools/icons), the same stroke paths the Android app draws, so both apps look identical.
 * Names are kept so screens keep asking for what they mean ("chevronRight", "storefront").
 */
const legacy = {
  homeOutlined: 'home',
  homeRounded: 'home',
  search: 'search',
  searchBaseline: 'search',
  mapOutlined: 'map',
  mapRounded: 'map',
  receiptOutlined: 'receipt',
  receiptRounded: 'receipt',
  personOutlined: 'user',
  personRounded: 'user',
  accountCircle: 'userCircle',
  localPharmacy: 'pharmacy',
  myLocation: 'locate',
  directions: 'directions',
  close: 'x',
  refresh: 'refresh',
  navigation: 'navigation',
  favoriteRounded: 'heartFilled',
  favoriteBorderRounded: 'heart',
  notificationsOutlined: 'bell',
  notificationsRounded: 'bellDot',
  accountBalanceWalletOutlined: 'wallet',
  add: 'plus',
  addRounded: 'plus',
  addShoppingCart: 'bagPlus',
  arrowBack: 'arrowLeft',
  assignmentOutlined: 'clipboardList',
  assignmentTurnedInOutlined: 'clipboardCheck',
  badgeOutlined: 'idCard',
  cakeOutlined: 'cake',
  call: 'phone',
  cancel: 'xCircle',
  cancelOutlined: 'xCircle',
  chatBubbleOutline: 'message',
  check: 'check',
  checkCircle: 'checkCircle',
  checkCircleOutline: 'checkCircle',
  chevronRight: 'chevronRight',
  circle: 'dot',
  closeRounded: 'x',
  contentPasteOutlined: 'clipboard',
  copyRounded: 'copy',
  deleteOutline: 'trash',
  downloadOutlined: 'download',
  editOutlined: 'pencil',
  emailOutlined: 'mail',
  errorOutline: 'alertCircle',
  eventOutlined: 'calendar',
  facebook: 'facebook',
  history: 'history',
  hourglassTop: 'hourglass',
  infoOutline: 'info',
  localPharmacyOutlined: 'pharmacy',
  localShippingOutlined: 'truck',
  locationOffOutlined: 'locationOff',
  lockOutline: 'lock',
  logout: 'logOut',
  medicalServices: 'medical',
  medicalServicesOutlined: 'medical',
  medication: 'pill',
  personOutline: 'user',
  phoneOutlined: 'phone',
  photoCameraOutlined: 'camera',
  pinOutlined: 'hash',
  placeOutlined: 'mapPin',
  placeRounded: 'mapPin',
  radioButtonChecked: 'radioOn',
  remove: 'minus',
  restartAlt: 'refresh',
  searchOff: 'searchOff',
  send: 'send',
  shoppingBagOutlined: 'bag',
  storefront: 'store',
  sync: 'refresh',
  timelapse: 'timer',
  visibilityOffOutlined: 'eyeOff',
  visibilityOutlined: 'eye',
  warningAmberRounded: 'alertTriangle',
  radioButtonOff: 'circle',
  inventory: 'box',
} as const satisfies Record<string, NpIconName>;

export const materialIcons = legacy;

export function MaterialIcon({ name, size = 24, color, className }: {
  name: keyof typeof legacy; size?: number; color?: string; className?: string;
}) {
  const icon: { s: readonly string[]; f?: readonly string[] } = npIcons[legacy[name]];
  // Never thinner than 1.5px on small icons: the stroke is 1.75 units on a 24 grid.
  const stroke = Math.max(1.75, (1.5 * 24) / size);
  return (
    <svg className={`mi mi-${name}${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width="1em" height="1em" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      style={{ fontSize: size, color }}>
      {icon.s.map((d, i) => <path key={`s${i}`} d={d} />)}
      {icon.f?.map((d, i) => <path key={`f${i}`} d={d} fill="currentColor" />)}
    </svg>
  );
}
