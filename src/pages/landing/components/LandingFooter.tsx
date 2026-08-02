import type { LandingProfile } from './types';

export function LandingFooter({ profile }: { profile: LandingProfile }) {
  return <footer className="border-t border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-slate-600 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8"><div><p className="font-bold text-slate-900">{profile.brandName}</p><p className="mt-1">فساتين وملحقات مختارة لمناسباتك.</p></div><div className="flex flex-wrap gap-3"><a href="#about" className="transition hover:text-slate-950">من نحن</a><a href="#services" className="transition hover:text-slate-950">الخدمات</a><a href="#faq" className="transition hover:text-slate-950">الأسئلة الشائعة</a><a href="#contact" className="transition hover:text-slate-950">تواصل</a></div></div></footer>;
}
