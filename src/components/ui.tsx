import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import { ChevronDown, Loader2 } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

/** Joins class names. When two classes set the same thing (h-11 and h-9), the later one wins. */
export function cx(...parts: (string | false | null | undefined)[]) {
  return twMerge(parts.filter(Boolean).join(' '));
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'navy';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-105 active:brightness-95',
  navy: 'bg-navy text-on-accent hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface text-ink border border-line hover:bg-raised active:bg-raised',
  ghost: 'text-ink hover:bg-raised active:bg-raised',
  danger: 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/15',
};
const sizes: Record<Size, string> = {
  xs: 'h-7 px-2 text-[0.8125rem] gap-1 rounded-lg',
  sm: 'h-9 px-3 text-[0.9375rem] gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-base gap-2 rounded-xl',
  lg: 'h-13 px-5 text-lg gap-2 rounded-xl',
};

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', className?: string) {
  return cx(
    // Norwester capitals, like the Shop Manual's buttons.
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-display uppercase tracking-[0.06em] leading-none transition select-none disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

export function ButtonLink({ variant, size, className, ...rest }: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-2xl border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </div>
  );
}

export function Chip({ children, tone = 'neutral', className, icon, title }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'accent' | 'navy'; className?: string; icon?: ReactNode; title?: string }) {
  const tones = {
    neutral: 'border-line bg-raised text-ink',
    warn: 'border-warn/35 bg-warn/12 text-warn',
    accent: 'border-accent/35 bg-accent/12 text-warn',
    navy: 'border-navy/30 bg-navy/10 text-navy',
  };
  return (
    <span title={title} className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none', tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-muted', className)} />;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted', className)}>{children}</kbd>;
}

const inputBase =
  'w-full rounded-xl border border-line bg-raised px-3.5 text-[0.9375rem] text-ink placeholder:text-muted/70 outline-none transition focus:border-navy focus:bg-surface focus:ring-3 focus:ring-navy/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputBase, 'h-11', className)} {...rest} />;
});

export function Select({ className, wrapperClassName, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }) {
  return (
    <div className={cx('relative', wrapperClassName)}>
      <select className={cx(inputBase, 'h-11 appearance-none pr-9', className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  className?: string;
  size?: 'xs' | 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" className={cx('inline-flex rounded-xl border border-line bg-raised p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 rounded-lg font-medium whitespace-nowrap transition',
            size === 'xs' ? 'px-1.5 py-0.5 text-[0.6875rem]' : size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            value === o.value ? 'bg-navy text-on-accent shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-3 flex items-end justify-between gap-3', className)}>
      <h2 className="text-lg font-semibold">{children}</h2>
      {action}
    </div>
  );
}
