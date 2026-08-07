import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import type { LandingProfile } from './types';

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

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div>
          <p className="text-sm font-bold text-amber-700">{profile.shortTagline}</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">{profile.brandName}</h1>
        </div>

        {/* Desktop nav */}
        <nav className="hidden gap-2 text-sm font-bold text-slate-700 lg:flex" aria-label="تنقل صفحة العرض">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="rounded-full px-3 py-2 transition hover:bg-stone-100">{link.label}</a>
          ))}
        </nav>

        {/* Mobile menu button */}
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-700 transition hover:bg-stone-100 lg:hidden"
          aria-label={menuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
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
