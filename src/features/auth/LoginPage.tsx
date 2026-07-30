import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { TextField } from '../../components/shared/FormField';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { useAuth } from './AuthContext';
import { getSafeReturnPath } from './auth.model';

/**
 * The real front door.
 *
 * Everything behind `AppShell` is now gated on a signed-in Supabase session
 * (see `RequireAuth`); this is the only screen reachable without one.
 */
export function LoginPage() {
  const { status, message, signIn, signOut, retry } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (status === 'signed-in') {
    const redirectTo = getSafeReturnPath((location.state as { from?: string } | null)?.from);
    return <Navigate to={redirectTo} replace />;
  }

  const accountNotice =
    status === 'disabled'
      ? 'هذا الحساب موقوف. تواصلي مع مديرة المعرض لتفعيله.'
      : status === 'profile-missing'
        ? 'الحساب موجود لكن ملف الصلاحيات غير مكتمل. أعيدي المحاولة بعد لحظات.'
        : status === 'auth-error'
          ? (message ?? 'تعذر التحقق من الحساب الآن.')
          : null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (reason) {
      setError(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-50 px-4 py-12" dir="rtl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-l from-amber-200/50 via-transparent to-violet-200/40" />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
            <Lock aria-hidden="true" className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-black text-slate-950">LENA</h1>
          <p className="mt-1 text-sm text-slate-600">تسجيل الدخول لإدارة المعرض</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        >
          {error !== null && (
            <UserFacingErrorAlert error={error} fallback="تعذر تسجيل الدخول." className="mb-4" />
          )}
          {accountNotice && (
            <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
              {accountNotice}
              <div className="mt-3 flex flex-wrap gap-2">
                {status !== 'disabled' && (
                  <button type="button" onClick={() => void retry()} className="min-h-11 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold">
                    إعادة المحاولة
                  </button>
                )}
                {(status === 'disabled' || status === 'profile-missing') && (
                  <button type="button" onClick={() => void signOut()} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                    استخدام حساب آخر
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <TextField
              label="البريد الإلكتروني"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={submitting || status === 'loading'}
            />
            <TextField
              label="كلمة المرور"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={submitting || status === 'loading'}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || status === 'loading'}
            className="mt-6 min-h-11 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting || status === 'loading' ? 'جارٍ التحقق...' : 'دخول'}
          </button>
        </form>
      </div>
    </div>
  );
}
