import { Mail, MapPin, Phone } from 'lucide-react';
import { buildAppointmentInquiryMessage, buildLandingWhatsAppLink } from '../landingWhatsapp';
import type { LandingProfile } from './types';

export function LandingContact({ profile }: { profile: LandingProfile }) {
  const appointmentLink = buildLandingWhatsAppLink(profile, buildAppointmentInquiryMessage());
  const primaryPhoneHref = `tel:${profile.contact.phone.replace(/\s+/g, '')}`;
  const primaryEmailHref = `mailto:${profile.contact.email}`;

  return (
    <section id="contact" className="mt-12 grid gap-6 lg:grid-cols-[1fr_0.8fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold text-violet-700">تواصل معنا</p>
        <h2 className="mt-2 text-2xl font-black text-slate-950">بيانات المعرض قابلة للتبديل لكل عميل</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">تم نقل المعلومات التعريفية والتسويقية إلى ملف محتوى منفصل، حتى يمكن تغيير الاسم والوصف والتواصل والفئات لكل عميل يشتري التطبيق بدون إعادة كتابة الصفحة بالكامل.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-stone-50 p-4">
            <p className="text-xs font-semibold text-slate-400">الهاتف</p>
            <a href={primaryPhoneHref} className="mt-2 block font-bold text-slate-900 underline-offset-2 hover:underline" dir="ltr">{profile.contact.phone}</a>
            {profile.contact.alternatePhones?.map((phone) => (
              <a key={phone} href={`tel:${phone.replace(/\s+/g, '')}`} className="mt-1 block text-sm text-slate-600 underline-offset-2 hover:underline" dir="ltr">{phone}</a>
            ))}
          </div>
          <div className="rounded-xl bg-stone-50 p-4">
            <p className="text-xs font-semibold text-slate-400">واتساب</p>
            <a href={appointmentLink} target="_blank" rel="noopener noreferrer" className="mt-2 block font-bold text-slate-900 underline-offset-2 hover:underline" dir="ltr">{profile.contact.whatsapp}</a>
          </div>
          <div className="rounded-xl bg-stone-50 p-4">
            <p className="text-xs font-semibold text-slate-400">البريد الإلكتروني</p>
            <a href={primaryEmailHref} className="mt-2 block break-all font-bold text-slate-900 underline-offset-2 hover:underline" dir="ltr">{profile.contact.email}</a>
            {profile.contact.alternateEmail && (
              <a href={`mailto:${profile.contact.alternateEmail}`} className="mt-1 block break-all text-sm text-slate-600 underline-offset-2 hover:underline" dir="ltr">{profile.contact.alternateEmail}</a>
            )}
          </div>
          <div className="rounded-xl bg-stone-50 p-4">
            <p className="text-xs font-semibold text-slate-400">إنستجرام</p>
            <p className="mt-2 font-bold text-slate-900">{profile.contact.instagram}</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-4 sm:col-span-2">
            <p className="text-xs font-semibold text-slate-400">ساعات العمل</p>
            <p className="mt-2 font-bold text-slate-900">{profile.contact.workingHours}</p>
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-violet-50 p-3 text-violet-700"><MapPin className="h-5 w-5" /></div>
          <div>
            <h3 className="text-lg font-black text-slate-950">العنوان</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">{profile.contact.address}</p>
          </div>
        </div>
        <div className="mt-6 flex items-start gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Phone className="h-5 w-5" /></div>
          <div>
            <h3 className="text-lg font-black text-slate-950">الحجز والاستفسار</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">تواصلي معنا مباشرة عبر واتساب لحجز موعد أو الاستفسار عن أي قطعة معروضة.</p>
            <a href={appointmentLink} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800">حجز موعد عبر واتساب</a>
          </div>
        </div>
        <div className="mt-6 flex items-start gap-3">
          <div className="rounded-xl bg-amber-50 p-3 text-amber-700"><Mail className="h-5 w-5" /></div>
          <div>
            <h3 className="text-lg font-black text-slate-950">البريد الإلكتروني</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">للاستفسارات الرسمية أو التعاون التجاري.</p>
            <a href={primaryEmailHref} className="mt-2 inline-block break-all text-sm font-bold text-slate-900 underline-offset-2 hover:underline" dir="ltr">{profile.contact.email}</a>
          </div>
        </div>
      </div>
    </section>
  );
}
