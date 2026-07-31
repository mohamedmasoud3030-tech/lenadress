import { useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { getShowroomProfile } from './showroomProfile.service';
import { resetShowroomProfileCommand, saveShowroomProfileCommand } from '../workflows';
import type { LandingShowroomProfile } from '../../pages/landing/landingContent';
import { landingShowroomProfile } from '../../pages/landing/landingContent';
import { FORM_FIELD_CLASS_NAME, FORM_LABEL_CLASS_NAME } from '../../shared/domain/formConstants';

type EditableFields = Pick<LandingShowroomProfile,
  | 'brandName'
  | 'shortTagline'
  | 'heroTitle'
  | 'heroDescription'
  | 'aboutTitle'
  | 'aboutDescription'
  | 'contact'
>;

function getInitialFields(): EditableFields {
  const profile = getShowroomProfile();
  return {
    brandName: profile.brandName,
    shortTagline: profile.shortTagline,
    heroTitle: profile.heroTitle,
    heroDescription: profile.heroDescription,
    aboutTitle: profile.aboutTitle,
    aboutDescription: profile.aboutDescription,
    contact: { ...profile.contact },
  };
}

export function ShowroomProfileEditor() {
  const [fields, setFields] = useState<EditableFields>(getInitialFields);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof EditableFields>(key: K, value: EditableFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const setContact = (key: keyof LandingShowroomProfile['contact'], value: string) => {
    setFields((prev) => ({ ...prev, contact: { ...prev.contact, [key]: value } }));
    setSaved(false);
  };

  const save = () => {
    try {
      const current = getShowroomProfile();
      const updated: LandingShowroomProfile = { ...current, ...fields, contact: { ...fields.contact } };
      if (!updated.brandName.trim()) {
        setError('اسم المعرض مطلوب.');
        return;
      }
      saveShowroomProfileCommand(updated);
      setSaved(true);
      setError(null);
    } catch {
      setError('تعذر حفظ الملف التعريفي.');
    }
  };

  const reset = () => {
    const defaults = resetShowroomProfileCommand();
    setFields({
      brandName: defaults.brandName,
      shortTagline: defaults.shortTagline,
      heroTitle: defaults.heroTitle,
      heroDescription: defaults.heroDescription,
      aboutTitle: defaults.aboutTitle,
      aboutDescription: defaults.aboutDescription,
      contact: { ...defaults.contact },
    });
    setSaved(false);
    setError(null);
  };

  const inputCls = FORM_FIELD_CLASS_NAME;
  const labelCls = FORM_LABEL_CLASS_NAME;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">ملف المعرض التعريفي</h2>
        <span className="text-xs text-slate-400">يظهر في صفحة العرض للعميلات</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        عدّلي هذه الحقول لتخصيص صفحة العرض &quot;اللاندينج&quot; لكل عميل يشتري التطبيق. القيم الافتراضية مأخوذة من الملف الثابت.
      </p>

      {saved && (
        <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          تم حفظ الملف التعريفي. صفحة العرض ستستخدم القيم الجديدة.
        </div>
      )}
      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
          {error}
        </div>
      )}

      {/* Basic info */}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className={labelCls}>
          اسم المعرض
          <input value={fields.brandName} onChange={(e) => set('brandName', e.target.value)} className={inputCls} placeholder={landingShowroomProfile.brandName} />
        </label>
        <label className={labelCls}>
          الوصف القصير
          <input value={fields.shortTagline} onChange={(e) => set('shortTagline', e.target.value)} className={inputCls} placeholder={landingShowroomProfile.shortTagline} />
        </label>
      </div>

      {/* Hero */}
      <div className="mt-5 grid gap-4">
        <label className={labelCls}>
          عنوان البطل (Hero Title)
          <input value={fields.heroTitle} onChange={(e) => set('heroTitle', e.target.value)} className={inputCls} placeholder={landingShowroomProfile.heroTitle} />
        </label>
        <label className={labelCls}>
          وصف البطل (Hero Description)
          <textarea rows={3} value={fields.heroDescription} onChange={(e) => set('heroDescription', e.target.value)} className={inputCls} placeholder={landingShowroomProfile.heroDescription} />
        </label>
      </div>

      {/* About */}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className={labelCls}>
          عنوان من نحن
          <input value={fields.aboutTitle} onChange={(e) => set('aboutTitle', e.target.value)} className={inputCls} placeholder={landingShowroomProfile.aboutTitle} />
        </label>
        <label className={labelCls}>
          وصف من نحن
          <textarea rows={3} value={fields.aboutDescription} onChange={(e) => set('aboutDescription', e.target.value)} className={inputCls} placeholder={landingShowroomProfile.aboutDescription} />
        </label>
      </div>

      {/* Contact */}
      <h3 className="mt-6 text-sm font-bold text-slate-700">بيانات التواصل</h3>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        <label className={labelCls}>
          الهاتف
          <input value={fields.contact.phone} onChange={(e) => setContact('phone', e.target.value)} className={inputCls} placeholder={landingShowroomProfile.contact.phone} />
        </label>
        <label className={labelCls}>
          واتساب
          <input value={fields.contact.whatsapp} onChange={(e) => setContact('whatsapp', e.target.value)} className={inputCls} placeholder={landingShowroomProfile.contact.whatsapp} />
        </label>
        <label className={labelCls}>
          إنستجرام
          <input value={fields.contact.instagram} onChange={(e) => setContact('instagram', e.target.value)} className={inputCls} placeholder={landingShowroomProfile.contact.instagram} />
        </label>
        <label className={labelCls}>
          ساعات العمل
          <input value={fields.contact.workingHours} onChange={(e) => setContact('workingHours', e.target.value)} className={inputCls} placeholder={landingShowroomProfile.contact.workingHours} />
        </label>
      </div>
      <label className={`${labelCls} mt-4 md:w-1/2`}>
        العنوان
        <input value={fields.contact.address} onChange={(e) => setContact('address', e.target.value)} className={inputCls} placeholder={landingShowroomProfile.contact.address} />
      </label>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={save}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white hover:bg-slate-800"
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          حفظ الملف التعريفي
        </button>
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-5 py-2 text-sm font-bold text-slate-700 hover:bg-stone-100"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          استعادة الافتراضي
        </button>
      </div>
    </article>
  );
}
