/**
 * Print presentation settings.
 *
 * Every document was previously hard-coded to one layout: A4-ish padding, full
 * colour, everything visible. A showroom actually needs to choose:
 *
 * - **paper size**, because a rental contract goes on A4 while a barcode label
 *   goes on an 80mm sticker roll and a receipt on 80mm thermal paper;
 * - **margins**, because every printer has a different unprintable edge and a
 *   contract that loses its signature line is worthless;
 * - **colour**, because a thermal printer has none and colour ink is expensive
 *   for a document that gets filed;
 * - **which sections print**, because the terms and conditions belong on the
 *   customer copy but waste a page on the filing copy.
 *
 * These are stored per showroom, not per document, so the choice is made once.
 */

export type PaperSize = 'A4' | 'A5' | 'Letter' | 'thermal80' | 'thermal58' | 'label80x45';

export type PrintColorMode = 'color' | 'grayscale' | 'blackwhite';

export type PrintDensity = 'comfortable' | 'compact';

export type PaperDefinition = {
  id: PaperSize;
  label: string;
  /** CSS `@page size` value. */
  css: string;
  /** Sensible default margins in millimetres. */
  defaultMargins: PrintMargins;
  /** Roll paper has no fixed height and must not be padded like a sheet. */
  continuous: boolean;
};

export type PrintMargins = { top: number; right: number; bottom: number; left: number };

export const PAPER_SIZES: PaperDefinition[] = [
  { id: 'A4', label: 'A4 (210×297 مم)', css: 'A4', defaultMargins: { top: 15, right: 15, bottom: 15, left: 15 }, continuous: false },
  { id: 'A5', label: 'A5 (148×210 مم)', css: 'A5', defaultMargins: { top: 10, right: 10, bottom: 10, left: 10 }, continuous: false },
  { id: 'Letter', label: 'Letter (216×279 مم)', css: 'Letter', defaultMargins: { top: 15, right: 15, bottom: 15, left: 15 }, continuous: false },
  { id: 'thermal80', label: 'إيصال حراري 80 مم', css: '80mm auto', defaultMargins: { top: 4, right: 3, bottom: 4, left: 3 }, continuous: true },
  { id: 'thermal58', label: 'إيصال حراري 58 مم', css: '58mm auto', defaultMargins: { top: 3, right: 2, bottom: 3, left: 2 }, continuous: true },
  { id: 'label80x45', label: 'ملصق 80×45 مم', css: '80mm 45mm', defaultMargins: { top: 3, right: 3, bottom: 3, left: 3 }, continuous: false },
];

export function getPaperDefinition(size: PaperSize): PaperDefinition {
  return PAPER_SIZES.find((paper) => paper.id === size) ?? PAPER_SIZES[0];
}

/** Optional blocks a document may expose so the operator can omit them. */
export type PrintableSection =
  | 'logo'
  | 'contact'
  | 'terms'
  | 'signatures'
  | 'notes'
  | 'accessories'
  | 'itemImages'
  | 'footer';

export type PrintSettings = {
  paperSize: PaperSize;
  margins: PrintMargins;
  colorMode: PrintColorMode;
  density: PrintDensity;
  /** Base body font size in points. */
  fontSize: number;
  /** Sections the operator has switched off. */
  hiddenSections: PrintableSection[];
  /** Print a footer with page numbers and the generation time. */
  showPageNumbers: boolean;
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paperSize: 'A4',
  margins: { top: 15, right: 15, bottom: 15, left: 15 },
  colorMode: 'color',
  density: 'comfortable',
  fontSize: 11,
  hiddenSections: [],
  showPageNumbers: true,
};

export const COLOR_MODE_LABELS: Record<PrintColorMode, string> = {
  color: 'ألوان كاملة',
  grayscale: 'تدرّج رمادي',
  blackwhite: 'أبيض وأسود فقط',
};

export const DENSITY_LABELS: Record<PrintDensity, string> = {
  comfortable: 'مريح',
  compact: 'مضغوط',
};

export const SECTION_LABELS: Record<PrintableSection, string> = {
  logo: 'شعار واسم المعرض',
  contact: 'بيانات التواصل',
  terms: 'الشروط والأحكام',
  signatures: 'خانات التوقيع',
  notes: 'الملاحظات',
  accessories: 'جدول الملحقات',
  itemImages: 'صور القطع',
  footer: 'تذييل الصفحة',
};

function clampMargin(value: number): number {
  // Below 2mm most printers clip; above 40mm the page is mostly empty.
  if (!Number.isFinite(value)) return 10;
  return Math.min(Math.max(Math.round(value), 0), 40);
}

