/**
 * The single popup/print boundary for the whole application.
 *
 * Printing was previously done inline with `window.open` inside a feature file,
 * which made popup-blocked recovery inconsistent and hid a browser API behind
 * business code. Every printable document now goes through here, so the blocked
 * popup message and the failure semantics are identical everywhere.
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

/**
 * Opens a print window for an already-composed document body.
 * Throws a user-facing Arabic error when the popup is blocked.
 */
export function printDocument(title: string, bodyHtml: string): void {
  try {
    const popup = window.open('', '_blank', 'width=880,height=760');
    if (!popup) {
      throw new PrintDocumentError('تعذر فتح نافذة الطباعة. اسمحي بالنوافذ المنبثقة لهذا التطبيق ثم أعيدي المحاولة.');
    }

    popup.document.write(
      `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">`
      + `<title>${escapeHtml(title)}</title><style>${PRINT_BASE_STYLES}</style></head>`
      + `<body>${bodyHtml}</body></html>`,
    );
    popup.document.close();
    popup.focus();
    popup.print();
  } catch (error) {
    if (error instanceof PrintDocumentError) throw error;
    throw new PrintDocumentError('تعذر تجهيز المستند للطباعة. حاولي مرة أخرى.', error);
  }
}
