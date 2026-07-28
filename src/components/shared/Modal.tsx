import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
};

let scrollY = 0;

function lockBodyScroll(): void {
  scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.overflow = 'hidden';
}

function unlockBodyScroll(): void {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.overflow = '';
  window.scrollTo(0, scrollY);
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previouslyOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      if (previouslyOpen.current) {
        unlockBodyScroll();
        previouslyOpen.current = false;
      }
      return;
    }

    previouslyOpen.current = true;
    lockBodyScroll();
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      // Keep keyboard focus inside the dialog while it is open.
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);

      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="إغلاق النافذة"
        className="absolute inset-0 cursor-default bg-slate-950/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          // Full-height sheet on phones, centered dialog from `sm` upwards.
          // `overscroll-contain` stops the page behind from scrolling with it.
          'relative flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl',
          className,
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 bg-white px-5 py-4">
          <h2 id={titleId} className="text-base font-bold text-slate-950">
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-stone-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </section>
    </div>
  );
}
