import type { ReactNode } from 'react';
import { CircleAlert, Inbox, Loader2 } from 'lucide-react';

/**
 * Unified Empty / Loading / Error presentation.
 *
 * Every page used to render its own variation of these three states, which made
 * the app feel inconsistent and left some screens with no explanation at all.
 * These primitives keep the wording Arabic, the layout mobile-first, and the
 * recovery action obvious.
 */

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center text-amber-700" aria-hidden="true">
        {icon ?? <Inbox className="h-10 w-10" />}
      </div>
      <p className="mt-4 text-lg font-bold text-slate-950">{title}</p>
      {description ? <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-sm font-bold text-slate-600 shadow-sm">
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-amber-700" />
      {label}
    </div>
  );
}

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorState({ title = 'تعذر إتمام العملية', message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-right shadow-sm">
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-rose-800">{title}</p>
          <p className="mt-1 break-words text-sm leading-6 text-rose-700">{message}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-rose-300 bg-white px-3 text-sm font-bold text-rose-700 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
            >
              إعادة المحاولة
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
