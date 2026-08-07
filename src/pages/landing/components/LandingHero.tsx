import { CalendarDays, ChevronLeft, Sparkles } from 'lucide-react';
import type { LandingProfile } from './types';
import { buildAppointmentInquiryMessage, buildLandingWhatsAppLink } from '../landingWhatsapp';

/**
 * The shop window.
 *
 * Deliberately NOT a dark gradient SaaS hero: this is a bridal showroom, so the
 * hero reads like a boutique window — warm ivory, one elegant editorial image,
 * and the same amber/slate language used across the operator app.
 */
export function LandingHero({ profile, total, rentableCount, saleCount }: { profile: LandingProfile; total: number; rentableCount: number; saleCount: number }) {
  const appointmentLink = buildLandingWhatsAppLink(profile, buildAppointmentInquiryMessage());

  return (
    <section className="relative overflow-hidden rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 via-stone-50 to-amber-100/70 px-6 py-10 shadow-sm lg:grid lg:grid-cols-[1.15fr_0.85fr] lg:gap-10 lg:px-10">
      {/* Subtle warm glow behind the text — never a busy pattern. */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl" />

      <div className="relative">
        <p className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-4 py-1.5 text-xs font-extrabold text-amber-900 shadow-sm">
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-amber-600" />
          {profile.shortTagline}
        </p>
        <h2 className="mt-5 max-w-xl text-3xl font-black leading-snug text-slate-950 sm:text-4xl lg:text-[2.6rem] lg:leading-[1.25]">
          {profile.heroTitle}
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
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

        <div className="mt-8 grid max-w-xl grid-cols-3 gap-3">
          <div className="rounded-2xl border border-amber-100 bg-white/90 p-4 text-center shadow-sm">
            <p className="text-2xl font-black text-slate-950 sm:text-3xl">{total}</p>
            <p className="mt-1 text-xs font-bold text-slate-500">إجمالي المتاح الآن</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-white/90 p-4 text-center shadow-sm">
            <p className="text-2xl font-black text-slate-950 sm:text-3xl">{rentableCount}</p>
            <p className="mt-1 text-xs font-bold text-slate-500">متاح للإيجار</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-white/90 p-4 text-center shadow-sm">
            <p className="text-2xl font-black text-slate-950 sm:text-3xl">{saleCount}</p>
            <p className="mt-1 text-xs font-bold text-slate-500">متاح للبيع</p>
          </div>
        </div>
      </div>

      <div className="relative mt-8 lg:mt-0">
        <div className="overflow-hidden rounded-3xl border border-white/60 bg-stone-100 shadow-lg shadow-amber-900/5">
          <img
            src="/images/hero-dress.jpg"
            alt="فستان من تشكيلة المعرض"
            className="h-72 w-full object-cover object-top sm:h-96 lg:h-full lg:max-h-[26rem]"
            loading="eager"
            fetchPriority="high"
          />
        </div>
        <p className="mt-3 text-center text-xs font-bold text-slate-400">من تشكيلة المعرض الحالية — تتحدث حسب المتاح</p>
      </div>
    </section>
  );
}
