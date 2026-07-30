import { useMemo, useState } from 'react';
import { Plus, Wrench } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { EmptyState } from '../../components/shared/StateViews';
import { getTodayISO } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
import { OpenServiceTaskModal } from './OpenServiceTaskModal';
import { CompleteServiceTaskModal } from './CompleteServiceTaskModal';
import {
  SERVICE_TASK_STATUS_LABELS,
  SERVICE_TASK_TYPE_LABELS,
  filterServiceTasks,
  getServiceTasks,
  summarizeServiceQueue,
} from './service.service';
import type { ServiceTask, ServiceTaskFilters } from './service.types';
import { startServiceTaskCommand } from '../workflows';

const statusStyles: Record<ServiceTask['status'], string> = {
  open: 'bg-amber-50 text-amber-700 ring-amber-200',
  in_progress: 'bg-sky-50 text-sky-700 ring-sky-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const field =
  'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30';

export function ServiceQueuePage() {
  const [tasks, setTasks] = useState<ServiceTask[]>(() => getServiceTasks());
  const [filters, setFilters] = useState<ServiceTaskFilters>({ search: '', type: 'all', status: 'all' });
  const [openModal, setOpenModal] = useState(false);
  const [completingTask, setCompletingTask] = useState<ServiceTask | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const filtered = useMemo(() => filterServiceTasks(tasks, filters), [tasks, filters]);
  const summary = useMemo(() => summarizeServiceQueue(tasks), [tasks]);
  const today = getTodayISO();

  const refresh = (message: string) => {
    setTasks(getServiceTasks());
    setFeedback(message);
    setError(null);
  };

  const handleStart = (task: ServiceTask) => {
    try {
      startServiceTaskCommand(task.id);
      refresh(`بدأ تنفيذ عمل الخدمة ${task.taskNumber}.`);
    } catch (reason: unknown) {
      setError(reason);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          eyebrow="الخدمة والتشغيل"
          title="طابور الخدمة"
        />
        <button
          type="button"
          onClick={() => setOpenModal(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          فتح عمل خدمة
        </button>
      </div>

      {feedback ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{feedback}</p>
      ) : null}
      {error !== null ? <UserFacingErrorAlert error={error} fallback="تعذر تنفيذ العملية." /> : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <SummaryCard label="بانتظار البدء" value={String(summary.open)} />
        <SummaryCard label="قيد التنفيذ" value={String(summary.inProgress)} />
        <SummaryCard label="مكتملة اليوم" value={String(summary.completedToday)} />
        <SummaryCard label="متأخرة" value={String(summary.overdue)} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-bold text-slate-700">
          بحث
          <input
            value={filters.search}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            placeholder="رقم العمل أو كود القطعة"
            className={field}
          />
        </label>
        <label className="text-sm font-bold text-slate-700">
          نوع الخدمة
          <select
            value={filters.type}
            onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value as ServiceTaskFilters['type'] }))}
            className={field}
          >
            <option value="all">كل الأنواع</option>
            {Object.entries(SERVICE_TASK_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-bold text-slate-700">
          الحالة
          <select
            value={filters.status}
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as ServiceTaskFilters['status'] }))}
            className={field}
          >
            <option value="all">كل الحالات</option>
            {Object.entries(SERVICE_TASK_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Wrench className="h-10 w-10" />}
          title={tasks.length === 0 ? 'لا توجد أعمال خدمة بعد' : 'لا توجد أعمال خدمة مطابقة'}
          description={tasks.length === 0
            ? 'افتحي عمل خدمة عند وصول قطعة تحتاج فحصاً أو غسيلاً أو تعديلاً.'
            : 'غيّري البحث أو الفلاتر لعرض نتائج أخرى.'}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => {
            const isOverdue = task.expectedCompletionDate !== undefined
              && task.expectedCompletionDate < today
              && (task.status === 'open' || task.status === 'in_progress');

            return (
              <article key={task.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-slate-400">{task.taskNumber}</p>
                    <h2 className="mt-1 flex items-center gap-2 text-base font-bold text-slate-950">
                      <Wrench className="h-4 w-4" />
                      {SERVICE_TASK_TYPE_LABELS[task.type]} — {task.dressCode}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">{task.dressName}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusStyles[task.status]}`}>
                    {SERVICE_TASK_STATUS_LABELS[task.status]}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-3">
                  <p>البدء: <b>{task.startDate}</b></p>
                  <p>الانتهاء المتوقع: <b>{task.expectedCompletionDate ?? 'غير محدد'}</b></p>
                  <p>التكلفة: <b>{formatMoneyOMR(task.cost)}</b></p>
                </div>

                {isOverdue ? (
                  <p className="mt-2 rounded-xl bg-rose-50 p-2 text-xs font-bold text-rose-700">
                    تجاوز العمل موعد الانتهاء المتوقع.
                  </p>
                ) : null}

                {task.status === 'completed' ? (
                  <p className="mt-2 text-xs text-slate-500">
                    انتهى في {task.completedDate} وتم تحديد حالة القطعة صراحة.
                    {task.relatedExpenseNumber ? ` المصروف المرتبط: ${task.relatedExpenseNumber}.` : ''}
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {task.status === 'open' ? (
                      <button
                        type="button"
                        onClick={() => handleStart(task)}
                        className="min-h-10 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100"
                      >
                        بدء التنفيذ
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setCompletingTask(task)}
                      className="min-h-10 rounded-xl bg-slate-950 px-3 text-sm font-bold text-white transition hover:bg-slate-800"
                    >
                      إنهاء وتحديد حالة القطعة
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <OpenServiceTaskModal
        open={openModal}
        onClose={() => setOpenModal(false)}
        onCreated={(task) => refresh(`تم فتح عمل الخدمة ${task.taskNumber}.`)}
      />
      <CompleteServiceTaskModal
        task={completingTask}
        onClose={() => setCompletingTask(null)}
        onCompleted={(task) => refresh(`تم إنهاء عمل الخدمة ${task.taskNumber} وتحديث حالة القطعة.`)}
      />
    </section>
  );
}
