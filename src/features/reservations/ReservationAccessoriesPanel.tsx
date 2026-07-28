import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import {
  ACCESSORY_CATEGORY_LABELS,
  ACCESSORY_STATUS_LABELS,
  ACCESSORY_STATUS_STYLES,
} from '../../shared/domain/accessoryConstants';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { formatMoneyOMR } from '../../shared/utils/format';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { getAccessories, isAccessoryBookable } from '../accessories/accessory.service';
import {
  ACCESSORY_RETURN_CONDITION_LABELS,
  getReservationAccessoryViews,
} from '../accessories/reservationAccessory.service';
import { attachAccessoryCommand, detachAccessoryCommand } from '../workflows';
import type { Reservation } from './reservation.types';

/**
 * Accessories attached to one reservation.
 *
 * Conflicts are rejected by the service layer, so this panel only surfaces the
 * Arabic reason; it never decides availability on its own.
 */
export function ReservationAccessoriesPanel({ reservation }: { reservation: Reservation }) {
  const [links, setLinks] = useState(() => getReservationAccessoryViews(reservation.reservationNumber));
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isClosed = reservation.status === 'cancelled' || reservation.status === 'returned';
  const attachedIds = useMemo(() => new Set(links.map((link) => link.accessoryId)), [links]);
  const selectable = useMemo(
    () => getAccessories().filter((accessory) => isAccessoryBookable(accessory) && !attachedIds.has(accessory.id)),
    [attachedIds],
  );

  const refresh = () => setLinks(getReservationAccessoryViews(reservation.reservationNumber));

  const handleAttach = () => {
    if (!selectedId || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      attachAccessoryCommand({
        reservationNumber: reservation.reservationNumber,
        accessoryId: selectedId,
        idempotencyKey: createSubmissionKey('acc-attach'),
      });
      setSelectedId('');
      refresh();
    } catch (reason: unknown) {
      setError(reason);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDetach = (accessoryId: string, code: string) => {
    if (!window.confirm(`هل تريدين إزالة الملحق ${code} من هذا الحجز؟`)) return;
    setError(null);
    try {
      detachAccessoryCommand(reservation.reservationNumber, accessoryId, createSubmissionKey('acc-detach'));
      refresh();
    } catch (reason: unknown) {
      setError(reason);
    }
  };

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-stone-50/70 p-4" aria-label={`ملحقات الحجز ${reservation.reservationNumber}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-800">الملحقات المرتبطة</h3>
        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200">{links.length}</span>
      </div>

      {error !== null && (
        <div className="mt-3">
          <UserFacingErrorAlert error={error} fallback="تعذر تعديل ملحقات الحجز." />
        </div>
      )}

      {links.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">
                  <span dir="ltr">{link.accessoryCodeSnapshot}</span> — {link.accessoryNameSnapshot}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {link.accessory ? ACCESSORY_CATEGORY_LABELS[link.accessory.category] : 'ملحق محذوف'}
                  {link.rentalPrice > 0 ? ` · تأجير ${formatMoneyOMR(link.rentalPrice)}` : ''}
                  {link.depositAmount > 0 ? ` · تأمين ${formatMoneyOMR(link.depositAmount)}` : ''}
                </p>
                <p className="mt-0.5 text-xs font-bold text-slate-600">
                  {link.returnedAt
                    ? `أُرجع — ${link.returnCondition ? ACCESSORY_RETURN_CONDITION_LABELS[link.returnCondition] : 'سليم'}${link.chargeAmount ? ` · رسوم ${formatMoneyOMR(link.chargeAmount)}` : ''}`
                    : link.deliveredAt
                      ? 'مسلَّم للعميلة'
                      : 'بانتظار التسليم'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {link.accessory && (
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${ACCESSORY_STATUS_STYLES[link.accessory.status]}`}>
                    {ACCESSORY_STATUS_LABELS[link.accessory.status]}
                  </span>
                )}
                {!isClosed && !link.deliveredAt && (
                  <button
                    type="button"
                    onClick={() => handleDetach(link.accessoryId, link.accessoryCodeSnapshot)}
                    aria-label={`إزالة الملحق ${link.accessoryCodeSnapshot} من الحجز`}
                    className={`flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-slate-500">لا توجد ملحقات مرتبطة بهذا الحجز بعد.</p>
      )}

      {!isClosed && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="sr-only">اختيار ملحق لإضافته إلى الحجز</span>
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
            >
              <option value="">اختاري ملحقاً…</option>
              {selectable.map((accessory) => (
                <option key={accessory.id} value={accessory.id}>
                  {accessory.code} — {accessory.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleAttach}
            disabled={!selectedId || isSubmitting}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {isSubmitting ? 'جارٍ الإضافة…' : 'إضافة ملحق'}
          </button>
        </div>
      )}
    </section>
  );
}