export function normalizePrintSettings(value?: Partial<PrintSettings>): PrintSettings {
  const paperSize = PAPER_SIZES.some((paper) => paper.id === value?.paperSize)
    ? (value?.paperSize as PaperSize)
    : DEFAULT_PRINT_SETTINGS.paperSize;
  const fallbackMargins = getPaperDefinition(paperSize).defaultMargins;
  const fontSize = Number(value?.fontSize ?? DEFAULT_PRINT_SETTINGS.fontSize);

  return {
    paperSize,
    margins: {
      top: clampMargin(value?.margins?.top ?? fallbackMargins.top),
      right: clampMargin(value?.margins?.right ?? fallbackMargins.right),
      bottom: clampMargin(value?.margins?.bottom ?? fallbackMargins.bottom),
      left: clampMargin(value?.margins?.left ?? fallbackMargins.left),
    },
    colorMode: ['color', 'grayscale', 'blackwhite'].includes(value?.colorMode ?? '')
      ? (value?.colorMode as PrintColorMode)
      : DEFAULT_PRINT_SETTINGS.colorMode,
    density: value?.density === 'compact' ? 'compact' : 'comfortable',
    // Below 7pt Arabic diacritics become unreadable in print.
    fontSize: Number.isFinite(fontSize) ? Math.min(Math.max(fontSize, 7), 20) : DEFAULT_PRINT_SETTINGS.fontSize,
    hiddenSections: Array.isArray(value?.hiddenSections)
      ? value.hiddenSections.filter((section): section is PrintableSection => section in SECTION_LABELS)
      : [],
    showPageNumbers: value?.showPageNumbers ?? true,
  };
}

export function isSectionVisible(settings: PrintSettings, section: PrintableSection): boolean {
  return !settings.hiddenSections.includes(section);
}

/**
 * Builds the CSS that applies the settings to a document.
 *
 * `print-color-adjust: exact` is required or browsers strip background colours
 * from printed output, which would silently drop every status badge and table
 * header shading.
 */
export function buildPrintStyles(settings: PrintSettings): string {
  const paper = getPaperDefinition(settings.paperSize);
  const { margins } = settings;
  const scale = settings.density === 'compact' ? 0.75 : 1;

  const colorFilter = settings.colorMode === 'grayscale'
    ? 'filter:grayscale(100%);'
    : settings.colorMode === 'blackwhite'
      // A hard threshold, so faint greys do not print as unreadable smudges.
      ? 'filter:grayscale(100%) contrast(1000%);'
      : '';

  return `
@page{size:${paper.css};margin:${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm}
:root{--print-gap:${(16 * scale).toFixed(0)}px}
html,body{margin:0;padding:0}
body{
  font-family:'Noto Sans Arabic',Arial,sans-serif;
  font-size:${settings.fontSize}pt;
  line-height:${settings.density === 'compact' ? 1.45 : 1.7};
  color:#0f172a;
  direction:rtl;
  padding:${paper.continuous ? '0' : '0'};
  ${colorFilter}
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
h1{margin:0 0 4px;font-size:${(settings.fontSize * 1.7).toFixed(1)}pt}
h2{margin:var(--print-gap) 0 6px;font-size:${(settings.fontSize * 1.25).toFixed(1)}pt}
small,.muted{color:#64748b;font-size:${(settings.fontSize * 0.85).toFixed(1)}pt}
table{width:100%;border-collapse:collapse;margin-top:var(--print-gap)}
th,td{border:1px solid #cbd5e1;padding:${(7 * scale).toFixed(0)}px;text-align:right;vertical-align:top}
th{background:#f1f5f9;font-weight:800}
.total{margin-top:var(--print-gap);font-size:${(settings.fontSize * 1.3).toFixed(1)}pt;font-weight:bold}
.section{margin-top:var(--print-gap)}
.terms{margin-top:var(--print-gap);font-size:${(settings.fontSize * 0.88).toFixed(1)}pt;line-height:1.9}
.signatures{display:flex;justify-content:space-between;margin-top:${(48 * scale).toFixed(0)}px}
.doc-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:2px solid #0f172a;padding-bottom:8px}
.doc-footer{margin-top:var(--print-gap);border-top:1px solid #cbd5e1;padding-top:6px;font-size:${(settings.fontSize * 0.8).toFixed(1)}pt;color:#64748b}
/* A table row split across a page break is unreadable on a contract. */
tr,.avoid-break{break-inside:avoid;page-break-inside:avoid}
thead{display:table-header-group}
.page-break{break-before:page;page-break-before:always}
${paper.continuous ? '.signatures{display:block}.signatures span{display:block;margin-top:28px}' : ''}
@media print{.no-print{display:none !important}}
`;
}
