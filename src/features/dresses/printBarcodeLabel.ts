import { escapeHtml, printDocument } from '@platform/printing';

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
  printDocument(`ملصق الباركود ${titleCode}`, buildBarcodeLabelHtml(input));
}
