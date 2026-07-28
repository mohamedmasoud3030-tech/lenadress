import { escapeHtml, printDocument, PrintDocumentError } from '@platform/printing';
import { formatMoneyOMR } from '../../shared/utils/format.js';
import { getShowroomProfile } from '../preferences/showroomProfile.service';
import type { Reservation } from './reservation.types';

/**
 * Printable rental contract.
 *
 * The contract is a legal record of what the showroom handed over and on what
 * terms, so it prints the historical snapshots stored on the reservation, never
 * the current mutable customer/item values.
 */

export class PrintRentalContractError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PrintRentalContractError';
  }
}

const CONTRACT_TERMS = [
  'تلتزم العميلة بإعادة القطعة في التاريخ المتفق عليه وبالحالة التي استلمتها بها.',
  'التأخير عن موعد الإرجاع يترتب عليه رسوم تأخير تُحتسب حسب سياسة المعرض.',
  'أي ضرر أو فقد أو بقعة يصعب إزالتها يترتب عليه رسوم إصلاح تُخصم من العربون أو تُحصّل بشكل منفصل.',
  'العربون مبلغ مسترد بالكامل بعد فحص القطعة، ما لم تُحتجز منه رسوم تأخير أو ضرر.',
  'لا تُعتبر القطعة مسترجعة إلا بعد إثبات الاستلام وفحصها من قبل المعرض.',
  'لا يجوز تأجير القطعة من الباطن أو تعديلها دون موافقة المعرض.',
];

export function buildRentalContractHtml(reservation: Reservation): string {
  const profile = getShowroomProfile();
  const customerName = reservation.customerNameSnapshot ?? reservation.customerName;
  const customerPhone = reservation.customerPhoneSnapshot ?? reservation.customerPhone;
  const itemCode = reservation.dressCodeSnapshot ?? reservation.dressCode;
  const itemName = reservation.dressNameSnapshot ?? reservation.dressName;

  const terms = CONTRACT_TERMS.map((term) => `<li>${escapeHtml(term)}</li>`).join('');

  return `<h1>${escapeHtml(profile.brandName)} — عقد إيجار</h1>`
    + `<p class="muted">${escapeHtml(profile.contact.address ?? '')} · ${escapeHtml(profile.contact.phone ?? '')}</p>`
    + `<div class="section">`
    + `<p><b>رقم الحجز:</b> ${escapeHtml(reservation.reservationNumber)}</p>`
    + `<p><b>العميلة:</b> ${escapeHtml(customerName)} — ${escapeHtml(customerPhone)}</p>`
    + `</div>`
    + `<table><thead><tr><th>الكود</th><th>القطعة</th><th>الاستلام</th><th>الإرجاع</th></tr></thead>`
    + `<tbody><tr><td>${escapeHtml(itemCode)}</td><td>${escapeHtml(itemName)}</td>`
    + `<td>${escapeHtml(reservation.pickupDate)}</td><td>${escapeHtml(reservation.returnDate)}</td></tr></tbody></table>`
    + `<table><thead><tr><th>قيمة الإيجار</th><th>العربون (مسترد)</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>`
    + `<tbody><tr><td>${escapeHtml(formatMoneyOMR(reservation.rentalPrice))}</td>`
    + `<td>${escapeHtml(formatMoneyOMR(reservation.depositAmount))}</td>`
    + `<td>${escapeHtml(formatMoneyOMR(reservation.totalAmount))}</td>`
    + `<td>${escapeHtml(formatMoneyOMR(reservation.paidAmount))}</td>`
    + `<td>${escapeHtml(formatMoneyOMR(reservation.remainingAmount))}</td></tr></tbody></table>`
    + `<p class="muted">العربون مبلغ تأمين مسترد ولا يُحتسب ضمن قيمة الإيجار.</p>`
    + `<div class="terms"><b>الشروط والأحكام</b><ol>${terms}</ol></div>`
    + `<div class="signatures"><span>توقيع المعرض: ______________</span><span>توقيع العميلة: ______________</span></div>`;
}

export function printRentalContract(reservation: Reservation): void {
  try {
    printDocument(`عقد إيجار ${reservation.reservationNumber}`, buildRentalContractHtml(reservation));
  } catch (error) {
    if (error instanceof PrintDocumentError) {
      throw new PrintRentalContractError(error.message, error);
    }
    throw new PrintRentalContractError('تعذر تجهيز عقد الإيجار للطباعة. حاولي مرة أخرى.', error);
  }
}
