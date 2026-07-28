import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * A searchable picker for long lists.
 *
 * A native `<select>` is fine for five options. It is unusable on a phone for a
 * showroom with two hundred dresses or four hundred customers: the operator has
 * to scroll a system wheel with no way to type. Every "choose a dress" and
 * "choose a customer" control had exactly that problem, and there was no way to
 * clear a choice once made — the reported "no clear way to remove what I picked".
 *
 * This component keeps the semantics of a listbox (labelled, keyboard operable,
 * announced) while adding a filter box and an explicit clear button.
 */

export type SearchableOption = {
  value: string;
  /** Primary line, matched against the query. */
  label: string;
  /** Secondary line, also matched. */
  hint?: string;
  /** Right-aligned tag such as a price or a count. */
  badge?: string;
  disabled?: boolean;
  disabledReason?: string;
};

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  /** Shown when the list itself is empty, e.g. nothing is bookable. */
  unavailableText?: string;
};

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'اختاري…',
  searchPlaceholder = 'اكتبي للبحث…',
  emptyText = 'لا توجد نتائج مطابقة.',
  error,
  hint,
  required,
  unavailableText,
}: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => `${option.label} ${option.hint ?? ''}`.toLowerCase().includes(needle));
  }, [options, query]);

  // Clicking outside closes the list without changing the selection.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQuery('');
  }, [open]);

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const select = (option: SearchableOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  return (
    <div className="min-w-0" ref={containerRef}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold text-slate-700">
        {label}
        {required && <span aria-hidden="true" className="mr-1 text-rose-600">*</span>}
        {required && <span className="sr-only">(مطلوب)</span>}
      </label>

      <div className="relative">
        <button
          id={id}
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'flex min-h-11 w-full items-center gap-2 rounded-xl border bg-white px-3 py-2 text-right text-sm transition focus-visible:outline-none focus-visible:ring-2',
            error
              ? 'border-rose-400 focus-visible:border-rose-500 focus-visible:ring-rose-500/30'
              : 'border-slate-300 focus-visible:border-amber-500 focus-visible:ring-amber-500/30',
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', selected ? 'font-bold text-slate-950' : 'text-slate-400')}>
            {selected ? selected.label : placeholder}
          </span>
          {selected && (
            // An explicit way to undo a choice, which the plain selects never had.
            <span
              role="button"
              tabIndex={0}
              aria-label={`إزالة الاختيار ${selected.label}`}
              onClick={(event) => { event.stopPropagation(); onChange(''); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange('');
                }
              }}
              className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-stone-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </span>
          )}
          <ChevronDown aria-hidden="true" className={cn('h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="relative border-b border-slate-100 p-2">
              <Search aria-hidden="true" className="pointer-events-none absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={`بحث داخل ${label}`}
                className="min-h-11 w-full rounded-lg border border-slate-200 bg-stone-50 pr-9 text-sm outline-none focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
              />
            </div>

            <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto overscroll-contain p-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-slate-500">
                  {options.length === 0 ? (unavailableText ?? emptyText) : emptyText}
                </li>
              ) : (
                filtered.map((option) => (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={option.value === value}
                      disabled={option.disabled}
                      title={option.disabled ? option.disabledReason : undefined}
                      onClick={() => select(option)}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm transition',
                        option.disabled
                          ? 'cursor-not-allowed text-slate-400'
                          : 'hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
                        option.value === value && 'bg-amber-50',
                      )}
                    >
                      {option.value === value
                        ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-700" />
                        : <span aria-hidden="true" className="h-4 w-4 shrink-0" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold text-slate-900">{option.label}</span>
                        {(option.hint || (option.disabled && option.disabledReason)) && (
                          <span className="block truncate text-xs text-slate-500">
                            {option.disabled ? option.disabledReason : option.hint}
                          </span>
                        )}
                      </span>
                      {option.badge && <span className="shrink-0 text-xs font-bold text-slate-600">{option.badge}</span>}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      {hint && !error && <p id={hintId} className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p id={errorId} role="alert" className="mt-1 text-xs font-bold text-rose-700">{error}</p>}
    </div>
  );
}
