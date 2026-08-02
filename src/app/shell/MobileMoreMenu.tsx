import { NavLink } from 'react-router-dom';
import { focusRing, navigation } from './navigation';
import { useAuth } from '../../features/auth/AuthContext';

type MobileMoreMenuProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileMoreMenu({ open, onClose }: MobileMoreMenuProps) {
  const { profile } = useAuth();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="إغلاق القائمة"
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <nav
        aria-label="القائمة الكاملة"
        className="absolute inset-x-4 bottom-20 max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
      >
        <div className="grid grid-cols-3 gap-3">
          {navigation.filter((item) => !item.adminOnly || profile?.role === 'admin').map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                `flex flex-col items-center gap-2 rounded-xl p-3 text-xs font-bold transition ${focusRing} ${
                  isActive ? 'bg-amber-100 text-amber-900' : 'text-slate-600 hover:bg-stone-100'
                }`
              }
            >
              <item.icon aria-hidden="true" className="h-6 w-6" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
