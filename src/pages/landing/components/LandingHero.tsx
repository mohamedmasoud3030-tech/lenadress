import { CalendarDays, ChevronLeft } from 'lucide-react';
import type { LandingProfile } from './types';
import { buildAppointmentInquiryMessage, buildLandingWhatsAppLink } from '../landingWhatsapp';

export function LandingHero({ profile, total, rentableCount, saleCount }: { profile: LandingProfile; total: number; rentableCount: number; saleCount: number }) {
  const appointmentLink = buildLandingWhatsAppLink(profile, buildAppointmentInquiryMessage());

  return (
    <section className="grid gap-6 rounded-3xl bg-gradient-to-l from-slate-950 via-slate-900 to-violet-900 px-6 py-8 text-white shadow-sm lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
      <div>
        <p className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/90 ring-1 ring-white/15">تجربة عرض عميلة قابلة للتخصيص لكل معرض</p>
        <h2 className="mt-4 text-3xl font-black leading-tight sm:text-4xl">{profile.heroTitle}</h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-white/80 sm:text-base">{profile.heroDescription}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={appointmentLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-stone-100">
            <CalendarDays className="h-4 w-4" />
            احجزي موعد تجربة
          </a>
          <a href="#available-dresses" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10">
            <ChevronLeft className="h-4 w-4" />
            شاهدي المعروض الحالي
          </a>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm"><p className="text-sm text-white/70">إجمالي المتاح الآن</p><p className="mt-2 text-3xl font-black">{total}</p></div>
        <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm"><p className="text-sm text-white/70">متاح للإيجار</p><p className="mt-2 text-3xl font-black">{rentableCount}</p></div>
        <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm"><p className="text-sm text-white/70">متاح للبيع</p><p className="mt-2 text-3xl font-black">{saleCount}</p></div>
      </div>
    </section>
  );
}
