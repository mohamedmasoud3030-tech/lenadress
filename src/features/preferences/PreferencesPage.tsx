import { useRef, useState } from 'react';
import { DatabaseBackup, Download, HardDrive, RotateCcw, Save, Upload } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import {
  CURRENT_STORAGE_SCHEMA_VERSION,
  exportDatabaseBackup,
  importDatabaseBackup,
  resetDatabase,
} from '../../services/localDatabase';
import { migrateImagesToIndexedDB } from '../../services/imageMigration.service';
import { isIndexedDBAvailable } from '../../services/imageStorage.service';
import { recordAudit } from '../audit/audit.service';
import { getAppPreferences, saveAppPreferences, type AppPreferences } from './preferences.service';
import { ShowroomProfileEditor } from './ShowroomProfileEditor';
import { AccountSettings } from './AccountSettings';
import { getAppBuildInfo } from '@platform/app-update';
import { downloadJson } from '@platform/download';
import { MessageTemplatesEditor } from './MessageTemplatesEditor';
import { PrintSettingsEditor } from './PrintSettingsEditor';

const preferenceFieldClassName = 'mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30';

export function PreferencesPage() {
  const [preferences, setPreferences] = useState<AppPreferences>(() => getAppPreferences());
  const buildInfo = getAppBuildInfo();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const exportBackup = () => {
    const backup = exportDatabaseBackup();
    downloadJson(`dress-roomshow-backup-${backup.exportedAt.slice(0, 10)}.json`, backup);
    recordAudit({ action: 'create', entityType: 'backup', entityId: backup.exportedAt, summary: 'تم تصدير نسخة احتياطية من بيانات التطبيق.' });
    setFeedback('تم تجهيز النسخة الاحتياطية للتحميل. احتفظي بها في مكان آمن.');
    setError(null);
  };

  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!window.confirm('سيتم استبدال بيانات التطبيق الحالية بالكامل بالنسخة المختارة. هل أنتِ متأكدة؟')) return;
      const restored = importDatabaseBackup(parsed);
      recordAudit({ action: 'import-backup', entityType: 'backup', entityId: restored.exportedAt, summary: 'تم استيراد نسخة احتياطية واستبدال بيانات التطبيق الحالية.' });
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
    resetDatabase();
    recordAudit({ action: 'reset-data', entityType: 'database', entityId: new Date().toISOString(), summary: 'تم تصفير بيانات التطبيق بعد تأكيد صريح.' });
    setPreferences(getAppPreferences());
    setFeedback('تم تصفير بيانات التطبيق.');
    setError(null);
  };

  const savePreferences = () => {
    try {
      setPreferences(saveAppPreferences(preferences));
      setFeedback('تم حفظ إعدادات التشغيل.');
      setError(null);
    } catch (saveError: unknown) {
      setError(saveError);
    }
  };

  const migrateImages = async () => {
    try {
      const result = await migrateImagesToIndexedDB();
      if (result.skipped) {
        setFeedback('الصور مهاجرة مسبقاً أو IndexedDB غير متاح.');
      } else {
        recordAudit({ action: 'migrate-images', entityType: 'storage', entityId: new Date().toISOString(), summary: `تم ترحيل ${result.migrated} صورة إلى IndexedDB.` });
        setFeedback(`تم ترحيل ${result.migrated} صورة إلى IndexedDB بنجاح.`);
      }
      setError(null);
    } catch (migrateError: unknown) {
      setError(migrateError);
      setFeedback(null);
    }
  };

  return (
    <section className="space-y-6">
      <PageHeader eyebrow="الإعدادات" title="النسخ الاحتياطي وإعدادات التشغيل" description="احفظي نسخة آمنة من بيانات المحل واضبطي قواعد الحجز الأساسية من مكان واحد." />
      {feedback && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{feedback}</div>}
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر إكمال عملية البيانات." />}

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <DatabaseBackup aria-hidden="true" className="h-6 w-6 text-amber-700" />
          <div><h2 className="text-lg font-bold">إدارة البيانات</h2><p className="mt-1 text-sm text-slate-500">إصدار هيكل التخزين: {CURRENT_STORAGE_SCHEMA_VERSION}</p></div>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">صدّري نسخة قبل أي استيراد أو تصفير. الاستيراد يستبدل البيانات الحالية فقط بعد تأكيد صريح.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={exportBackup} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"><Download aria-hidden="true" className="h-4 w-4" />تصدير نسخة JSON</button>
          <button type="button" onClick={() => importInput.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-stone-100"><Upload aria-hidden="true" className="h-4 w-4" />استيراد نسخة JSON</button>
          <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importBackup(event.target.files?.[0])} />
          <button type="button" onClick={resetAllData} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50"><RotateCcw aria-hidden="true" className="h-4 w-4" />تصفير جميع البيانات</button>
        </div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <HardDrive aria-hidden="true" className="h-6 w-6 text-violet-700" />
          <div><h2 className="text-lg font-bold">تخزين الصور</h2><p className="mt-1 text-sm text-slate-500">نقل الصور من localStorage إلى IndexedDB لتوفير مساحة أكبر.</p></div>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">IndexedDB يوفر سعة تخزين أكبر بكثير من localStorage، مما يمنع مشاكل الحفظ عند كثرة الصور. اضغطي الزر لترحيل الصور الحالية.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => void migrateImages()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">
            <HardDrive aria-hidden="true" className="h-4 w-4" />
            ترحيل الصور إلى IndexedDB
          </button>
          {!isIndexedDBAvailable() && (
            <p className="self-center text-xs font-bold text-amber-700">IndexedDB غير متاح في هذا المتصفح.</p>
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
