import type { LandingProfile } from './types';

export function LandingFaq({ profile }: { profile: LandingProfile }) {
  return <section id="faq" className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm font-bold text-amber-700">الأسئلة الشائعة</p><h2 className="mt-2 text-2xl font-black text-slate-950">معلومات مهمة قبل التواصل أو الحجز</h2><div className="mt-6 space-y-4">{profile.faq.map((item) => <div key={item.question} className="rounded-2xl border border-slate-100 bg-stone-50 p-5"><h3 className="text-base font-black text-slate-950">{item.question}</h3><p className="mt-2 text-sm leading-7 text-slate-600">{item.answer}</p></div>)}</div></section>;
}
