import { useState, type FormEvent } from 'react';
import { KeyRound, LockKeyhole, ShieldOff } from 'lucide-react';
import { changeDevicePin, configureDevicePin, hasDevicePin, removeDevicePin } from '@platform/security';
import { Section } from '../../components/shared/Section';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';

type Action = 'idle' | 'set' | 'change' | 'remove';

function isSixDigits(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export function DevicePinSettings() {
  const [configured, setConfigured] = useState(() => hasDevicePin());
  const [action, setAction] = useState<Action>('idle');
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const clearForm = () => {
    setAction('idle');
    setCurrentPin('');
    setNextPin('');
    setConfirmation('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setFeedback(null);

    try {
      if (action === 'remove') {
        await removeDevicePin(currentPin);
        setConfigured(false);
        setFeedback('تم إيقاف قفل الجهاز. فعّليه مجدداً قبل ترك الجهاز دون مراقبة.');
      } else {
        if (!isSixDigits(nextPin)) throw new Error('أدخلي رقمًا من 6 أرقام.');
        if (nextPin !== confirmation) throw new Error('رقما القفل غير متطابقين.');
        if (action === 'change') {
          await changeDevicePin(currentPin, nextPin);
          setFeedback('تم تغيير رقم قفل الجهاز.');
        } else {
          await configureDevicePin(nextPin);
          setConfigured(true);
          setFeedback('تم تفعيل قفل الجهاز. سيُطلب الرقم عند فتح التطبيق مجدداً.');
        }
      }
      clearForm();
    } catch (reason) {
      setError(reason);
    } finally {
      setIsSubmitting(false);
    }
  };

  const pinInput = (value: string, setValue: (value: string) => void, label: string, autoFocus = false) => (
    <label className="text-sm font-bold text-slate-700">
      {label}
      <input
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/\D/g, '').slice(0, 6))}
        autoFocus={autoFocus}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-center font-bold tracking-[0.35em] outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
      />
    </label>
  );

  return (
    <Section title="قفل الجهاز" description="يحمي الشاشة المفتوحة على هذا الهاتف أو الكمبيوتر حتى لو ظل حساب الدخول مسجلاً.">
      {feedback && <p role="status" className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{feedback}</p>}
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تحديث قفل الجهاز." className="mb-3" />}

      {action === 'idle' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-50 p-3">
          <div className="flex min-w-0 items-center gap-3">
            {configured ? <LockKeyhole aria-hidden="true" className="h-5 w-5 shrink-0 text-emerald-700" /> : <ShieldOff aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-700" />}
            <div>
              <p className="text-sm font-bold text-slate-950">{configured ? 'قفل الجهاز مفعّل' : 'قفل الجهاز غير مفعّل'}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{configured ? 'يبقى القفل على هذا الجهاز ولا يدخل ضمن النسخ الاحتياطية أو تصفير بيانات المعرض.' : 'فعّليه قبل استخدام التطبيق على جهاز مشترك أو قابل للوصول من الآخرين.'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {configured ? (
              <>
                <button type="button" onClick={() => setAction('change')} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-stone-100"><KeyRound aria-hidden="true" className="h-4 w-4" />تغيير الرقم</button>
                <button type="button" onClick={() => setAction('remove')} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50"><ShieldOff aria-hidden="true" className="h-4 w-4" />إيقاف القفل</button>
              </>
            ) : <button type="button" onClick={() => setAction('set')} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800"><LockKeyhole aria-hidden="true" className="h-4 w-4" />تفعيل القفل</button>}
          </div>
        </div>
      ) : (
        <form className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
          {action !== 'set' && pinInput(currentPin, setCurrentPin, 'رقم القفل الحالي', true)}
          {action !== 'remove' && <>{pinInput(nextPin, setNextPin, action === 'change' ? 'رقم القفل الجديد' : 'رقم القفل', action === 'set')}{pinInput(confirmation, setConfirmation, 'تأكيد رقم القفل')}</>}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={isSubmitting} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? 'جارٍ الحفظ…' : action === 'remove' ? 'تأكيد إيقاف القفل' : 'حفظ رقم القفل'}</button>
            <button type="button" onClick={clearForm} disabled={isSubmitting} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-stone-50">إلغاء</button>
          </div>
        </form>
      )}
    </Section>
  );
}
