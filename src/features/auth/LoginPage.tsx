import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { TextField } from '../../components/shared/FormField';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { useAuth } from './AuthContext';

/**
 * The real front door.
 *
 * Everything behind `AppShell` is now gated on a signed-in Supabase session
 * (see `RequireAuth`); this is the only screen reachable without one.
 */
export function LoginPage() {
  const { status, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (status === 'signed-in') {
    const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={redirectTo} replace />;
  }

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

          <div className="space-y-4">
            <TextField
              label="البريد الإلكتروني"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={submitting}
            />
            <TextField
              label="كلمة المرور"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={submitting}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 min-h-11 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'جارٍ الدخول...' : 'دخول'}
          </button>
        </form>
      </div>
    </div>
  );
}
