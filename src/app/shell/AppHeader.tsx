import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { focusRing } from './navigation';

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/70 bg-white/80 px-4 py-4 shadow-sm backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="h-10 w-10 rounded-xl shadow-sm lg:hidden" />
          <div>
            <p className="text-xs font-extrabold tracking-[0.2em] text-amber-700">LENA</p>
            <h2 className="mt-1 text-lg font-extrabold text-slate-950 sm:text-xl">إدارة المعرض</h2>
          </div>
        </div>
        <Link
          to="/reservations?new=1"
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-950/10 transition duration-200 hover:-translate-y-0.5 hover:bg-slate-800 ${focusRing}`}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          <span>حجز جديد</span>
        </Link>
      </div>
    </header>
  );
}
