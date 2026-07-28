import { escapeHtml, printDocument } from '@platform/printing';
import { ACCESSORY_CATEGORY_LABELS } from '../../shared/domain/accessoryConstants';
import type { Accessory } from './accessory.types';

/**
 * Accessory label printing.
 *
 * Uses the shared printing boundary and escapes every printed value, so an
 * accessory name containing HTML can never be injected into the label.
 */

type AccessoryLabelInput = {
  accessory: Pick<Accessory, 'code' | 'name' | 'barcode' | 'category'>;
  svgMarkup: string;
};

export function buildAccessoryLabelHtml({ accessory, svgMarkup }: AccessoryLabelInput): string {
  const safeName = escapeHtml(accessory.name);
  const safeCode = escapeHtml(accessory.code);
  const safeBarcode = escapeHtml(accessory.barcode);
  const safeCategory = escapeHtml(ACCESSORY_CATEGORY_LABELS[accessory.category]);

  return `
<style>
  @page{size:80mm 45mm;margin:4mm}
  body{padding:0}
  .accessory-label{border:1px solid #cbd5e1;border-radius:14px;padding:10px;text-align:center;overflow:hidden}
  .accessory-label__title{margin:0 0 6px;font-size:13px;font-weight:900;color:#0f172a}
  .accessory-label__name{margin:4px 0 0;font-size:14px;font-weight:800;color:#334155}
  .accessory-label__meta{margin:3px 0 8px;font-size:11px;font-weight:700;color:#64748b}
  .accessory-label__code{direction:ltr}
  .accessory-graphic{display:flex;justify-content:center;max-width:100%;overflow:hidden}
  .accessory-graphic svg{max-width:100%;height:52px}
  .accessory-label__value{margin:6px 0 0;font-size:12px;font-weight:700;color:#475569;direction:ltr;overflow-wrap:anywhere}
  @media print{.accessory-label{border:0}}
</style>
<section class="accessory-label" aria-label="بطاقة ملحق">
  <p class="accessory-label__title">بطاقة ملحق</p>
  <p class="accessory-label__name">${safeName}</p>
  <p class="accessory-label__meta">${safeCategory} · <span class="accessory-label__code">${safeCode}</span></p>
  <div class="accessory-graphic">${svgMarkup}</div>
  <p class="accessory-label__value">${safeBarcode}</p>
</section>`;
}

export function printAccessoryLabel(input: AccessoryLabelInput): void {
  printDocument(`بطاقة الملحق ${input.accessory.code}`, buildAccessoryLabelHtml(input));
}
