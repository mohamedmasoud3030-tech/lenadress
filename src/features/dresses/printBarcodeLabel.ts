import { escapeHtml, getPaperDefinition, printDocument } from '@platform/printing';
import { getPrintSettings } from '../preferences/printSettings.service';

/**
 * A label always prints on label stock.
 *
 * The showroom's document paper size (usually A4) must not push an 80mm sticker
 * onto a full sheet, so only the colour mode and font size are inherited.
 */
function getLabelPrintSettings() {
  const settings = getPrintSettings();
  const label = getPaperDefinition('label80x45');
  return { ...settings, paperSize: label.id, margins: label.defaultMargins, density: 'compact' as const };
}

type BarcodeLabelInput = {
  value: string;
  svgMarkup: string;
  itemName?: string;
  itemCode?: string;
};

export function buildBarcodeLabelHtml({ value, svgMarkup, itemName, itemCode }: BarcodeLabelInput): string {
  const safeValue = escapeHtml(value);
  const safeName = itemName ? `<p class="item-name">${escapeHtml(itemName)}</p>` : '';
  const safeCode = itemCode ? `<p class="item-code">${escapeHtml(itemCode)}</p>` : '';

  return `
<style>
  @page{size:80mm 45mm;margin:4mm}
  body{padding:0}
  .barcode-label{border:1px solid #cbd5e1;border-radius:14px;padding:10px;text-align:center;overflow:hidden}
  .barcode-label__title{margin:0 0 6px;font-size:14px;font-weight:900;color:#0f172a}
  .item-name{margin:4px 0 0;font-size:14px;font-weight:800;color:#334155}
  .item-code{margin:3px 0 8px;font-size:12px;font-weight:700;color:#64748b;direction:ltr}
  .barcode-graphic{display:flex;justify-content:center;max-width:100%;overflow:hidden}
  .barcode-graphic svg{max-width:100%;height:58px}
  .barcode-value{margin:6px 0 0;font-size:12px;font-weight:700;color:#475569;direction:ltr;overflow-wrap:anywhere}
  @media print{.barcode-label{border:0}}
</style>
<section class="barcode-label" aria-label="ملصق باركود العنصر">
  <p class="barcode-label__title">ملصق الباركود</p>
  ${safeName}
  ${safeCode}
  <div class="barcode-graphic">${svgMarkup}</div>
  <p class="barcode-value">${safeValue}</p>
</section>`;
}

export function printBarcodeLabel(input: BarcodeLabelInput): void {
  const titleCode = input.itemCode || input.value;
  printDocument(`ملصق الباركود ${titleCode}`, buildBarcodeLabelHtml(input), getLabelPrintSettings());
}

/**
 * Builds a sheet of labels, one per printed page.
 *
 * Labelling a delivery of forty new pieces meant forty separate trips through
 * the print dialog. Batching them into one document with a hard page break
 * between labels makes it one trip, and keeps every label on its own physical
 * sticker — a CSS grid of labels on one sheet was rejected because label stock
 * is a continuous roll of fixed-size stickers, not a sheet to be subdivided.
 *
 * The style block is emitted once rather than per label: repeating it forty
 * times bloats the document and some print engines only honour the first
 * `@page` rule anyway.
 */
export function buildBarcodeLabelSheetHtml(labels: BarcodeLabelInput[]): string {
  if (labels.length === 0) throw new Error('لا توجد ملصقات للطباعة.');

  const sections = labels.map((label, index) => {
    const safeValue = escapeHtml(label.value);
    const safeName = label.itemName ? `<p class="item-name">${escapeHtml(label.itemName)}</p>` : '';
    const safeCode = label.itemCode ? `<p class="item-code">${escapeHtml(label.itemCode)}</p>` : '';
    // The last label must not force a trailing blank sticker.
    const breakClass = index < labels.length - 1 ? ' barcode-label--break' : '';

    return `<section class="barcode-label${breakClass}" aria-label="ملصق باركود العنصر">
  <p class="barcode-label__title">ملصق الباركود</p>
  ${safeName}
  ${safeCode}
  <div class="barcode-graphic">${label.svgMarkup}</div>
  <p class="barcode-value">${safeValue}</p>
</section>`;
  }).join('\n');

  return `
<style>
  @page{size:80mm 45mm;margin:4mm}
  body{padding:0}
  .barcode-label{border:1px solid #cbd5e1;border-radius:14px;padding:10px;text-align:center;overflow:hidden}
  .barcode-label--break{break-after:page;page-break-after:always}
  .barcode-label__title{margin:0 0 6px;font-size:14px;font-weight:900;color:#0f172a}
  .item-name{margin:4px 0 0;font-size:14px;font-weight:800;color:#334155}
  .item-code{margin:3px 0 8px;font-size:12px;font-weight:700;color:#64748b;direction:ltr}
  .barcode-graphic{display:flex;justify-content:center;max-width:100%;overflow:hidden}
  .barcode-graphic svg{max-width:100%;height:58px}
  .barcode-value{margin:6px 0 0;font-size:12px;font-weight:700;color:#475569;direction:ltr;overflow-wrap:anywhere}
  @media print{.barcode-label{border:0}}
</style>
${sections}`;
}

export function printBarcodeLabelSheet(labels: BarcodeLabelInput[]): void {
  printDocument(`ملصقات الباركود (${labels.length})`, buildBarcodeLabelSheetHtml(labels), getLabelPrintSettings());
}

export type { BarcodeLabelInput };
