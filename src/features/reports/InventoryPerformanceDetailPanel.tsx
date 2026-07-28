import { Modal } from '../../components/shared/Modal';
import { formatMoneyOMR } from '../../shared/utils/format';
import { PerformanceTrendChart } from './PerformanceTrendChart';
import type { InventoryPerformanceDetail } from './inventoryPerformance.types';

const REVENUE_KIND_LABELS = {
  rental: 'تحصيل إيجار',
  fee: 'رسوم',
  retained_deposit: 'عربون محتجز',
  sale: 'بيع',
  sale_return: 'مرتجع بيع',
} as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-stone-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-extrabold text-slate-950">{value}</p>
    </div>
  );
}

/** Full performance history for one item: money, bookings, costs and accessories. */
export function InventoryPerformanceDetailPanel({
  detail,
  onClose,
}: {
  detail: InventoryPerformanceDetail | null;
  onClose: () => void;
}) {
  if (!detail) return null;
  const { row } = detail;

  return (
    <Modal open onClose={onClose} title={`أداء ${row.code} — ${row.name}`} className="max-w-4xl">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="إجمالي الإيراد" value={formatMoneyOMR(row.totalRevenue)} />
          <Stat label="إجمالي التكاليف" value={formatMoneyOMR(row.totalCost)} />
          <Stat label="صافي العائد" value={formatMoneyOMR(row.netResult)} />
          <Stat label="نسبة الإشغال" value={`${(row.utilisationRate * 100).toFixed(1)}%`} />
          <Stat label="مرات التأجير" value={String(row.rentalCount)} />
          <Stat label="متوسط مدة التأجير" value={`${row.averageRentalDays.toFixed(1)} يوم`} />
          <Stat label="مرات التأخير" value={String(row.lateCount)} />
          <Stat label="أيام بدون استخدام" value={row.idleDays === null ? 'لا يوجد استخدام' : String(row.idleDays)} />
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-extrabold text-slate-800">الأداء عبر الزمن</h3>
          <PerformanceTrendChart points={detail.timeline} />
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-extrabold text-slate-800">الحجوزات المرتبطة</h3>
          {detail.reservations.length === 0 ? (
            <p className="text-sm text-slate-500">لا توجد حجوزات في هذه الفترة.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-right text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="p-2">رقم الحجز</th>
                    <th scope="col" className="p-2">العميلة</th>
                    <th scope="col" className="p-2">الفترة</th>
                    <th scope="col" className="p-2">أيام الإشغال</th>
                    <th scope="col" className="p-2">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.reservations.map((line) => (
                    <tr key={line.reservationNumber} className="border-t border-slate-100">
                      <td className="p-2 font-bold text-slate-800">{line.reservationNumber}</td>
                      <td className="p-2">{line.customerName}</td>
                      <td className="p-2 text-xs">{line.pickupDate} — {line.returnDate}</td>
                      <td className="p-2">{line.occupiedDays}</td>
                      <td className="p-2 text-xs font-bold">{line.status}{line.wasLate ? ' · متأخر' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-2">
            <h3 className="text-sm font-extrabold text-slate-800">الإيرادات</h3>
            {detail.revenues.length === 0 ? (
              <p className="text-sm text-slate-500">لا توجد إيرادات محققة في هذه الفترة.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {detail.revenues.map((line) => (
                  <li key={`${line.reference}-${line.kind}`} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 p-2">
                    <span className="min-w-0 truncate text-xs text-slate-600">{REVENUE_KIND_LABELS[line.kind]} · {line.date}</span>
                    <span className={`font-bold ${line.amount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatMoneyOMR(line.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-extrabold text-slate-800">التكاليف والصيانة</h3>
            {detail.costs.length === 0 ? (
              <p className="text-sm text-slate-500">لا توجد تكاليف مسجلة في هذه الفترة.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {detail.costs.map((line) => (
                  <li key={line.reference} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 p-2">
                    <span className="min-w-0 truncate text-xs text-slate-600">{line.title} · {line.date}</span>
                    <span className="font-bold text-rose-700">{formatMoneyOMR(line.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {detail.linkedAccessories.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-extrabold text-slate-800">الملحقات المرتبطة</h3>
            <ul className="flex flex-wrap gap-2 text-xs font-bold">
              {detail.linkedAccessories.map((accessory) => (
                <li key={accessory.code} className="rounded-full bg-violet-50 px-3 py-1 text-violet-700 ring-1 ring-violet-200">
                  {accessory.code} — {accessory.name} ({accessory.times})
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}
