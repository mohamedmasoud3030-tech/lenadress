import {
  deriveBarcodeFromCode,
  identityMatchesBarcode,
  normalizeBarcodeValue,
  type BarcodeIdentity,
} from '../../shared/utils/barcode';

export type { BarcodeIdentity };

/**
 * Inventory barcodes reuse the one shared normalisation rule in
 * `@shared/utils/barcode`, so dresses and accessories can never drift into two
 * different definitions of "the same scanned code".
 */
export const normalizeDressBarcodeValue = normalizeBarcodeValue;

/**
 * Persisted barcodes are derived from the monotonic, never-reused item code.
 * The optional argument keeps the old add-form call source-compatible; the
 * inventory service owns the final allocation and always passes the real code.
 */
export function generateDressBarcodeValue(code?: string): string {
  if (code === undefined) return '';
  return deriveBarcodeFromCode(code);
}

export function dressMatchesBarcode(dress: BarcodeIdentity, scannedValue: string): boolean {
  return identityMatchesBarcode(dress, scannedValue);
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
    message: 'الكاميرا جاهزة للمسح. يتوفر الإدخال اليدوي إذا تعذر فتحها.',
  };
}

export function getBarcodeEngineEnvironmentNote(): string {
  return 'المسح يدعم CODE 128 وEAN-13 وEAN-8 مع إدخال يدوي عند رفض الإذن أو غياب الكاميرا.';
}
