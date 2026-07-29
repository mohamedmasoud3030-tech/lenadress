/**
 * File download.
 *
 * The blob/anchor/revoke dance was copy-pasted into every screen that offers an
 * export, and the copies had already drifted: one revoked the object URL, one
 * leaked it, and none of them appended the anchor to the document — which
 * silently does nothing in some WebViews, including the one behind an installed
 * PWA on older Android. The operator would tap "export" and get no file and no
 * error.
 *
 * This lives in `src/platform/` because it touches `document`, `Blob` and
 * `URL.createObjectURL`, which the feature layer is not allowed to reach.
 */

/** Anything Excel might open needs the UTF-8 BOM already baked into `content`. */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    // Appending is not optional: a detached anchor's synthetic click is ignored
    // by several WebViews, which is how an export can appear to do nothing.
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    // Revoked in a finally so a throwing click cannot leak the blob for the
    // lifetime of the tab.
    URL.revokeObjectURL(url);
  }
}

export function downloadCsv(filename: string, csv: string): void {
  downloadTextFile(filename, csv, 'text/csv;charset=utf-8');
}

export function downloadJson(filename: string, value: unknown): void {
  downloadTextFile(filename, JSON.stringify(value, null, 2), 'application/json;charset=utf-8');
}
