import { buildWhatsAppLink } from '../../platform/messaging/whatsapp';
import type { LandingProfile } from './components/types';

type LandingBookingItem = {
  code: string;
  name: string;
  size?: string;
  color?: string;
};

/**
 * Every "book an appointment" / "quick inquiry" action on the public landing
 * page used to link to `/appointments`, a route gated behind staff login
 * (`RequireAuth`). A visiting customer has no account, so every one of those
 * buttons silently redirected her to `/login` — the page's entire call to
 * action was broken.
 *
 * The landing page is a public storefront, not a back-office screen. There is
 * no customer-facing booking backend to build here without a much larger
 * project, so the correct fix is the same hand-off the rest of the app
 * already uses for customer contact: a prepared WhatsApp message the
 * showroom owner receives and replies to directly.
 */
export function buildLandingWhatsAppLink(profile: LandingProfile, message: string): string {
  return buildWhatsAppLink(profile.contact.whatsapp, message);
}

export function buildAppointmentInquiryMessage(item?: LandingBookingItem): string {
  if (item) {
    const details = [
      `الكود: ${item.code}`,
      item.size ? `المقاس: ${item.size}` : null,
      item.color ? `اللون: ${item.color}` : null,
    ].filter(Boolean).join('، ');
    return `مرحباً، أرغب في طلب موعد لتجربة "${item.name}" (${details}). أرجو تأكيد الموعد وتوفر القطعة لتاريخ المناسبة.`;
  }
  return 'مرحباً، أرغب في طلب موعد لزيارة المعرض وتجربة إحدى القطع المعروضة. أرجو تأكيد الوقت المناسب.';
}

export function buildQuickInquiryMessage(item?: LandingBookingItem): string {
  if (item) {
    return `مرحباً، عندي استفسار عن "${item.name}" (الكود: ${item.code}) المعروض لديكم.`;
  }
  return 'مرحباً، عندي استفسار عن المعروض الحالي في المعرض.';
}
