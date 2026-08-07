import { CalendarCheck, ShoppingBag, Sparkles } from 'lucide-react';

const items = [
  { title: 'اختيار أسهل قبل الزيارة', description: 'شاهدي الألوان والمقاسات والأسعار وحددي القطع التي ترغبين في تجربتها.', icon: Sparkles, iconClass: 'bg-amber-50 text-amber-700' },
  { title: 'كل ما يكمل الإطلالة', description: 'فساتين وإكسسوارات وحقائب وملحقات في مكان واحد.', icon: ShoppingBag, iconClass: 'bg-stone-100 text-slate-700' },
  { title: 'طلب موعد مباشر', description: 'أرسلي طلبك عبر واتساب وسيؤكد لكِ المعرض الموعد والتوفر.', icon: CalendarCheck, iconClass: 'bg-amber-50 text-amber-700' },
];

export function LandingValueProps() {
  return (
    <section className="mt-10 grid gap-4 md:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`rounded-xl p-3 ${item.iconClass}`}><Icon className="h-5 w-5" /></div>
              <div><h3 className="font-bold text-slate-900">{item.title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p></div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
