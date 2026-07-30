import { useState } from 'react';
import { LogOut, ShieldCheck } from 'lucide-react';
import { Section } from '../../components/shared/Section';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { useAuth } from '../auth/AuthContext';

const ROLE_LABELS: Record<'admin' | 'staff', string> = {
  admin: 'مديرة',
  staff: 'موظفة',
};

/** The real, server-checked account — separate from the per-device operator name below. */
export function AccountSettings() {
  const { session, profile, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const handleSignOut = async () => {
    setError(null);
    setSigningOut(true);
    try {
      await signOut();
    } catch (reason) {
      setError(reason);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Section title="الحساب" description="حساب الدخول المرتبط بهذا المتصفح، ويحدد صلاحية الوصول إلى بيانات المعرض.">
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تسجيل الخروج." className="mb-3" />}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-50 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <ShieldCheck aria-hidden="true" className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-950">
              {profile?.fullName ?? session?.user.email ?? '—'}
            </p>
            <p className="truncate text-xs text-slate-500" dir="ltr">
              {session?.user.email}
              {profile && ` · ${ROLE_LABELS[profile.role]}`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-rose-300 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
          {signingOut ? 'جارٍ الخروج...' : 'تسجيل الخروج'}
        </button>
      </div>
    </Section>
  );
}
