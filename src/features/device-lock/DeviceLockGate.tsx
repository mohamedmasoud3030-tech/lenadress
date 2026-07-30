import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { configureDevicePin, hasDevicePin, verifyDevicePin } from '@platform/security';
import { useAuth } from '../auth/AuthContext';

type LockMode = 'checking' | 'setup' | 'locked' | 'unlocked';

const pinInputClassName = 'mt-3 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-center text-2xl font-bold tracking-[0.45em] text-slate-950 outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30';

function PinInput({ value, onChange, label, autoFocus = false }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block text-sm font-bold text-slate-800">
      {label}
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        className={pinInputClassName}
        aria-describedby="device-pin-help"
      />
    </label>
  );
}

/**
 * A successful Supabase sign-in identifies the account. This second gate keeps
 * an already-signed-in phone or desktop from exposing showroom data to whoever
 * happens to hold the device.
 */
export function DeviceLockGate({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const [mode, setMode] = useState<LockMode>('checking');
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setMode(hasDevicePin() ? 'locked' : 'setup');
  }, []);

  const isSetup = mode === 'setup';
  const title = useMemo(
    () => (isSetup ? 'تأمين هذا الجهاز' : 'التطبيق مقفل'),
    [isSetup],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setMessage(null);
    setIsSubmitting(true);

    try {
      if (isSetup) {
        if (pin !== confirmation) throw new Error('رقما القفل غير متطابقين.');
        await configureDevicePin(pin);
        setMode('unlocked');
        return;
      }

      if (!(await verifyDevicePin(pin))) {
        throw new Error('رقم القفل غير صحيح. حاولي مجدداً.');
      }
      setMode('unlocked');
    } catch (reason) {
      setPin('');
      setConfirmation('');
      setMessage(reason instanceof Error ? reason.message : 'تعذر التحقق من رقم القفل.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (mode === 'unlocked') return <>{children}</>;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-8" dir="rtl">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8" aria-labelledby="device-lock-title">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
          {isSetup ? <ShieldCheck aria-hidden="true" className="h-6 w-6" /> : <KeyRound aria-hidden="true" className="h-6 w-6" />}
        </div>
        <h1 id="device-lock-title" className="mt-5 text-2xl font-black text-slate-950">{title}</h1>
        <p id="device-pin-help" className="mt-2 text-sm leading-6 text-slate-600">
          {isSetup
            ? 'اختاري رقمًا من 6 أرقام. سيُطلب عند فتح التطبيق على هذا الجهاز، ولن يُحفظ الرقم نفسه.'
            : 'أدخلي رقم قفل الجهاز للوصول إلى بيانات المعرض.'}
        </p>

        {mode === 'checking' ? (
          <p role="status" className="mt-6 text-sm font-bold text-slate-600">جارٍ التحقق من حماية الجهاز…</p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
            <PinInput value={pin} onChange={setPin} label={isSetup ? 'رقم القفل الجديد' : 'رقم القفل'} autoFocus />
            {isSetup && <PinInput value={confirmation} onChange={setConfirmation} label="تأكيد رقم القفل" />}
            {message && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">{message}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'جارٍ التحقق…' : isSetup ? 'تأمين الجهاز والمتابعة' : 'فتح التطبيق'}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-stone-50"
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
          تسجيل الخروج من هذا الحساب
        </button>
      </section>
    </main>
  );
}
