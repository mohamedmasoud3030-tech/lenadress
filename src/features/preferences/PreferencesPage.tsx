import { useRef, useState } from 'react';
import { DatabaseBackup, Download, HardDrive, RotateCcw, Save, Upload } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { StorageCapacityIndicator } from '../../components/shared/StorageCapacityIndicator';
import { isIndexedDBAvailable } from '../../services/imageStorage.service';
import { getAppPreferences, type AppPreferences } from './preferences.service';
import {
  importDatabaseBackupCommand,
  migrateImagesCommand,
  resetApplicationDataCommand,
  saveAppPreferencesCommand,
} from '../workflows';
import { ShowroomProfileEditor } from './ShowroomProfileEditor';
import { AccountSettings } from './AccountSettings';
import { DevicePinSettings } from '../device-lock/DevicePinSettings';
import { getAppBuildInfo } from '@platform/app-update';
import { MessageTemplatesEditor } from './MessageTemplatesEditor';
import { PrintSettingsEditor } from './PrintSettingsEditor';
import { exportBackupForDownload } from './backupExport.service';

const preferenceFieldClassName = 'mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30';

export function PreferencesPage() {
  const [preferences, setPreferences] = useState<AppPreferences>(() => getAppPreferences());
  const buildInfo = getAppBuildInfo();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isExporting, setIsExporting] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  const exportBackup = async () => {
    setIsExporting(true);
    try {
      await exportBackupForDownload({ source: 'manual' });
      setFeedback('تم تجهيز النسخة الاحتياطية الكاملة للتحميل. احتفظي بها في مكان آمن.');
      setError(null);
    } catch (reason: unknown) {
      setError(reason);
      setFeedback(null);
    } finally {
      setIsExporting(false);
    }
  };

  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!window.confirm('سيتم استبدال بيانات التطبيق الحالية بالكامل بالنسخة المختارة. هل أنتِ متأكدة؟')) return;
      await importDatabaseBackupCommand(parsed);
      setPreferences(getAppPreferences());
      setFeedback('تم استيراد النسخة الاحتياطية بنجاح. أعيدي تحميل الصفحة عند الحاجة لمراجعة جميع الأقسام.');
      setError(null);
    } catch (reason: unknown) {
      setError(reason);
      setFeedback(null);
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  };

  const resetAllData = () => {
    const confirmation = window.prompt('هذا الإجراء يمسح جميع البيانات نهائياً. اكتبي: تصفير البيانات');
    if (confirmation !== 'تصفير البيانات') {
      setError('لم يتم التصفير. عبارة التأكيد غير مطابقة.');
      setFeedback(null);
      return;
    }
    resetApplicationDataCommand();
    setPreferences(getAppPreferences());
    setFeedback('تم تصفير بيانات التطبيق.');
    setError(null);
  };

  const savePreferences = () => {
    try {
      setPreferences(saveAppPreferencesCommand(preferences));
      setFeedback('تم حفظ إعدادات التشغيل.');
      setError(null);
    } catch (saveError: unknown) {
      setError(saveError);
    }
  };

  const migrateImages = async () => {
    try {
      const result = await migrateImagesCommand();
      if (result.skipped) {
        setFeedback('الصور محفوظة بالفعل بالطريقة المحسّنة، أو أن الجهاز لا يدعم نقلها الآن.');
      } else {
        setFeedback(`تم تحسين حفظ ${result.migrated} صورة بنجاح.`);
      }
      setError(null);
    } catch (migrateError: unknown) {
      setError(migrateError);
      setFeedback(null);
    }
  };

  return (
    <section className="space-y-6">
      <PageHeader eyebrow="الإعدادات" title="النسخ الاحتياطي وإعدادات التشغيل" />
      {feedback && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{feedback}</div>}
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر إكمال عملية البيانات." />}

      <StorageCapacityIndicator />

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <DatabaseBackup aria-hidden="true" className="h-6 w-6 text-amber-700" />
          <div><h2 className="text-lg font-bold">النسخ الاحتياطي والاستعادة</h2><p className="mt-1 text-sm text-slate-500">احتفظي بنسخة آمنة قبل استبدال البيانات أو تصفيرها.</p></div>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">صدّري نسخة قبل أي استيراد أو تصفير. الاستيراد يستبدل البيانات الحالية فقط بعد تأكيد صريح.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => void exportBackup()} disabled={isExporting} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"><Download aria-hidden="true" className="h-4 w-4" />{isExporting ? 'جارٍ تجهيز النسخة...' : 'تنزيل نسخة احتياطية'}</button>
          <button type="button" onClick={() => importInput.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-stone-100"><Upload aria-hidden="true" className="h-4 w-4" />استعادة نسخة احتياطية</button>
          <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importBackup(event.target.files?.[0])} />
          <button type="button" onClick={resetAllData} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50"><RotateCcw aria-hidden="true" className="h-4 w-4" />تصفير جميع البيانات</button>
        </div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <HardDrive aria-hidden="true" className="h-6 w-6 text-amber-700" />
          <div><h2 className="text-lg font-bold">تحسين حفظ الصور</h2><p className="mt-1 text-sm text-slate-500">نقل الصور القديمة إلى مساحة أكثر ملاءمة داخل الجهاز.</p></div>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">استخدمي هذه العملية مرة واحدة إذا كانت لديك صور قديمة كثيرة، لتقليل احتمالات امتلاء المساحة أثناء العمل.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => void migrateImages()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">
            <HardDrive aria-hidden="true" className="h-4 w-4" />
            تحسين حفظ الصور القديمة
          </button>
          {!isIndexedDBAvailable() && (
            <p className="self-center text-xs font-bold text-amber-700">هذا الجهاز لا يدعم نقل الصور القديمة تلقائيًا.</p>
          )}
        </div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">قواعد التشغيل</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-sm font-bold text-slate-700">اسم المعرض<input value={preferences.showroomName} onChange={(event) => setPreferences((current) => ({ ...current, showroomName: event.target.value }))} className={preferenceFieldClassName} /></label>
          <label className="text-sm font-bold text-slate-700">مدة التجهيز قبل التسليم (أيام)<input type="number" min="0" max="14" value={preferences.preparationDaysBeforePickup} onChange={(event) => setPreferences((current) => ({ ...current, preparationDaysBeforePickup: Number(event.target.value) }))} className={preferenceFieldClassName} /></label>
          <label className="text-sm font-bold text-slate-700">مدة التنظيف بعد الإرجاع (أيام)<input type="number" min="0" max="14" value={preferences.cleaningDaysAfterReturn} onChange={(event) => setPreferences((current) => ({ ...current, cleaningDaysAfterReturn: Number(event.target.value) }))} className={preferenceFieldClassName} /></label>
          <label className="text-sm font-bold text-slate-700">وقت الاستلام الافتراضي<input type="time" value={preferences.defaultPickupTime} onChange={(event) => setPreferences((current) => ({ ...current, defaultPickupTime: event.target.value }))} className={preferenceFieldClassName} /></label>
          <label className="text-sm font-bold text-slate-700">وقت الإرجاع الافتراضي<input type="time" value={preferences.defaultReturnTime} onChange={(event) => setPreferences((current) => ({ ...current, defaultReturnTime: event.target.value }))} className={preferenceFieldClassName} /></label>
          <label className="text-sm font-bold text-slate-700">حد العنصر الراكد بالأيام<input type="number" min="1" max="3650" value={preferences.dormantDressDays} onChange={(event) => setPreferences((current) => ({ ...current, dormantDressDays: Number(event.target.value) }))} className={preferenceFieldClassName} /></label>
        </div>
        <p className="mt-3 rounded-xl bg-stone-50 p-3 text-xs leading-5 text-slate-600">
          مدة التجهيز ومدة التنظيف تُوسّعان فترة الحجز المحجوبة تلقائياً، فلا يُقبل حجز جديد لنفس الفستان أو الملحق داخل هذه المدد.
        </p>

        {/* The fee is proposed, never imposed: waiving it for a good customer
            stays a decision the showroom makes, not the software. */}
        <h3 className="mt-6 text-base font-bold text-slate-900">سياسة رسوم التأخير</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <label className="text-sm font-bold text-slate-700">
            طريقة الاحتساب
            <select
              value={preferences.lateFeePolicy.mode}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                lateFeePolicy: { ...current.lateFeePolicy, mode: event.target.value as AppPreferences['lateFeePolicy']['mode'] },
              }))}
              className={preferenceFieldClassName}
            >
              <option value="none">بدون احتساب تلقائي</option>
              <option value="fixed_per_day">مبلغ ثابت لكل يوم</option>
              <option value="percent_of_rental_per_day">نسبة من الإيجار لكل يوم</option>
            </select>
          </label>
          <label className="text-sm font-bold text-slate-700">
            المبلغ اليومي (ر.ع)
            <input
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              disabled={preferences.lateFeePolicy.mode !== 'fixed_per_day'}
              value={preferences.lateFeePolicy.amountPerDay}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                lateFeePolicy: { ...current.lateFeePolicy, amountPerDay: Number(event.target.value) },
              }))}
              className={preferenceFieldClassName}
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            النسبة اليومية (%)
            <input
              type="number"
              min="0"
              max="100"
              inputMode="decimal"
              disabled={preferences.lateFeePolicy.mode !== 'percent_of_rental_per_day'}
              value={preferences.lateFeePolicy.percentPerDay}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                lateFeePolicy: { ...current.lateFeePolicy, percentPerDay: Number(event.target.value) },
              }))}
              className={preferenceFieldClassName}
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            مهلة السماح (أيام)
            <input
              type="number"
              min="0"
              max="30"
              value={preferences.lateFeePolicy.graceDays}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                lateFeePolicy: { ...current.lateFeePolicy, graceDays: Number(event.target.value) },
              }))}
              className={preferenceFieldClassName}
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            الحد الأقصى (% من الإيجار)
            <input
              type="number"
              min="0"
              max="1000"
              value={preferences.lateFeePolicy.maxPercentOfRental}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                lateFeePolicy: { ...current.lateFeePolicy, maxPercentOfRental: Number(event.target.value) },
              }))}
              className={preferenceFieldClassName}
            />
          </label>
        </div>
        <p className="mt-3 rounded-xl bg-stone-50 p-3 text-xs leading-5 text-slate-600">
          يقترح النظام قيمة رسوم التأخير عند تسجيل الاسترجاع، ويظل بإمكانك تعديلها أو إلغاؤها. صفر في الحد الأقصى يعني بلا سقف.
        </p>
        <button type="button" onClick={savePreferences} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"><Save aria-hidden="true" className="h-4 w-4" />حفظ الإعدادات</button>
      </article>

      <AccountSettings />

      <DevicePinSettings />

      {/* Named here because support is impossible while the operator cannot
          answer "which version are you on?". */}
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">عن التطبيق</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">الإصدار</dt>
            <dd className="font-bold text-slate-950" dir="ltr">{buildInfo.version}</dd>
          </div>
          <div>
            <dt className="text-slate-500">تاريخ النسخة</dt>
            <dd className="font-bold text-slate-950" dir="ltr">{buildInfo.buildTime ? buildInfo.buildTime.slice(0, 10) : '—'}</dd>
          </div>
        </dl>
        <p className="mt-3 rounded-xl bg-stone-50 p-3 text-xs leading-5 text-slate-600">
          اذكري رقم الإصدار عند طلب الدعم. التحديثات لا تُطبّق تلقائياً أثناء العمل؛ سيظهر لكِ تنبيه لاختيار وقت التحديث.
        </p>
      </article>

      <MessageTemplatesEditor />

      <PrintSettingsEditor />

      <ShowroomProfileEditor />
    </section>
  );
}
