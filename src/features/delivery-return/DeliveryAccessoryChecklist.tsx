import { Barcode } from 'lucide-react';
import { MIN_ZERO_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { ACCESSORY_RETURN_CONDITION_OPTIONS } from '../../shared/domain/accessoryConstants';
import { AMBER_FOCUS_RING_CLASS_NAME, STACKED_FORM_FIELD_CLASS_NAME } from '../../shared/domain/formConstants';
import { ACCESSORY_RETURN_CONDITION_LABELS } from '../accessories/reservationAccessory.service';
import type { ReservationAccessoryView } from '../accessories/reservationAccessory.service';
import type { AccessoryReturnCondition } from '../accessories/accessory.types';

/**
 * Accessory handover checklist used by the delivery and return screens.
 *
 * On delivery the operator ticks what physically left the showroom; on return
 * they record each accessory's condition and any damage or loss charge. Both
 * lists can be driven by the barcode scanner, which simply toggles the matching
 * row, so a busy counter never has to hunt for the right line.
 */

export type AccessoryReturnState = {
  selected: boolean;
  condition: AccessoryReturnCondition;
  charge: string;
};

type DeliveryProps = {
  mode: 'delivery';
  links: ReservationAccessoryView[];
  selectedIds: string[];
  onToggle: (accessoryId: string) => void;
  onScan: () => void;
};

type ReturnProps = {
  mode: 'return';
  links: ReservationAccessoryView[];
  state: Record<string, AccessoryReturnState>;
  onChange: (accessoryId: string, next: Partial<AccessoryReturnState>) => void;
  onScan: () => void;
};

type Props = DeliveryProps | ReturnProps;

export function DeliveryAccessoryChecklist(props: Props) {
  const relevant = props.mode === 'delivery'
    ? props.links.filter((link) => !link.deliveredAt)
    : props.links.filter((link) => link.deliveredAt && !link.returnedAt);

  const closed = props.mode === 'return'
    ? props.links.filter((link) => link.returnedAt)
    : props.links.filter((link) => link.deliveredAt);

  if (props.links.length === 0) return null;

  return (
    <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="ملحقات الحجز">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-800">
          {props.mode === 'delivery' ? 'الملحقات المسلَّمة فعلياً' : 'حالة الملحقات المسترجعة'}
        </h3>
        <button
          type="button"
          onClick={props.onScan}
          className={`inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <Barcode aria-hidden="true" className="h-4 w-4" />
          مسح باركود ملحق
        </button>
      </div>

      {relevant.length === 0 ? (
        <p className="text-xs text-slate-500">
          {props.mode === 'delivery' ? 'كل ملحقات الحجز مسلَّمة بالفعل.' : 'لا توجد ملحقات خارج المحل لهذا الحجز.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {relevant.map((link) => {
            const rowId = `accessory-${link.accessoryId}`;
            if (props.mode === 'delivery') {
              const checked = props.selectedIds.includes(link.accessoryId);
              return (
                <li key={link.id} className="rounded-xl bg-stone-50 p-3 ring-1 ring-slate-200">
                  <label htmlFor={rowId} className="flex items-center gap-3 text-sm font-bold text-slate-800">
                    <input
                      id={rowId}
                      type="checkbox"
                      checked={checked}
                      onChange={() => props.onToggle(link.accessoryId)}
                      className="h-5 w-5 rounded border-slate-300 text-slate-950 focus-visible:ring-2 focus-visible:ring-amber-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span dir="ltr">{link.accessoryCodeSnapshot}</span> — {link.accessoryNameSnapshot}
                    </span>
                  </label>
                </li>
              );
            }

            const state = props.state[link.accessoryId];
            return (
              <li key={link.id} className="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-slate-200">
                <label htmlFor={rowId} className="flex items-center gap-3 text-sm font-bold text-slate-800">
                  <input
                    id={rowId}
                    type="checkbox"
                    checked={state?.selected ?? false}
                    onChange={() => props.onChange(link.accessoryId, { selected: !(state?.selected ?? false) })}
                    className="h-5 w-5 rounded border-slate-300 text-slate-950 focus-visible:ring-2 focus-visible:ring-amber-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span dir="ltr">{link.accessoryCodeSnapshot}</span> — {link.accessoryNameSnapshot}
                  </span>
                </label>

                {state?.selected && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-xs font-bold text-slate-600">
                      حالة الملحق
                      <select
                        value={state.condition}
                        onChange={(event) => props.onChange(link.accessoryId, { condition: event.target.value as AccessoryReturnCondition })}
                        className={STACKED_FORM_FIELD_CLASS_NAME}
                      >
                        {ACCESSORY_RETURN_CONDITION_OPTIONS.map((condition) => (
                          <option key={condition} value={condition}>{ACCESSORY_RETURN_CONDITION_LABELS[condition]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs font-bold text-slate-600">
                      تكلفة التلف أو الفقد
                      <input
                        type="number"
                        min={MIN_ZERO_AMOUNT}
                        step={MONEY_STEP}
                        inputMode="decimal"
                        value={state.charge}
                        onChange={(event) => props.onChange(link.accessoryId, { charge: event.target.value })}
                        className={STACKED_FORM_FIELD_CLASS_NAME}
                      />
                    </label>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {closed.length > 0 && (
        <p className="text-xs text-slate-500">
          {props.mode === 'delivery'
            ? `${closed.length} ملحقاً مسلَّماً مسبقاً لهذا الحجز.`
            : `${closed.length} ملحقاً تم تسجيل استرجاعه مسبقاً.`}
        </p>
      )}

      {props.mode === 'return' && relevant.length > 0 && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
          الملحقات غير المحددة تبقى خارج المحل ويمكن تسجيل استرجاعها لاحقاً (إرجاع جزئي).
        </p>
      )}
    </section>
  );
}
