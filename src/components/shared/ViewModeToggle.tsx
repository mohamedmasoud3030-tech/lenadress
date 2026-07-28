import { useEffect, useState } from 'react';
import { LayoutGrid, Rows3 } from 'lucide-react';
import { getBrowserLocalStorage } from '@platform/storage';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';

export type ViewMode = 'grid' | 'list';

/**
 * Grid / list switch for inventory-style pages.
 *
 * Cards are good for browsing a dress by its photo; a compact list is far
 * better for scanning forty codes or checking status quickly on a phone. The
 * app only ever offered cards, so the operator had to scroll past a large image
 * for every single item.
 *
 * The choice is remembered per page key, because it is a working preference:
 * re-picking it on every visit is exactly the kind of friction that makes a
 * tool feel unfinished.
 */
const STORAGE_PREFIX = 'lena:view-mode:';

export function useViewMode(pageKey: string, fallback: ViewMode = 'grid'): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(fallback);

  useEffect(() => {
    // Storage is reached through the platform port, never directly.
    const storage = getBrowserLocalStorage();
    if (!storage) return;
    try {
      const stored = storage.getItem(`${STORAGE_PREFIX}${pageKey}`);
      if (stored === 'grid' || stored === 'list') setMode(stored);
    } catch {
      // A blocked storage must never stop the page rendering.
    }
  }, [pageKey]);

  const update = (next: ViewMode) => {
    setMode(next);
    const storage = getBrowserLocalStorage();
    if (!storage) return;
    try {
      storage.setItem(`${STORAGE_PREFIX}${pageKey}`, next);
    } catch {
      // Preference persistence is best effort.
    }
  };

  return [mode, update];
}

export function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const options: Array<{ value: ViewMode; label: string; icon: typeof LayoutGrid }> = [
    { value: 'grid', label: 'عرض شبكي', icon: LayoutGrid },
    { value: 'list', label: 'عرض قائمة', icon: Rows3 },
  ];

  return (
    <div role="group" aria-label="طريقة العرض" className="inline-flex shrink-0 rounded-xl border border-slate-300 bg-white p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={mode === option.value}
          aria-label={option.label}
          title={option.label}
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition ${AMBER_FOCUS_RING_CLASS_NAME} ${
            mode === option.value ? 'bg-slate-950 text-white' : 'text-slate-500 hover:bg-stone-100 hover:text-slate-900'
          }`}
        >
          <option.icon aria-hidden="true" className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
