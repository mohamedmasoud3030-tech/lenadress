import { escapeHtml, isSectionVisible, printDocument, PrintDocumentError } from '@platform/printing';
import { formatMoneyOMR } from '../../shared/utils/format.js';
import { formatTimeLabel } from '../../shared/utils/date';
import { getAccessoriesForReservation } from '../accessories/reservationAccessory.service';
import { getDresses } from '../dresses/dress.service';
import { getShowroomProfile } from '../preferences/showroomProfile.service';
import { getReservationTimes } from './reservation.service';
import { getReservationLines, isMultiItemReservation, calculateLinesTotal, calculateLinesRentalPrice, calculateLinesDeposit, calculateLinesFees } from './contractLineHelpers';
import type { Reservation } from './reservation.types';
import { getPrintSettings } from '../preferences/printSettings.service';

/**
 * Printable rental contract.
 *
 * The contract is a legal record of what the showroom handed over and on what
 * terms, so it prints the historical snapshots stored on the reservation, never
 * the current mutable customer/item values.
 *
 * For multi-item contracts, each line is rendered as a row in a table with its
 * own dates, pricing, and status. The totals are summed from all lines.
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
  // The operator can switch off blocks that waste paper on a filing copy.
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
      + `<td>${escapeHtml(formatMoneyOMR(link.rentalPrice))}</td><td>${escapeHtml(formatMoneyOMR(link.depositAmount))}</td></tr>`)
    .join('');
  const accessorySection = accessories.length > 0
    ? `<div class="section"><b>الملحقات المسلَّمة مع القطعة</b>`
      + `<table><thead><tr><th>الكود</th><th>الملحق</th><th>قيمة التأجير</th><th>التأمين</th></tr></thead>`
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
      + `<td>${escapeHtml(formatMoneyOMR(line.depositAmount))}</td></tr>`;
  }).join('');

  const itemTable = isMulti
    ? `<table><thead><tr><th>الكود</th><th>القطعة</th><th>المقاس واللون</th><th>الاستلام</th><th>الإرجاع</th><th>الإيجار</th><th>التأمين</th></tr></thead>`
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
  const totalDeposit = isMulti ? calculateLinesDeposit(lines) : reservation.depositAmount;
  const totalFees = isMulti ? calculateLinesFees(lines) : 0;
  const totalAmount = isMulti ? calculateLinesTotal(lines) : reservation.totalAmount;

  const financialTable = isMulti
    ? `<table><thead><tr><th>إجمالي الإيجار</th><th>إجمالي التأمين</th><th>الرسوم</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>`
      + `<tbody><tr><td>${escapeHtml(formatMoneyOMR(totalRentalPrice))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(totalDeposit))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(totalFees))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(totalAmount))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(reservation.paidAmount))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(reservation.remainingAmount))}</td></tr></tbody></table>`
    : `<table><thead><tr><th>قيمة الإيجار</th><th>العربون (مسترد)</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>`
      + `<tbody><tr><td>${escapeHtml(formatMoneyOMR(reservation.rentalPrice))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(reservation.depositAmount))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(reservation.totalAmount))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(reservation.paidAmount))}</td>`
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
    + `<p class="muted">العربون مبلغ تأمين مسترد ولا يُحتسب ضمن قيمة الإيجار.</p>`
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
