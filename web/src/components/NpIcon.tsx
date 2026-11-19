import { npIcons, type NpIconName } from './npIcons';

/** One NearPill icon (24px grid, 1.75 stroke, round caps). The same paths the Android app draws. Decorative: always aria-hidden. */
export function NpIcon({ name, size = 24, className }: { name: NpIconName; size?: number; className?: string }) {
  const icon: { s: readonly string[]; f?: readonly string[] } = npIcons[name];
  const stroke = Math.max(1.75, (1.5 * 24) / size);
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {icon.s.map((d, i) => <path key={`s${i}`} d={d} />)}
      {icon.f?.map((d, i) => <path key={`f${i}`} d={d} fill="currentColor" />)}
    </svg>
  );
}
