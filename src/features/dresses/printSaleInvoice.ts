import { escapeHtml, printDocument, PrintDocumentError } from '@platform/printing';
import { formatMoneyOMR } from '../../shared/utils/format.js';
import type { SaleInvoice } from './salesLedger.service';
import { getPrintSettings } from '../preferences/printSettings.service';

/**
 * Kept as the invoice-specific error type for existing callers and tests, but
 * the popup/print mechanics now live in the shared printing boundary.
 */
export class PrintSaleInvoiceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PrintSaleInvoiceError';
  }
}

export function printSaleInvoice(invoice: SaleInvoice): void {
  const lines = invoice.lines
    .map((line) => `<tr><td>${escapeHtml(line.dressCode)}</td><td>${escapeHtml(line.dressName)}</td><td>${escapeHtml(formatMoneyOMR(line.amount))}</td></tr>`)
    .join('');

  const body = `<h1>LENA — فاتورة مبيعات</h1>`
    + `<p><b>رقم الفاتورة:</b> ${escapeHtml(invoice.invoiceNumber)}</p>`
    + `<p><b>التاريخ:</b> ${escapeHtml(invoice.saleDate)}</p>`
    + `<p><b>العميلة:</b> ${escapeHtml(invoice.customerName)}</p>`
    + `<table><thead><tr><th>الكود</th><th>العنصر</th><th>القيمة</th></tr></thead><tbody>${lines}</tbody></table>`
    + `<p class="total">الإجمالي: ${escapeHtml(formatMoneyOMR(invoice.totalAmount))}</p>`
    + `<div class="signatures"><span>توقيع المعرض: ______________</span><span>توقيع العميلة: ______________</span></div>`;

  try {
    printDocument(invoice.invoiceNumber, body, getPrintSettings());
  } catch (error) {
    if (error instanceof PrintDocumentError) {
      throw new PrintSaleInvoiceError(error.message, error);
    }
    throw new PrintSaleInvoiceError('تعذر تجهيز فاتورة الطباعة. حاولي مرة أخرى.', error);
  }
}
