import { useMemo, useState } from 'react';
import { Printer, RotateCcw, Save } from 'lucide-react';
import { Section } from '../../components/shared/Section';
import { SelectField, TextField } from '../../components/shared/FormField';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import {
  COLOR_MODE_LABELS,
  DENSITY_LABELS,
  PAPER_SIZES,
  SECTION_LABELS,
  getPaperDefinition,
  printDocument,
  type PaperSize,
  type PrintColorMode,
  type PrintDensity,
  type PrintSettings,
  type PrintableSection,
} from '@platform/printing';
import { getPrintSettings, resetPrintSettings, savePrintSettings } from './printSettings.service';
import { getShowroomProfile } from './showroomProfile.service';

const MARGIN_EDGES: Array<{ key: keyof PrintSettings['margins']; label: string }> = [
  { key: 'top', label: 'أعلى' },
  { key: 'bottom', label: 'أسفل' },
  { key: 'right', label: 'يمين' },
  { key: 'left', label: 'يسار' },
];

/**
 * Print presentation, with a real test page.
 *
 * Margins and colour cannot be judged from a form: the only way to know whether
 * a printer clips the signature line is to print one. The test page contains
 * every element a real document uses — heading, table, totals, terms and
 * signatures — so one sheet proves the whole setup.
 */
