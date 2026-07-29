/**
 * WhatsApp hand-off boundary.
 *
 * The showroom talks to its customers on WhatsApp, so the app must be able to
 * open a chat with a prepared Arabic message. It deliberately does **not** send
 * anything by itself:
 *
 * - a real send needs the WhatsApp Business API, a Meta account, a verified
 *   number and per-message billing — none of which a single local-first
 *   showroom has, and none of which can work offline;
 * - silently sending on the customer's behalf is also the wrong default. The
 *   operator should see the text and press send.
 *
 * So this prepares `wa.me` deep links. The operator reviews the message in
 * WhatsApp and sends it. That works on a phone, on desktop, and needs no
 * account, no key and no subscription.
 *
 * Like every other browser API in this codebase, the navigation itself lives in
 * the platform layer, never in a feature.
 */

export class MessagingError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'MessagingError';
  }
}

/**
 * Converts a locally-written phone number into the digits `wa.me` expects.
 *
 * Omani numbers are commonly stored as `9XXXXXXX` with no country code, which
 * `wa.me` would reject or route to the wrong country. A local 8-digit number is
 * therefore given the Oman prefix; anything already international is preserved.
 */
export function toWhatsAppNumber(phone: string, defaultCountryCode = '968'): string {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) throw new MessagingError('رقم الهاتف غير صالح لإرسال رسالة واتساب.');

  // Already carries a country code.
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith(defaultCountryCode) && digits.length > 8) return digits;
  // A bare local number.
  if (digits.length === 8) return `${defaultCountryCode}${digits}`;
  return digits;
}

export function buildWhatsAppLink(phone: string, message: string, defaultCountryCode = '968'): string {
  const number = toWhatsAppNumber(phone, defaultCountryCode);
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/**
 * Opens the prepared chat.
 *
 * `noopener` is required: without it the opened tab can reach back into this
 * one through `window.opener`.
 */
export function openWhatsAppChat(phone: string, message: string, defaultCountryCode = '968'): void {
  if (typeof window === 'undefined') {
    throw new MessagingError('إرسال واتساب غير متاح في هذه البيئة.');
  }

  const link = buildWhatsAppLink(phone, message, defaultCountryCode);
  const opened = window.open(link, '_blank', 'noopener,noreferrer');
  if (!opened) {
    throw new MessagingError('تعذر فتح واتساب. اسمحي بالنوافذ المنبثقة لهذا التطبيق ثم أعيدي المحاولة.');
  }
}

/** Copies the message so the operator can paste it anywhere else. */
export async function copyMessageToClipboard(message: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new MessagingError('النسخ غير مدعوم في هذا المتصفح. انسخي النص يدوياً.');
  }
  try {
    await navigator.clipboard.writeText(message);
  } catch (error) {
    throw new MessagingError('تعذر نسخ الرسالة. انسخيها يدوياً.', error);
  }
}
