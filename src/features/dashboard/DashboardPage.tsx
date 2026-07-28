import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeAlert,
  CalendarDays,
  Gem,
  PackageCheck,
  Plus,
  Shirt,
  UsersRound,
  WalletCards,
  Wrench,
} from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Section } from '../../components/shared/Section';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { EmptyState } from '../../components/shared/StateViews';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { RESERVATION_STATUS_LABELS, RESERVATION_STATUS_STYLES } from '../../shared/domain/reservationConstants';
import { formatTimeLabel } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
import { getDashboardSnapshot, isShowroomEmpty, type DashboardTask } from './dashboard.service';

const shortcuts = [
  { to: '/reservations?new=1', label: 'حجز جديد', hint: 'إنشاء حجز', icon: CalendarDays, tone: 'bg-emerald-50 text-emerald-700' },
  { to: '/delivery-return', label: 'تسليم واسترجاع', hint: 'عمليات اليوم', icon: PackageCheck, tone: 'bg-sky-50 text-sky-700' },
  { to: '/payments', label: 'تحصيل دفعة', hint: 'تسجيل مبلغ', icon: WalletCards, tone: 'bg-amber-50 text-amber-700' },
  { to: '/inventory', label: 'المخزون', hint: 'إدارة العناصر', icon: Shirt, tone: 'bg-violet-50 text-violet-700' },
  { to: '/accessories', label: 'الملحقات', hint: 'الطرح والتيجان', icon: Gem, tone: 'bg-fuchsia-50 text-fuchsia-700' },
  { to: '/customers', label: 'العملاء', hint: 'سجل العميلات', icon: UsersRound, tone: 'bg-stone-100 text-slate-700' },
];

function TaskRow({ task }: { task: DashboardTask }) {
  const { reservation } = task;
  return (
    <li>
      <Link
        to={`/reservations?search=${encodeURIComponent(reservation.reservationNumber)}`}
        className={`flex items-center gap-3 rounded-xl bg-stone-50 p-3 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
      >
        <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-xs font-extrabold text-slate-700 ring-1 ring-slate-200">
          {formatTimeLabel(task.time)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-slate-900">{reservation.customerName}</span>
          <span className="block truncate text-xs text-slate-500">
            {reservation.dressCode} — {reservation.dressName}
            {task.accessoryCount > 0 ? ` · ${task.accessoryCount} ملحق` : ''}
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${RESERVATION_STATUS_STYLES[reservation.status]}`}>
          {RESERVATION_STATUS_LABELS[reservation.status]}
        </span>
      </Link>
    </li>
  );
}

function TaskList({ tasks, emptyText }: { tasks: DashboardTask[]; emptyText: string }) {
  if (tasks.length === 0) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return <ul className="space-y-2">{tasks.map((task) => <TaskRow key={`${task.reservation.id}-${task.time}`} task={task} />)}</ul>;
}

