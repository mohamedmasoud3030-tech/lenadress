/**
 * CSV export helpers.
 *
 * Two properties matter for a showroom that opens these files in Excel:
 *
 * 1. **Arabic must survive.** The file is prefixed with a UTF-8 BOM, otherwise
 *    Excel guesses a legacy codepage and the whole report renders as mojibake.
 * 2. **A cell must never execute.** A value starting with `=`, `+`, `-`, `@`,
 *    tab or carriage return is a formula to a spreadsheet. Those values are
 *    prefixed with an apostrophe so they are always read as text, which is the
 *    standard CSV-injection defence.
 */

export const UTF8_BOM = '\uFEFF';

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';

  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : String(value);
  // Neutralise a leading formula trigger before any quoting decision.
  const guarded = FORMULA_TRIGGERS.some((trigger) => raw.startsWith(trigger)) ? `'${raw}` : raw;

  // Tabs are quoted too: an unquoted tab lets some importers split a cell.
  return /[",\n\r\t]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(escapeCsvValue).join(','), ...rows.map((row) => row.map(escapeCsvValue).join(','))];
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

/** Filename-safe slug that keeps Arabic readable and drops path separators. */
export function toCsvFileName(base: string, isoDate: string): string {
  const safeBase = base.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return `${safeBase}-${isoDate}.csv`;
}
