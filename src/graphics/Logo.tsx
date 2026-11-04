import logoUrl from '../assets/logo/croswell-industries.svg';
import markUrl from '../assets/logo/croswell-c.svg';
import { cx } from '../components/ui';

// The owner's Croswell Industries logo and its "C" mark. Both are used as
// masks, so they are drawn in the current text color (navy).

function masked(url: string) {
  const mask = `url("${url}") center / contain no-repeat`;
  return { WebkitMask: mask, mask };
}

/** Full logo with the name and tagline. Used on Home only. */
export function CroswellLogo({ className }: { className?: string }) {
  return <span role="img" aria-label="Croswell Industries: Making your life easier" className={cx('block aspect-[675/154] bg-current', className)} style={masked(logoUrl)} />;
}

/** The "C" mark alone. Used on every other screen. */
export function CroswellMark({ className }: { className?: string }) {
  return <span role="img" aria-label="Croswell Industries" className={cx('block aspect-[84.4/94] bg-current', className)} style={masked(markUrl)} />;
}
