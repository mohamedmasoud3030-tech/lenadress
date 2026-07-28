import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * The shared filter row.
 *
 * Filters were re-implemented on every list page. Several used `focus:ring`
 * instead of `focus-visible:ring` (so a mouse click drew a ring), most were
 * under the 44px tap target, and almost none of the selects had any label at
 * all — a screen reader announced "combo box" with no indication of what it
 * filtered. This primitive fixes all three at once.
 */

const CONTROL =
  'min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm text-slate-950 outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30';

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-white p-4 shadow-sm', className)}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </div>
  );
}

/** Search input with a visually hidden but programmatically present label. */
export function SearchFilter({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="relative block min-w-0">
      <span className="sr-only">{label}</span>
      <Search aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? label}
        className={cn(CONTROL, 'pr-11')}
      />
    </label>
  );
}

/** Select filter that always announces what it narrows. */
export function SelectFilter<Value extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: Value;
  onChange: (value: Value) => void;
  options: ReadonlyArray<{ value: Value; label: string }>;
}) {
  return (
    <label className="block min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as Value)}
        aria-label={label}
        className={CONTROL}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
