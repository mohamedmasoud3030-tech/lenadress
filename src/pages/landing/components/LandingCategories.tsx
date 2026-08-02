import type { LandingProfile } from './types';

export function LandingCategories({ profile }: { profile: LandingProfile }) {
  return (
    <section id="categories" className="mt-12 space-y-5">
      <div>
        <p className="text-sm font-bold text-violet-700">تشكيلتنا</p>
        <h2 className="mt-1 text-2xl font-black text-slate-950">اختاري حسب المناسبة</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">تصفحي فساتين المناسبات وما يكملها من إكسسوارات وحقائب وأحذية وطرح.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {profile.categories.map((category) => (
          <div key={category.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-black text-slate-950">{category.name}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{category.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
