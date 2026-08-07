import { NavLink } from 'react-router-dom';
import { focusRing, navigationGroups, publicPageLink } from './navigation';
import { useAuth } from '../../features/auth/AuthContext';

export function DesktopNavigation() {
  const { profile } = useAuth();

  return (
    <aside className="fixed inset-y-0 right-0 hidden w-72 overflow-y-auto border-l border-slate-800 bg-slate-950 px-4 py-5 text-stone-100 shadow-2xl lg:block">
      <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4 shadow-inner">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="h-12 w-12 rounded-2xl bg-amber-300/10 shadow-lg" />
          <div>
            <p className="text-2xl font-extrabold tracking-[0.22em] text-amber-300">LENA</p>
          </div>
        </div>
        <h1 className="mt-5 text-2xl font-extrabold">إدارة المعرض</h1>
      </div>

      <nav aria-label="التنقل الرئيسي" className="space-y-6">
        {navigationGroups.map((group) => {
          const visibleItems = group.items.filter((item) => !item.adminOnly || profile?.role === 'admin');
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label}>
              <p className="mb-2 px-3 text-[11px] font-extrabold tracking-wider text-slate-500">{group.label}</p>
              <div className="space-y-1">
                {visibleItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `flex min-h-11 items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition duration-200 ${focusRing} ${
                        isActive
                          ? 'bg-amber-300 text-slate-950 shadow-lg shadow-amber-300/10'
                          : 'text-slate-300 hover:bg-white/10 hover:text-stone-50'
                      }`
                    }
                  >
                    <item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <NavLink
        to={publicPageLink.to}
        className={`mt-8 flex items-center gap-3 rounded-xl border border-white/10 px-4 py-3 text-xs font-bold text-slate-400 transition hover:bg-white/5 hover:text-stone-50 ${focusRing}`}
      >
        <publicPageLink.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span>{publicPageLink.label}</span>
      </NavLink>
    </aside>
  );
}
