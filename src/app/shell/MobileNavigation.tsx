import { Menu } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { focusRing, navigation } from './navigation';

type MobileNavigationProps = {
  onOpenMenu: () => void;
};

export function MobileNavigation({ onOpenMenu }: MobileNavigationProps) {
  return (
    <nav
      aria-label="التنقل الرئيسي للموبايل"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
    >
      <div className="grid grid-cols-5 gap-1 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        {navigation.slice(0, 4).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-[11px] font-bold transition duration-200 ${focusRing} ${
                isActive ? 'bg-amber-100 text-amber-900' : 'text-slate-500 hover:bg-stone-100 hover:text-slate-950'
              }`
            }
          >
            <item.icon aria-hidden="true" className="h-5 w-5" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onOpenMenu}
          className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 text-[11px] font-bold text-slate-500 transition hover:bg-stone-100 hover:text-slate-950 ${focusRing}`}
        >
          <Menu aria-hidden="true" className="h-5 w-5" />
          <span>المزيد</span>
        </button>
      </div>
    </nav>
  );
}
