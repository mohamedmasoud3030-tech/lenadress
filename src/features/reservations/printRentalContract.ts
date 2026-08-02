import { escapeHtml, isSectionVisible, printDocument, PrintDocumentError } from '@platform/printing';
import { formatMoneyOMR } from '../../shared/utils/format.js';
import { formatTimeLabel } from '../../shared/utils/date';
import { getAccessoriesForReservation } from '../accessories/reservationAccessory.service';
import { getReservationAccessorySecurityDeposit } from '../accessories/accessory.types';
import { getDresses } from '../dresses/dress.service';
import { getShowroomProfile } from '../preferences/showroomProfile.service';
import { getReservationTimes } from './reservation.service';
import {
  getReservationLines,
  isMultiItemReservation,
  calculateLinesRentalPrice,
  calculateLinesSecurityDeposit,
  calculateLinesBookingAdvance,
  calculateLinesFees,
} from './contractLineHelpers';
import { getLineSecurityDepositAmount, getLineBookingAdvanceAmount, getReservationSecurityDepositAmount, getReservationBookingAdvanceAmount } from './reservation.types';
import type { Reservation } from './reservation.types';
import { getPrintSettings } from '../preferences/printSettings.service';

/**
 * Printable rental contract — now with distinct Arabic labels:
 * - دفعة الحجز (booking advance) reduces rental receivable
 * - التأمين المسترد (security deposit) is liability, not revenue
 * Never prints ambiguous "العربون" without qualification.
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
  'أي ضرر أو فقد أو بقعة يصعب إزالتها يترتب عليه رسوم إصلاح تُخصم من التأمين المسترد أو تُحصّل بشكل منفصل.',
  'التأمين المسترد مبلغ مسترد بالكامل بعد فحص القطعة، ما لم تُحتجز منه رسوم تأخير أو ضرر.',
  'دفعة الحجز مبلغ مقدم من قيمة الإيجار ويقلل المتبقي من الإيجار، ولا يُسترد عبر تسوية التأمين.',
  'لا تُعتبر القطعة مسترجعة إلا بعد إثبات الاستلام وفحصها من قبل المعرض.',
  'لا يجوز تأجير القطعة من الباطن أو تعديلها دون موافقة المعرض.',
];

export function buildRentalContractHtml(reservation: Reservation): string {
  const profile = getShowroomProfile();
  const settings = getPrintSettings();
  const customerName = reservation.customerNameSnapshot ?? reservation.customerName;
  const customerPhone = reservation.customerPhoneSnapshot ?? reservation.customerPhone;
  const lines = getReservationLines(reservation);
  const isMulti = isMultiItemReservation(reservation);
  const times = getReservationTimes(reservation);

  const terms = CONTRACT_TERMS.map((term) => `<li>${escapeHtml(term)}</li>`).join('');
  const contactLines = [
    profile.contact.address,
    profile.contact.phone,
    ...(profile.contact.alternatePhones ?? []),
    profile.contact.email,
  ].filter(Boolean).map((value) => escapeHtml(String(value))).join(' · ');

  const accessories = getAccessoriesForReservation(reservation.reservationNumber);
  const accessoryRows = accessories
    .map((link) => `<tr><td>${escapeHtml(link.accessoryCodeSnapshot)}</td><td>${escapeHtml(link.accessoryNameSnapshot)}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(link.rentalPrice))}</td><td>${escapeHtml(formatMoneyOMR(getReservationAccessorySecurityDeposit(link)))}</td></tr>`)
    .join('');
  const accessorySection = accessories.length > 0
    ? `<div class="section"><b>الملحقات المسلَّمة مع القطعة</b>`
      + `<table><thead><tr><th>الكود</th><th>الملحق</th><th>قيمة التأجير</th><th>التأمين المسترد</th></tr></thead>`
      + `<tbody>${accessoryRows}</tbody></table></div>`
    : '';

  // ── Build item table ──────────────────────────────────────────────────
  const itemTableRows = lines.map((line) => {
    const piece = getDresses().find((dress) => dress.code === line.dressCodeSnapshot);
    const pieceDetails = piece ? `${piece.size} · ${piece.color}` : '';
    const lineTimes = {
      pickupTime: line.pickupTime ?? times.pickupTime,
      returnTime: line.returnTime ?? times.returnTime,
    };
    return `<tr><td>${escapeHtml(line.dressCodeSnapshot)}</td><td>${escapeHtml(line.dressNameSnapshot)}</td>`
      + `<td>${escapeHtml(pieceDetails || '—')}</td>`
      + `<td>${escapeHtml(`${line.pickupDate} — ${formatTimeLabel(lineTimes.pickupTime)}`)}</td>`
      + `<td>${escapeHtml(`${line.returnDate} — ${formatTimeLabel(lineTimes.returnTime)}`)}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(line.rentalPrice))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(getLineBookingAdvanceAmount(line)))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(getLineSecurityDepositAmount(line)))}</td></tr>`;
  }).join('');

  const itemTable = isMulti
    ? `<table><thead><tr><th>الكود</th><th>القطعة</th><th>المقاس واللون</th><th>الاستلام</th><th>الإرجاع</th><th>الإيجار</th><th>دفعة الحجز</th><th>التأمين المسترد</th></tr></thead>`
      + `<tbody>${itemTableRows}</tbody></table>`
    : `<table><thead><tr><th>الكود</th><th>القطعة</th><th>المقاس واللون</th><th>الاستلام</th><th>الإرجاع</th></tr></thead>`
      + `<tbody>${lines.map((line) => {
        const piece = getDresses().find((dress) => dress.code === line.dressCodeSnapshot);
        const pieceDetails = piece ? `${piece.size} · ${piece.color}` : '';
        const lineTimes = { pickupTime: line.pickupTime ?? times.pickupTime, returnTime: line.returnTime ?? times.returnTime };
        return `<tr><td>${escapeHtml(line.dressCodeSnapshot)}</td><td>${escapeHtml(line.dressNameSnapshot)}</td>`
          + `<td>${escapeHtml(pieceDetails || '—')}</td>`
          + `<td>${escapeHtml(`${line.pickupDate} — ${formatTimeLabel(lineTimes.pickupTime)}`)}</td>`
          + `<td>${escapeHtml(`${line.returnDate} — ${formatTimeLabel(lineTimes.returnTime)}`)}</td></tr>`;
      }).join('')}</tbody></table>`;

  // ── Financial summary ──────────────────────────────────────────────────
  const totalRentalPrice = isMulti ? calculateLinesRentalPrice(lines) : reservation.rentalPrice;
  const totalBookingAdvance = isMulti ? calculateLinesBookingAdvance(lines) : getReservationBookingAdvanceAmount(reservation);
  const totalSecurityDeposit = isMulti ? calculateLinesSecurityDeposit(lines) : getReservationSecurityDepositAmount(reservation);
  const totalFees = isMulti ? calculateLinesFees(lines) : (reservation.assessedFeesAmount ?? 0);
  const remainingRental = Math.max(totalRentalPrice + totalFees - totalBookingAdvance - (reservation.rentalCollectedAmount ?? 0) - (reservation.securityDepositRetainedAmount ?? 0), reservation.remainingAmount);
  const cashToCollect = totalRentalPrice + totalSecurityDeposit;

  const securityCollected = reservation.securityDepositCollectedAmount ?? 0;
  const securityRefunded = reservation.securityDepositRefundedAmount ?? 0;
  const securityRetained = reservation.securityDepositRetainedAmount ?? 0;
  const securityLiability = Math.max(securityCollected - securityRefunded - securityRetained, 0);

  const financialTable = isMulti
    ? `<table><thead><tr><th>إجمالي الإيجار</th><th>دفعة الحجز</th><th>المتبقي من الإيجار</th><th>إجمالي التأمين المسترد</th><th>التأمين المحصل</th><th>التأمين المحتجز</th><th>التأمين المسترد للعميلة (التزام)</th><th>الرسوم</th><th>إجمالي نقدي للتحصيل</th><th>المدفوع (إيجار)</th><th>المتبقي من الإيجار</th></tr></thead>`
      + `<tbody><tr><td>${escapeHtml(formatMoneyOMR(totalRentalPrice))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(totalBookingAdvance))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(remainingRental))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(totalSecurityDeposit))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(securityCollected))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(securityRetained))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(securityLiability))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(totalFees))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(cashToCollect))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(reservation.rentalCollectedAmount ?? reservation.paidAmount))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(reservation.remainingAmount))}</td></tr></tbody></table>`
    : `<table><thead><tr><th>قيمة الإيجار</th><th>دفعة الحجز</th><th>المتبقي من الإيجار</th><th>التأمين المسترد</th><th>التأمين المحصل</th><th>إجمالي نقدي للتحصيل</th><th>المدفوع</th><th>المتبقي</th></tr></thead>`
      + `<tbody><tr><td>${escapeHtml(formatMoneyOMR(reservation.rentalPrice))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(getReservationBookingAdvanceAmount(reservation)))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(remainingRental))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(getReservationSecurityDepositAmount(reservation)))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(securityCollected))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(cashToCollect))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(reservation.rentalCollectedAmount ?? reservation.paidAmount))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(reservation.remainingAmount))}</td></tr></tbody></table>`;

  // ── Per-line discount (if any) ────────────────────────────────────────
  const discountsHtml = lines
    .filter((line) => line.listRentalPrice && line.rentalPrice < line.listRentalPrice)
    .map((line) => `<tr><td>${escapeHtml(line.dressCodeSnapshot)}</td><td>${escapeHtml(line.dressNameSnapshot)}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(line.listRentalPrice!))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(line.rentalPrice))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(line.listRentalPrice! - line.rentalPrice))}</td></tr>`)
    .join('');

  const discountSection = discountsHtml
    ? `<div class="section"><b>الخصومات</b>`
      + `<table><thead><tr><th>الكود</th><th>القطعة</th><th>سعر القائمة</th><th>السعر المتفق</th><th>الخصم</th></tr></thead>`
      + `<tbody>${discountsHtml}</tbody></table></div>`
    : '';

  return (isSectionVisible(settings, 'logo') ? `<h1>${escapeHtml(profile.brandName)} — عقد إيجار</h1>` : '')
    + (isSectionVisible(settings, 'contact') ? `<p class="muted">${contactLines}</p>` : '')
    + `<div class="section">`
    + `<p><b>رقم الحجز:</b> ${escapeHtml(reservation.reservationNumber)}</p>`
    + `<p><b>العميلة:</b> ${escapeHtml(customerName)} — ${escapeHtml(customerPhone)}</p>`
    + `</div>`
    + itemTable
    + (isSectionVisible(settings, 'accessories') ? accessorySection : '')
    + discountSection
    + financialTable
    + `<p class="muted">التأمين المسترد مبلغ تأمين مسترد ولا يُحتسب ضمن قيمة الإيجار ويبقى التزاماً حتى الاسترداد أو الاحتجاز المبرر. دفعة الحجز تقلل المتبقي من الإيجار مرة واحدة ولا تدخل في تسوية التأمين. إجمالي المبلغ النقدي للتحصيل اليوم = المتبقي من الإيجار + التأمين المسترد + الرسوم.</p>`
    + (isSectionVisible(settings, 'terms') ? `<div class="terms"><b>الشروط والأحكام</b><ol>${terms}</ol></div>` : '')
    + (isSectionVisible(settings, 'signatures')
      ? `<div class="signatures"><span>توقيع المعرض: ______________</span><span>توقيع العميلة: ______________</span></div>`
      : '')
    + (isSectionVisible(settings, 'footer')
      ? `<div class="doc-footer">${escapeHtml(profile.brandName)} · ${contactLines}</div>`
      : '');
}

export function printRentalContract(reservation: Reservation): void {
  try {
    printDocument(`عقد إيجار ${reservation.reservationNumber}`, buildRentalContractHtml(reservation), getPrintSettings());
  } catch (error) {
    if (error instanceof PrintDocumentError) {
      throw new PrintRentalContractError(error.message, error);
    }
    throw new PrintRentalContractError('تعذر تجهيز عقد الإيجار للطباعة. حاولي مرة أخرى.', error);
  }
}
