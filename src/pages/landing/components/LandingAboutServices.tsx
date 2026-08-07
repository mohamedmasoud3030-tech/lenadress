import type { LandingProfile } from './types';

export function LandingAboutServices({ profile }: { profile: LandingProfile }) {
  return <section className="mt-12 grid gap-6 lg:grid-cols-[1fr_1fr]"><div id="about" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-bold text-amber-700">{profile.aboutTitle}</p><h2 className="mt-2 text-2xl font-black text-slate-950">إطلالة تناسب مناسبتك</h2><p className="mt-4 text-sm leading-7 text-slate-600">{profile.aboutDescription}</p></div><div id="services" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-bold text-amber-700">خدماتنا</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{profile.services.map((service) => <div key={service.title} className="rounded-xl bg-stone-50 p-4"><h3 className="font-bold text-slate-900">{service.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{service.description}</p></div>)}</div></div></section>;
}
