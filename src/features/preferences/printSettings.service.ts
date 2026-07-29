import { readCollection, writeCollection } from '../../services/localDatabase';
import { DEFAULT_PRINT_SETTINGS, normalizePrintSettings, type PrintSettings } from '@platform/printing';

/**
 * The showroom's print presentation, stored once and reused by every document.
 *
 * Paper size, margins and colour are a property of the printer that sits in the
 * shop, not of the individual contract, so asking for them on every print would
 * be pure friction.
 */

const COLLECTION = 'print-settings';

export function getPrintSettings(): PrintSettings {
  return normalizePrintSettings(readCollection<Partial<PrintSettings>>(COLLECTION, [])[0]);
}

export function savePrintSettings(settings: PrintSettings): PrintSettings {
  const normalized = normalizePrintSettings(settings);
  writeCollection(COLLECTION, [normalized]);
  return normalized;
}

export function resetPrintSettings(): PrintSettings {
  writeCollection(COLLECTION, [DEFAULT_PRINT_SETTINGS]);
  return DEFAULT_PRINT_SETTINGS;
}
