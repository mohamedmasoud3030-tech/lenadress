import { escapeHtml, isSectionVisible, printDocument, PrintDocumentError } from '@platform/printing';
import { getShowroomProfile } from '../preferences/showroomProfile.service';
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

  const settings = getPrintSettings();
  const profile = getShowroomProfile();
  const contactLines = [profile.contact.phone, profile.contact.email, profile.contact.address]
    .filter(Boolean).map((value) => escapeHtml(String(value))).join(' · ');

  const body = (isSectionVisible(settings, 'logo') ? `<h1>${escapeHtml(profile.brandName)} — فاتورة مبيعات</h1>` : '')
    + (isSectionVisible(settings, 'contact') ? `<p class="muted">${contactLines}</p>` : '')
    + `<p><b>رقم الفاتورة:</b> ${escapeHtml(invoice.invoiceNumber)}</p>`
    + `<p><b>التاريخ:</b> ${escapeHtml(invoice.saleDate)}</p>`
    + `<p><b>العميلة:</b> ${escapeHtml(invoice.customerName)}</p>`
    + `<table><thead><tr><th>الكود</th><th>العنصر</th><th>القيمة</th></tr></thead><tbody>${lines}</tbody></table>`
    + `<p class="total">الإجمالي: ${escapeHtml(formatMoneyOMR(invoice.totalAmount))}</p>`
    + (isSectionVisible(settings, 'signatures')
      ? `<div class="signatures"><span>توقيع المعرض: ______________</span><span>توقيع العميلة: ______________</span></div>`
      : '')
    + (isSectionVisible(settings, 'footer') ? `<div class="doc-footer">${contactLines}</div>` : '');

  try {
    printDocument(invoice.invoiceNumber, body, getPrintSettings());
  } catch (error) {
    if (error instanceof PrintDocumentError) {
      throw new PrintSaleInvoiceError(error.message, error);
    }
    throw new PrintSaleInvoiceError('تعذر تجهيز فاتورة الطباعة. حاولي مرة أخرى.', error);
  }
}
