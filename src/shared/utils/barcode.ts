/**
 * One barcode normalisation rule for the whole application.
 *
 * Inventory items and accessories are scanned with the same hardware and the
 * same manual fallback, so generation and lookup must agree on exactly one
 * normalisation. Keeping it here prevents a second, slightly different rule
 * from appearing next to a new entity.
 */

export type BarcodeIdentity = {
  code: string;
  barcode?: string;
};

export function normalizeBarcodeValue(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

/** Barcodes are derived from the never-reused entity code, so labels stay stable. */
export function deriveBarcodeFromCode(code: string): string {
  const normalizedCode = normalizeBarcodeValue(code);
  if (!normalizedCode) throw new Error('كود العنصر مطلوب لتوليد الباركود.');
  return normalizedCode;
}

export function identityMatchesBarcode(identity: BarcodeIdentity, scannedValue: string): boolean {
  const normalizedScan = normalizeBarcodeValue(scannedValue);
  if (!normalizedScan) return false;

  return [identity.barcode, identity.code]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizeBarcodeValue(value) === normalizedScan);
}
