import { Link } from 'react-router-dom';
import { Home, ArrowRight } from 'lucide-react';

export function NotFoundPage() {
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="rounded-full bg-stone-100 p-6">
        <span className="text-4xl font-black text-slate-300">404</span>
      </div>
      <h1 className="mt-6 text-2xl font-black text-slate-950">الصفحة غير موجودة</h1>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
        >
          <Home className="h-4 w-4" />
          الصفحة الرئيسية
        </Link>
        <Link
          to="/inventory"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100"
        >
          <ArrowRight className="h-4 w-4" />
          المخزون
        </Link>
      </div>
    </section>
  );
}
