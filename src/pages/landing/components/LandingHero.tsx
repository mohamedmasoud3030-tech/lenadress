import { CalendarDays, ChevronLeft, Gem, PackageOpen, Shirt, Sparkles } from 'lucide-react';
import type { LandingProfile } from './types';
import { buildAppointmentInquiryMessage, buildLandingWhatsAppLink } from '../landingWhatsapp';

/**
 * The shop window.
 *
 * Deliberately NOT a dark SaaS hero and NOT a fake stock image: a bridal
 * showroom reads like a boutique window — warm ivory, honest numbers about what
 * is actually available right now, and the same amber/slate language used
 * across the operator app. Real dress photos live in the "المعروض الآن"
 * section below, straight from the showroom inventory.
 */
export function LandingHero({ profile, total, rentableCount, saleCount }: { profile: LandingProfile; total: number; rentableCount: number; saleCount: number }) {
  const appointmentLink = buildLandingWhatsAppLink(profile, buildAppointmentInquiryMessage());

  const stats = [
    { value: total, label: 'قطعة متاحة الآن' },
    { value: rentableCount, label: 'متاح للإيجار' },
    { value: saleCount, label: 'متاح للبيع' },
  ];

  const services = [
    { icon: Shirt, label: 'إيجار فساتين' },
    { icon: PackageOpen, label: 'بيع فساتين' },
    { icon: Gem, label: 'إكسسوارات وملحقات' },
    { icon: CalendarDays, label: 'مواعيد تجربة' },
  ];

  return (
    <section className="relative overflow-hidden rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 via-stone-50 to-amber-100/70 px-6 py-10 shadow-sm lg:px-10">
      {/* Subtle warm glow — never a busy pattern. */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-amber-100/40 blur-3xl" />

      <div className="relative grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-4 py-1.5 text-xs font-extrabold text-amber-900 shadow-sm">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-amber-600" />
            {profile.shortTagline}
          </p>
          <h2 className="mt-5 max-w-2xl text-3xl font-black leading-snug text-slate-950 sm:text-4xl lg:text-[2.6rem] lg:leading-[1.25]">
            {profile.heroTitle}
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            {profile.heroDescription}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={appointmentLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-slate-950/10 transition duration-200 hover:-translate-y-0.5 hover:bg-slate-800"
            >
              <CalendarDays className="h-4 w-4" />
              اطلبي موعد تجربة
            </a>
            <a
              href="#available-dresses"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-800 transition hover:bg-stone-100"
            >
              <ChevronLeft className="h-4 w-4" />
              شاهدي المعروض الحالي
            </a>
          </div>
        </div>

        <div className="rounded-3xl border border-amber-100 bg-white/80 p-6 shadow-lg shadow-amber-900/5 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" aria-hidden="true" className="h-12 w-12 rounded-2xl bg-amber-300/10 shadow-sm" />
            <div>
              <p className="text-lg font-black text-slate-950">{profile.brandName}</p>
              <p className="text-xs font-bold text-amber-700">حسب ما هو معروض فعلياً في المحل</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-amber-100 bg-white p-4 text-center shadow-sm">
                <p className="text-2xl font-black text-slate-950 sm:text-3xl">{stat.value}</p>
                <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{stat.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            {services.map((service) => (
              <div key={service.label} className="flex items-center gap-2.5 rounded-xl bg-stone-50 p-3">
                <span className="rounded-lg bg-amber-50 p-2 text-amber-700">
                  <service.icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold text-slate-700">{service.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