export function PrintSettingsEditor() {
  const [settings, setSettings] = useState<PrintSettings>(() => getPrintSettings());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const paper = useMemo(() => getPaperDefinition(settings.paperSize), [settings.paperSize]);

  const update = <Key extends keyof PrintSettings>(key: Key, value: PrintSettings[Key]) => {
    setFeedback(null);
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const changePaper = (paperSize: PaperSize) => {
    // Each stock has its own safe margins; carrying A4 margins onto a 58mm
    // receipt would leave almost no printable width.
    const definition = getPaperDefinition(paperSize);
    setSettings((current) => ({ ...current, paperSize, margins: definition.defaultMargins }));
    setFeedback(null);
  };

  const toggleSection = (section: PrintableSection) => {
    setSettings((current) => ({
      ...current,
      hiddenSections: current.hiddenSections.includes(section)
        ? current.hiddenSections.filter((value) => value !== section)
        : [...current.hiddenSections, section],
    }));
  };

  const save = () => {
    setError(null);
    try {
      setSettings(savePrintSettings(settings));
      setFeedback('تم حفظ إعدادات الطباعة.');
    } catch (reason: unknown) {
      setError(reason);
    }
  };

  const restore = () => {
    setSettings(resetPrintSettings());
    setFeedback('تمت استعادة الإعدادات الافتراضية.');
  };

  const printTestPage = () => {
    setError(null);
    const profile = getShowroomProfile();
    const body = `
      <div class="doc-header">
        <div><h1>${profile.brandName}</h1><p class="muted">صفحة اختبار الطباعة</p></div>
        <div class="muted">${new Date().toLocaleString('ar-OM')}</div>
      </div>
      <h2>عناصر المستند</h2>
      <table>
        <thead><tr><th>البند</th><th>الوصف</th><th>القيمة</th></tr></thead>
        <tbody>
          <tr><td>D-001</td><td>فستان زفاف — مقاس M</td><td>١٠٠٫٠٠٠ ر.ع.</td></tr>
          <tr><td>ACC-001</td><td>طرحة دانتيل</td><td>٥٫٠٠٠ ر.ع.</td></tr>
        </tbody>
      </table>
      <p class="total">الإجمالي: ١٠٥٫٠٠٠ ر.ع.</p>
      <div class="terms"><b>الشروط والأحكام</b><ol><li>نص تجريبي للتأكد من وضوح الخط والهوامش.</li><li>تأكدي من ظهور هذا السطر كاملاً دون قص.</li></ol></div>
      <div class="signatures"><span>توقيع المعرض: ______________</span><span>توقيع العميلة: ______________</span></div>
      <div class="doc-footer">إذا ظهر هذا التذييل كاملاً فالهوامش صحيحة.</div>
    `;
    try {
      printDocument('اختبار الطباعة', body, settings);
    } catch (reason: unknown) {
      setError(reason);
    }
  };

  return (
    <Section
      title="إعدادات الطباعة و PDF"
      description="تُطبَّق على العقود والفواتير والتقارير. الملصقات تستخدم مقاس الملصق دائماً."
    >
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تنفيذ عملية الطباعة." />}
      {feedback && <p role="status" className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{feedback}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SelectField label="مقاس الورق" value={settings.paperSize} onChange={(event) => changePaper(event.target.value as PaperSize)}>
          {PAPER_SIZES.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </SelectField>

        <SelectField label="الألوان" value={settings.colorMode} onChange={(event) => update('colorMode', event.target.value as PrintColorMode)}>
          {Object.entries(COLOR_MODE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </SelectField>

        <SelectField label="كثافة المحتوى" value={settings.density} onChange={(event) => update('density', event.target.value as PrintDensity)}>
          {Object.entries(DENSITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </SelectField>

        <TextField
          label="حجم الخط (نقطة)"
          type="number"
          inputMode="decimal"
          min={7}
          max={20}
          value={String(settings.fontSize)}
          onChange={(event) => update('fontSize', Number(event.target.value) || 11)}
          hint="أقل من 7 يصعب قراءته"
        />
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-bold text-slate-800">الهوامش (مم)</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          {MARGIN_EDGES.map((edge) => (
            <TextField
              key={edge.key}
              label={edge.label}
              type="number"
              inputMode="numeric"
              min={0}
              max={40}
              value={String(settings.margins[edge.key])}
              onChange={(event) => update('margins', { ...settings.margins, [edge.key]: Number(event.target.value) || 0 })}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {paper.continuous
            ? 'ورق مستمر: الطول يتمدد حسب المحتوى.'
            : 'معظم الطابعات لا تطبع أقل من 3 مم من الحافة.'}
        </p>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-bold text-slate-800">محتويات المستند</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SECTION_LABELS) as PrintableSection[]).map((section) => {
            const visible = !settings.hiddenSections.includes(section);
            return (
              <button
                key={section}
                type="button"
                onClick={() => toggleSection(section)}
                aria-pressed={visible}
                className={`min-h-10 rounded-full px-3 text-xs font-bold ring-1 transition ${AMBER_FOCUS_RING_CLASS_NAME} ${
                  visible ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-stone-100 text-slate-500 ring-slate-200 line-through'
                }`}
              >
                {SECTION_LABELS[section]}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">الأقسام المشطوبة لن تُطبع.</p>
      </fieldset>

      <label className="mt-4 flex items-center gap-2 text-sm font-bold text-slate-700">
        <input
          type="checkbox"
          checked={settings.showPageNumbers}
          onChange={(event) => update('showPageNumbers', event.target.checked)}
          className="h-5 w-5 rounded border-slate-300 text-slate-950 focus-visible:ring-2 focus-visible:ring-amber-500"
        />
        طباعة تذييل بالتاريخ ورقم الصفحة
      </label>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={save}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          حفظ الإعدادات
        </button>
        <button
          type="button"
          onClick={printTestPage}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <Printer aria-hidden="true" className="h-4 w-4" />
          طباعة صفحة اختبار
        </button>
        <button
          type="button"
          onClick={restore}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-600 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          استعادة الافتراضي
        </button>
      </div>

      <p className="mt-3 rounded-xl bg-stone-50 p-3 text-xs leading-6 text-slate-600">
        لحفظ المستند كـ PDF: اضغطي طباعة ثم اختاري «حفظ كـ PDF» من نافذة الطابعة. الإعدادات أعلاه تُطبَّق على الملف الناتج أيضاً.
      </p>
    </Section>
  );
}
