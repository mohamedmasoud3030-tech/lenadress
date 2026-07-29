import JsBarcode from 'jsbarcode';
import { printBarcodeLabelSheet, type BarcodeLabelInput } from './printBarcodeLabel';

/**
 * Batch label printing.
 *
 * Labelling a delivery of forty new pieces meant opening each item, pressing
 * print, and clearing the dialog — forty times. This renders every barcode once
 * and hands the whole set to the print engine as a single document.
 *
 * The barcodes are drawn into detached SVG elements that are never attached to
 * the page. Mounting forty barcode components just to serialise them would
 * force a layout pass per item and visibly freeze the list on a phone; JsBarcode
 * only needs an element to write into, not one that is rendered.
 */

export type LabelSource = {
  barcode: string;
  code: string;
  name: string;
};

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** Renders one barcode and returns its serialised markup, or null if invalid. */
function renderBarcodeMarkup(value: string): string | null {
  if (!value) return null;

  try {
    const element = document.createElementNS(SVG_NAMESPACE, 'svg');
    JsBarcode(element, value, {
      format: 'CODE128',
      width: 2,
      height: 100,
      displayValue: true,
      fontSize: 16,
      background: '#ffffff',
      lineColor: '#000000',
      margin: 12,
    });
    return new XMLSerializer().serializeToString(element);
  } catch {
    // A single unencodable value must not abort the whole batch: the operator
    // would have no way to tell which of forty items caused it.
    return null;
  }
}

export type BatchLabelResult = {
  printed: number;
  /** Item codes whose barcode could not be rendered. */
  skipped: string[];
};

export function buildLabelBatch(items: LabelSource[]): { labels: BarcodeLabelInput[]; skipped: string[] } {
  const labels: BarcodeLabelInput[] = [];
  const skipped: string[] = [];

  items.forEach((item) => {
    const svgMarkup = renderBarcodeMarkup(item.barcode);
    if (!svgMarkup) {
      skipped.push(item.code);
      return;
    }
    labels.push({ value: item.barcode, svgMarkup, itemName: item.name, itemCode: item.code });
  });

  return { labels, skipped };
}

export function printLabelsForItems(items: LabelSource[]): BatchLabelResult {
  if (items.length === 0) throw new Error('لا توجد عناصر لطباعة ملصقاتها.');

  const { labels, skipped } = buildLabelBatch(items);
  if (labels.length === 0) throw new Error('تعذر توليد أي ملصق صالح من العناصر المحددة.');

  printBarcodeLabelSheet(labels);
  return { printed: labels.length, skipped };
}
