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
let lockCount = 0;

/**
 * Locks the page behind the dialog.
 *
 * The previous implementation set `position: fixed` on `<body>` with a negative
 * `top`. On a phone that fights the software keyboard: every focus and blur
 * re-laid out the fixed body, so the sheet visibly jumped up and down while
 * typing. Now the body simply stops scrolling and keeps its position, and the
 * dialog itself is sized to the *visual* viewport, so the keyboard shrinks the
 * sheet instead of shoving the page around.
 *
 * Nested dialogs are counted, so closing an inner one does not unlock the page
 * while an outer one is still open.
 */
function lockBodyScroll(): void {
  lockCount += 1;
  if (lockCount > 1) return;
  scrollY = window.scrollY;
  document.body.style.overflow = 'hidden';
  document.body.style.touchAction = 'none';
}

function unlockBodyScroll(): void {
  lockCount = Math.max(lockCount - 1, 0);
  if (lockCount > 0) return;
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('touch-action');
  // Restore the exact reading position the operator was at.
  window.scrollTo(0, scrollY);
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previouslyOpen = useRef(false);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      if (previouslyOpen.current) {
        unlockBodyScroll();
        previouslyOpen.current = false;
        // Return focus to whatever opened the dialog.
        previouslyFocused.current?.focus?.();
        previouslyFocused.current = null;
      }
      return;
    }

    previouslyOpen.current = true;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
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

  /**
   * Tracks the visual viewport so the sheet resizes with the software keyboard
   * instead of being pushed off-screen. Without this the submit button on a
   * long Arabic form sat underneath the keyboard and could not be reached.
   */
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    if (!viewport) return;

    const applyViewportHeight = () => {
      dialogRef.current?.style.setProperty('--modal-viewport-height', `${viewport.height}px`);
    };

    applyViewportHeight();
    viewport.addEventListener('resize', applyViewportHeight);
    viewport.addEventListener('scroll', applyViewportHeight);
    return () => {
      viewport.removeEventListener('resize', applyViewportHeight);
      viewport.removeEventListener('scroll', applyViewportHeight);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-4">
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
        style={{ maxHeight: 'var(--modal-viewport-height, 100dvh)' }}
        className={cn(
          // Full-height sheet on phones, centered dialog from `sm` upwards.
          // The height follows the visual viewport, so the keyboard shrinks the
          // sheet rather than displacing it.
          'relative flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl',
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
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-stone-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </section>
    </div>
  );
}
