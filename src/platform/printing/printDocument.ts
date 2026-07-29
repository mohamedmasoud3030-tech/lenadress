/**
 * The single popup/print boundary for the whole application.
 *
 * ## Why this is not `window.open`
 *
 * The showroom runs this as an installed PWA. In a standalone PWA — and in the
 * iOS in-app browser — `window.open('', '_blank')` produces a bare view with no
 * address bar, no back button and no visible close affordance. The operator
 * ended up trapped in a white page showing only the document, with no way back
 * to the app except killing it. That was reported from a real phone.
 *
 * Every printable document is therefore rendered into a **same-document overlay
 * iframe**: the app stays mounted underneath, the overlay has an explicit
 * Arabic close button, Escape closes it, and printing targets the iframe only.
 * Nothing can strand the operator.
 *
 * The overlay is removed after printing (or on close), so no stale document is
 * left in the DOM.
 */

export class PrintDocumentError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PrintDocumentError';
  }
}

export function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] ?? character
  ));
}

import { DEFAULT_PRINT_SETTINGS, buildPrintStyles, type PrintSettings } from './printSettings';

/**
 * Legacy fixed stylesheet.
 *
 * Kept only so an older caller that has not passed settings still prints
 * something sane. New documents go through `buildPrintStyles`, which honours the
 * showroom's paper size, margins and colour mode.
 */
export const PRINT_BASE_STYLES = `
body{font-family:'Noto Sans Arabic',Arial,sans-serif;padding:32px;color:#0f172a;direction:rtl}
h1{margin:0 0 4px}
small,.muted{color:#64748b}
table{width:100%;border-collapse:collapse;margin-top:20px}
th,td{border:1px solid #cbd5e1;padding:10px;text-align:right}
.total{margin-top:20px;font-size:20px;font-weight:bold}
.section{margin-top:24px}
.terms{margin-top:20px;font-size:13px;line-height:1.9}
.signatures{display:flex;justify-content:space-between;margin-top:64px}
@media print{body{padding:12px}}
`;

/** Class applied to the host element so tests and styles can find the overlay. */
export const PRINT_OVERLAY_CLASS = 'lena-print-overlay';

export function buildPrintDocumentMarkup(title: string, bodyHtml: string, settings?: PrintSettings): string {
  // Settings-driven styles win; the legacy sheet is the fallback for old callers.
  const styles = settings ? buildPrintStyles(settings) : PRINT_BASE_STYLES;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${escapeHtml(title)}</title><style>${styles}</style></head>`
    + `<body>${bodyHtml}</body></html>`;
}

const OVERLAY_STYLES = `
.${PRINT_OVERLAY_CLASS}{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;background:#0f172a;direction:rtl}
.${PRINT_OVERLAY_CLASS}__bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;padding-top:max(10px,env(safe-area-inset-top));background:#0f172a;color:#fff;font-family:'Noto Sans Arabic',Arial,sans-serif}
.${PRINT_OVERLAY_CLASS}__title{font-size:14px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${PRINT_OVERLAY_CLASS}__actions{display:flex;gap:8px;flex-shrink:0}
.${PRINT_OVERLAY_CLASS}__button{min-height:44px;padding:0 16px;border-radius:12px;border:0;font-family:inherit;font-size:14px;font-weight:800;cursor:pointer}
.${PRINT_OVERLAY_CLASS}__button--print{background:#fcd34d;color:#0f172a}
.${PRINT_OVERLAY_CLASS}__button--close{background:rgba(255,255,255,.16);color:#fff}
.${PRINT_OVERLAY_CLASS}__frame{flex:1;width:100%;border:0;background:#fff}
@media print{
  /* Only the document prints: the app behind it and the overlay chrome do not. */
  body>*:not(.${PRINT_OVERLAY_CLASS}){display:none !important}
  .${PRINT_OVERLAY_CLASS}{position:static;background:#fff}
  .${PRINT_OVERLAY_CLASS}__bar{display:none !important}
}
`;

let styleElement: HTMLStyleElement | null = null;

function ensureOverlayStyles(): void {
  if (styleElement?.isConnected) return;
  styleElement = document.createElement('style');
  styleElement.dataset.lenaPrintStyles = 'true';
  styleElement.textContent = OVERLAY_STYLES;
  document.head.appendChild(styleElement);
}

/** Removes any overlay left behind, so a second print never stacks two views. */
export function closePrintOverlay(): void {
  document.querySelectorAll(`.${PRINT_OVERLAY_CLASS}`).forEach((element) => element.remove());
  document.body.style.removeProperty('overflow');
}

/**
 * Renders a composed document in a dismissible in-app overlay and prints it.
 *
 * The operator can always leave: the close button, the Escape key, and the
 * browser/system back gesture (the overlay listens for `popstate`) all return
 * to the app with the application state untouched.
 */
export function printDocument(title: string, bodyHtml: string, settings: PrintSettings = DEFAULT_PRINT_SETTINGS): void {
  try {
    if (typeof document === 'undefined') {
      throw new PrintDocumentError('الطباعة غير متاحة في هذه البيئة.');
    }

    closePrintOverlay();
    ensureOverlayStyles();

    const overlay = document.createElement('div');
    overlay.className = PRINT_OVERLAY_CLASS;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);

    const bar = document.createElement('div');
    bar.className = `${PRINT_OVERLAY_CLASS}__bar`;

    const heading = document.createElement('span');
    heading.className = `${PRINT_OVERLAY_CLASS}__title`;
    heading.textContent = title;

    const actions = document.createElement('div');
    actions.className = `${PRINT_OVERLAY_CLASS}__actions`;

    const printButton = document.createElement('button');
    printButton.type = 'button';
    printButton.className = `${PRINT_OVERLAY_CLASS}__button ${PRINT_OVERLAY_CLASS}__button--print`;
    printButton.textContent = 'طباعة';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = `${PRINT_OVERLAY_CLASS}__button ${PRINT_OVERLAY_CLASS}__button--close`;
    closeButton.textContent = 'إغلاق';

    const frame = document.createElement('iframe');
    frame.className = `${PRINT_OVERLAY_CLASS}__frame`;
    frame.title = title;

    actions.append(printButton, closeButton);
    bar.append(heading, actions);
    overlay.append(bar, frame);
    document.body.appendChild(overlay);
    // The page behind must not scroll while the document is open.
    document.body.style.overflow = 'hidden';

    const markup = buildPrintDocumentMarkup(title, bodyHtml, settings);
    const frameDocument = frame.contentDocument ?? frame.contentWindow?.document ?? null;
    if (!frameDocument) {
      closePrintOverlay();
      throw new PrintDocumentError('تعذر تجهيز المستند للطباعة. حاولي مرة أخرى.');
    }
    frameDocument.open();
    frameDocument.write(markup);
    frameDocument.close();

    const dismiss = () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', dismiss);
      closePrintOverlay();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    // A hardware/system back gesture closes the document instead of leaving the app.
    window.addEventListener('popstate', dismiss);

    closeButton.addEventListener('click', dismiss);
    closeButton.focus();

    const sendToPrinter = () => {
      const frameWindow = frame.contentWindow;
      if (!frameWindow) return;
      frameWindow.focus();
      frameWindow.print();
    };
    printButton.addEventListener('click', sendToPrinter);

    // Offer the print dialog immediately; if the platform blocks an automatic
    // call the operator still has the explicit button.
    sendToPrinter();
  } catch (error) {
    if (error instanceof PrintDocumentError) throw error;
    throw new PrintDocumentError('تعذر تجهيز المستند للطباعة. حاولي مرة أخرى.', error);
  }
}
