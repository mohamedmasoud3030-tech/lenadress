import { useState } from 'react';
import { CalendarDays, Menu, X } from 'lucide-react';
import type { LandingProfile } from './types';
import { buildAppointmentInquiryMessage, buildLandingWhatsAppLink } from '../landingWhatsapp';

export function LandingHeader({ profile }: { profile: LandingProfile }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = [
    { href: '#available-dresses', label: 'المعروض' },
    { href: '#categories', label: 'الفئات' },
    { href: '#about', label: 'من نحن' },
    { href: '#services', label: 'الخدمات' },
    { href: '#faq', label: 'الأسئلة الشائعة' },
    { href: '#contact', label: 'تواصل معنا' },
  ];

  const appointmentLink = buildLandingWhatsAppLink(profile, buildAppointmentInquiryMessage());

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="h-11 w-11 shrink-0 rounded-xl bg-amber-300/10 shadow-sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-amber-700">{profile.shortTagline}</p>
            <h1 className="mt-0.5 truncate text-xl font-black text-slate-950 sm:text-2xl">{profile.brandName}</h1>
          </div>
        </div>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 text-sm font-bold text-slate-700 lg:flex" aria-label="تنقل صفحة العرض">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="rounded-full px-3 py-2 transition hover:bg-stone-100">{link.label}</a>
          ))}
          <a
            href={appointmentLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mr-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            <CalendarDays aria-hidden="true" className="h-4 w-4" />
            اطلبي موعد
          </a>
        </nav>

        {/* Mobile: compact appointment button + menu button */}
        <div className="flex items-center gap-2 lg:hidden">
          <a
            href={appointmentLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="اطلبي موعد تجربة"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white transition hover:bg-slate-800"
          >
            <CalendarDays aria-hidden="true" className="h-5 w-5" />
          </a>
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-700 transition hover:bg-stone-100"
            aria-label={menuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile nav dropdown */}
      {menuOpen && (
        <nav className="border-t border-slate-100 bg-white px-4 py-3 lg:hidden" aria-label="تنقل صفحة العرض">
          <div className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-stone-100"
              >
                {link.label}
              </a>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
