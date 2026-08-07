import type { LandingProfile } from './types';

export function LandingSteps({ profile }: { profile: LandingProfile }) {
  return <section className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-bold text-amber-700">كيف نحجز؟</p><h2 className="mt-2 text-2xl font-black text-slate-950">خطوات بسيطة قبل الزيارة</h2><div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{profile.steps.map((step, index) => <div key={step.title} className="rounded-2xl bg-stone-50 p-5"><p className="text-sm font-black text-amber-700">0{index + 1}</p><h3 className="mt-2 text-lg font-black text-slate-950">{step.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p></div>)}</div></section>;
}
