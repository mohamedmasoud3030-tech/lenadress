export type BarcodeIdentity = {
  code: string;
  barcode?: string;
};

/**
 * Normalises scanner and stored values without changing the human item code.
 * The same rule is used for generation and lookup so spaces/case cannot make a
 * valid label appear missing.
 */
export function normalizeDressBarcodeValue(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Persisted barcodes are derived from the monotonic, never-reused item code.
 * This makes label regeneration stable across reload, backup and restore.
 */
export function generateDressBarcodeValue(code: string): string {
  const normalizedCode = normalizeDressBarcodeValue(code);
  if (!normalizedCode) throw new Error('كود العنصر مطلوب لتوليد الباركود.');
  return normalizedCode;
}

export function dressMatchesBarcode(dress: BarcodeIdentity, scannedValue: string): boolean {
  const normalizedScan = normalizeDressBarcodeValue(scannedValue);
  if (!normalizedScan) return false;

  return [dress.barcode, dress.code]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizeDressBarcodeValue(value) === normalizedScan);
}

export function getBarcodeRuntimeSupportStatus(): { supported: boolean; message: string } {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      message: 'لا يمكن التحقق من دعم الكاميرا في بيئة غير متصفح.',
    };
  }

  if (!window.isSecureContext) {
    return {
      supported: false,
      message: 'تشغيل الكاميرا يتطلب صفحة آمنة HTTPS أو localhost.',
    };
  }

  if (!('mediaDevices' in navigator) || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    return {
      supported: false,
      message: 'هذا المتصفح أو الجهاز لا يدعم الوصول للكاميرا المطلوبة للباركود.',
    };
  }

  return {
    supported: true,
    message: 'دعم الكاميرا متاح مبدئيًا، لكن ما زال يلزم اختبار فعلي على جهاز حقيقي.',
  };
}

export function getBarcodeEngineEnvironmentNote(): string {
  return 'المسح يدعم CODE 128 وEAN-13 وEAN-8 مع إدخال يدوي عند رفض الإذن أو غياب الكاميرا.';
}