export function DashboardPage() {
  const snapshot = useMemo(() => getDashboardSnapshot(), []);
  const empty = useMemo(() => isShowroomEmpty(), []);
  const { money, reservations, service } = snapshot;

  if (empty) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="الرئيسية" title="لوحة التحكم" description="ابدئي بإضافة أول عنصر وأول عميلة، ثم أنشئي أول حجز." />
        <EmptyState
          icon={<Shirt className="h-10 w-10" />}
          title="لم تبدأ بيانات المعرض بعد"
          description="أضيفي أول فستان إلى المخزون، ثم أضيفي عميلة، ثم أنشئي أول حجز. ستمتلئ هذه اللوحة تلقائياً بمهام اليوم والمبالغ المستحقة."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link to="/inventory" className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white ${AMBER_FOCUS_RING_CLASS_NAME}`}>
                <Plus aria-hidden="true" className="h-4 w-4" />
                إضافة أول عنصر
              </Link>
              <Link to="/customers" className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}>
                <UsersRound aria-hidden="true" className="h-4 w-4" />
                إضافة أول عميلة
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="الرئيسية"
        title="لوحة التحكم"
        description="مهام اليوم، المبالغ غير المحصلة، وحالة المخزون والخدمة في مكان واحد."
      />

      {/* Money that has not been collected is the first thing the owner must see. */}
      {money.outstandingCount > 0 && (
        <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <BadgeAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-amber-900">
                  مبالغ غير محصّلة: {formatMoneyOMR(money.outstandingTotal)} على {money.outstandingCount} حجز
                </p>
                {money.outstandingOverdueTotal > 0 && (
                  <p className="mt-1 text-xs font-bold text-rose-800">
                    منها {formatMoneyOMR(money.outstandingOverdueTotal)} على حجوزات انتهت مدتها ولم تُسدَّد.
                  </p>
                )}
              </div>
            </div>
            <Link
              to="/payments"
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white ${AMBER_FOCUS_RING_CLASS_NAME}`}
            >
              تحصيل الآن
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>

          <ul className="mt-3 space-y-1.5">
            {snapshot.outstandingBalances.slice(0, 4).map((row) => (
              <li key={row.reservationNumber} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2 text-xs">
                <span className="min-w-0 truncate font-bold text-slate-800">
                  {row.customerName} · {row.dressCode}
                  {row.isOverdue && <span className="mr-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-800">متأخر</span>}
                </span>
                <span className="shrink-0 font-extrabold text-rose-700">{formatMoneyOMR(row.remainingAmount)}</span>
              </li>
            ))}
            {snapshot.outstandingBalances.length > 4 && (
              <li className="px-3 text-xs font-bold text-amber-800">و{snapshot.outstandingBalances.length - 4} حجزاً آخر…</li>
            )}
          </ul>
        </div>
      )}

      {reservations.overdue > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <p className="text-sm font-extrabold text-rose-900">
            {reservations.overdue} حجز تجاوز موعد الإرجاع ولم يُسترجع بعد.
          </p>
          <Link to="/delivery-return" className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-sm font-bold text-rose-700 ${AMBER_FOCUS_RING_CLASS_NAME}`}>
            تسجيل الاسترجاع
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <SummaryCard label="عمليات اليوم" value={reservations.today} hint={`${snapshot.pickupsToday.length} تسليم · ${snapshot.returnsToday.length} إرجاع`} />
        <SummaryCard label="محصّل اليوم" value={formatMoneyOMR(money.collectedToday)} hint={`صافي ${formatMoneyOMR(money.netToday)}`} tone="positive" />
        <SummaryCard label="غير محصّل" value={formatMoneyOMR(money.outstandingTotal)} tone={money.outstandingTotal > 0 ? 'warning' : 'default'} hint={`${money.outstandingCount} حجز`} />
        <SummaryCard label="متأخرة" value={reservations.overdue} tone={reservations.overdue > 0 ? 'danger' : 'default'} hint="تجاوزت موعد الإرجاع" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="تسليمات اليوم" description="الحجوزات المستحقة للتسليم اليوم مرتبة بالوقت." action={<Link to="/delivery-return" className="text-sm font-bold text-amber-700 hover:text-amber-900">فتح الشاشة</Link>}>
          <TaskList tasks={snapshot.pickupsToday} emptyText="لا توجد تسليمات مجدولة اليوم." />
        </Section>

        <Section title="إرجاعات اليوم" description="القطع المتوقع عودتها اليوم." action={<Link to="/delivery-return" className="text-sm font-bold text-amber-700 hover:text-amber-900">فتح الشاشة</Link>}>
          <TaskList tasks={snapshot.returnsToday} emptyText="لا توجد إرجاعات مجدولة اليوم." />
        </Section>

        {snapshot.overdueReturns.length > 0 && (
          <Section title="إرجاعات متأخرة" description="قطع خارج المحل تجاوزت موعد إرجاعها." className="border-rose-200">
            <TaskList tasks={snapshot.overdueReturns} emptyText="لا توجد إرجاعات متأخرة." />
          </Section>
        )}

        <Section title="حالة المخزون والخدمة">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="text-xs text-slate-500">إجمالي المخزون</dt>
              <dd className="mt-1 text-lg font-extrabold text-slate-950">{snapshot.inventory.total}</dd>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="text-xs text-slate-500">متاح</dt>
              <dd className="mt-1 text-lg font-extrabold text-emerald-700">{snapshot.inventory.available}</dd>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="text-xs text-slate-500">مؤجر حالياً</dt>
              <dd className="mt-1 text-lg font-extrabold text-violet-700">{snapshot.inventory.rented}</dd>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="text-xs text-slate-500">ملحقات متاحة</dt>
              <dd className="mt-1 text-lg font-extrabold text-slate-950">{snapshot.accessories.available}</dd>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="text-xs text-slate-500">ملحقات خارج المحل</dt>
              <dd className="mt-1 text-lg font-extrabold text-amber-700">{snapshot.accessoriesOutCount}</dd>
            </div>
            <div className="rounded-xl bg-stone-50 p-3">
              <dt className="text-xs text-slate-500">حجوزات الأسبوع القادم</dt>
              <dd className="mt-1 text-lg font-extrabold text-slate-950">{reservations.upcomingWeek}</dd>
            </div>
          </dl>

          {(service.open > 0 || service.inProgress > 0) && (
            <Link
              to="/service"
              className={`mt-3 flex items-center gap-3 rounded-xl bg-cyan-50 p-3 text-sm transition hover:bg-cyan-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
            >
              <Wrench aria-hidden="true" className="h-5 w-5 shrink-0 text-cyan-700" />
              <span className="min-w-0 flex-1 font-bold text-cyan-900">
                طابور الخدمة: {service.open} بانتظار البدء · {service.inProgress} قيد التنفيذ
                {service.overdue > 0 ? ` · ${service.overdue} متأخرة` : ''}
              </span>
              <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0 text-cyan-700" />
            </Link>
          )}
        </Section>

        <Section title="اختصارات سريعة">
          <div className="grid gap-3 sm:grid-cols-2">
            {shortcuts.map((shortcut) => (
              <Link
                key={shortcut.to}
                to={shortcut.to}
                className={`flex items-center gap-3 rounded-xl bg-stone-50 p-3 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
              >
                <span className={`rounded-xl p-2.5 ${shortcut.tone}`}>
                  <shortcut.icon aria-hidden="true" className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-slate-900">{shortcut.label}</span>
                  <span className="block truncate text-xs text-slate-500">{shortcut.hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
