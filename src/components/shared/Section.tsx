import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * The standard card that every page section lives in.
 *
 * Pages were each inventing `rounded-2xl border border-slate-200 bg-white p-5
 * shadow-sm` by hand, and drifting: different padding, different heading sizes,
 * some sections with no heading element at all. One primitive keeps the rhythm
 * identical and guarantees each section is a labelled landmark.
 */
export function Section({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn('min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5', className)}
    >
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-base font-bold text-slate-950 sm:text-lg">{title}</h2>}
            {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn('min-w-0', contentClassName)}>{children}</div>
    </section>
  );
}

/**
 * A horizontally scrollable wrapper for wide content.
 *
 * Tables were widening the whole page on phones instead of scrolling
 * themselves; `min-w-0` on the parent plus this wrapper keeps the page pinned.
 */
export function ScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('-mx-1 overflow-x-auto px-1', className)}>{children}</div>;
}
