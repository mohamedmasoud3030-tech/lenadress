import { generateId, generateNumber, readCollection, writeCollection } from '../../services/localDatabase';
import { getTodayISO } from '../../shared/utils/date';
import { recordAudit } from '../audit/audit.service';
import { getDresses, updateDressStatus } from '../dresses/dress.service';
import { addExpense } from '../expenses/expense.service';
import type { ExpenseCategory } from '../expenses/expense.types';
import { getAppPreferences } from '../preferences/preferences.service';
import { getReservations } from '../reservations/reservation.service';
import type {
  ServiceQueueSummary,
  ServiceTask,
  ServiceTaskFilters,
  ServiceTaskStatus,
  ServiceTaskType,
  ServiceOutcomeStatus,
} from './service.types';
import { createSearchMatcher } from '../../shared/utils/search';

/**
 * Phase 4 — the service workflow.
 *
 * An item coming back from a rental or a sale return is never "available" by
 * default. It enters the service queue and only an explicit completion decision
 * sets its next state. Service work is also blocked when it would collide with
 * a confirmed upcoming reservation once the preparation buffer is applied.
 */

const COLLECTION = 'service-tasks';

const OPEN_STATUSES = new Set<ServiceTaskStatus>(['open', 'in_progress']);

const SERVICE_ITEM_STATUS: Record<ServiceTaskType, ServiceOutcomeStatus> = {
  inspection: 'inspection',
  laundry: 'laundry',
  tailoring: 'maintenance',
  maintenance: 'maintenance',
  repair: 'maintenance',
};

const SERVICE_EXPENSE_CATEGORY: Record<ServiceTaskType, ExpenseCategory> = {
  inspection: 'other',
  laundry: 'laundry',
  tailoring: 'tailoring',
  maintenance: 'maintenance',
  repair: 'maintenance',
};

export const SERVICE_TASK_TYPE_LABELS: Record<ServiceTaskType, string> = {
  inspection: 'فحص',
  laundry: 'غسيل',
  tailoring: 'تعديل وخياطة',
  maintenance: 'صيانة',
  repair: 'إصلاح',
};

export const SERVICE_TASK_STATUS_LABELS: Record<ServiceTaskStatus, string> = {
  open: 'بانتظار البدء',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

export type OpenServiceTaskInput = {
  dressCode: string;
  type: ServiceTaskType;
  startDate: string;
  expectedCompletionDate?: string;
  notes?: string;
};

export type CompleteServiceTaskInput = {
  taskId: string;
  completedDate: string;
  cost: number;
  resultingItemStatus: ServiceOutcomeStatus;
  notes?: string;
};

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return getTodayISO(date);
}

export function getServiceTasks(): ServiceTask[] {
  return readCollection<ServiceTask>(COLLECTION, []);
}

export function filterServiceTasks(tasks: ServiceTask[], filters: ServiceTaskFilters): ServiceTask[] {
  const matchesQuery = createSearchMatcher(filters.search);
  return tasks.filter((task) => {
    const matchesSearch = matchesQuery([task.taskNumber, task.dressCode, task.dressName]);
    const matchesType = filters.type === 'all' || task.type === filters.type;
    const matchesStatus = filters.status === 'all' || task.status === filters.status;
    return matchesSearch && matchesType && matchesStatus;
  });
}

export function summarizeServiceQueue(tasks: ServiceTask[]): ServiceQueueSummary {
  const today = getTodayISO();
  return {
    open: tasks.filter((task) => task.status === 'open').length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    completedToday: tasks.filter((task) => task.status === 'completed' && task.completedDate === today).length,
    overdue: tasks.filter(
      (task) => OPEN_STATUSES.has(task.status) && task.expectedCompletionDate !== undefined && task.expectedCompletionDate < today,
    ).length,
  };
}

/**
 * Explains why service work on this item would clash with a confirmed booking,
 * accounting for the preparation buffer.
 */
export function getServiceConflictBlockers(dressCode: string, startDate: string, expectedCompletionDate?: string): string[] {
  const buffer = getAppPreferences().reservationBufferDays;
  const serviceEnd = expectedCompletionDate ?? startDate;

  return getReservations()
    .filter((reservation) => reservation.dressCode === dressCode
      && ['pending', 'confirmed'].includes(reservation.status)
      && addDays(reservation.pickupDate, -buffer) <= serviceEnd
      && startDate <= addDays(reservation.returnDate, buffer))
    .map((reservation) => `يتعارض العمل مع الحجز ${reservation.reservationNumber} (${reservation.pickupDate} إلى ${reservation.returnDate}) بعد احتساب أيام التجهيز.`);
}

export function openServiceTask(input: OpenServiceTaskInput): ServiceTask {
  const dress = getDresses().find((item) => item.code === input.dressCode);
  if (!dress) throw new Error('العنصر المحدد غير موجود.');
  if (dress.status === 'rented') throw new Error('لا يمكن بدء خدمة على عنصر مؤجر لم يُسترجع بعد.');
  if (dress.status === 'sold') throw new Error('لا يمكن بدء خدمة على عنصر مباع.');
  if (!input.startDate) throw new Error('تاريخ بدء الخدمة مطلوب.');
  if (input.expectedCompletionDate && input.expectedCompletionDate < input.startDate) {
    throw new Error('تاريخ الانتهاء المتوقع لا يمكن أن يسبق تاريخ البدء.');
  }

  const openTask = getServiceTasks().find((task) => task.dressCode === dress.code && OPEN_STATUSES.has(task.status));
  if (openTask) throw new Error(`يوجد عمل خدمة مفتوح على هذا العنصر بالفعل (${openTask.taskNumber}).`);

  const blockers = getServiceConflictBlockers(dress.code, input.startDate, input.expectedCompletionDate);
  if (blockers.length > 0) throw new Error(blockers.join(' '));

  const task: ServiceTask = {
    id: generateId(),
    taskNumber: generateNumber('SRV'),
    inventoryItemId: dress.id,
    dressCode: dress.code,
    dressName: dress.name,
    type: input.type,
    status: 'open',
    startDate: input.startDate,
    expectedCompletionDate: input.expectedCompletionDate,
    cost: 0,
    notes: input.notes?.trim() || undefined,
  };

  writeCollection(COLLECTION, [task, ...getServiceTasks()]);
  updateDressStatus(dress.code, SERVICE_ITEM_STATUS[input.type]);
  recordAudit({
    action: 'create',
    entityType: 'dress',
    entityId: task.id,
    summary: `تم فتح عمل ${SERVICE_TASK_TYPE_LABELS[task.type]} ${task.taskNumber} للعنصر ${task.dressCode}.`,
    previousValues: { status: dress.status },
    nextValues: { status: SERVICE_ITEM_STATUS[input.type], taskType: task.type, startDate: task.startDate },
  });
  return task;
}

export function startServiceTask(taskId: string): ServiceTask {
  const tasks = getServiceTasks();
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error('عمل الخدمة المحدد غير موجود.');
  if (task.status !== 'open') throw new Error('لا يمكن بدء هذا العمل في حالته الحالية.');

  const updated: ServiceTask = { ...task, status: 'in_progress' };
  writeCollection(COLLECTION, tasks.map((item) => (item.id === taskId ? updated : item)));
  recordAudit({
    action: 'status-change',
    entityType: 'dress',
    entityId: task.id,
    summary: `بدأ تنفيذ عمل الخدمة ${task.taskNumber}.`,
    previousValues: { status: task.status },
    nextValues: { status: updated.status },
  });
  return updated;
}

/**
 * Completing a task requires an explicit resulting item status. Nothing becomes
 * available implicitly.
 */
export function completeServiceTask(input: CompleteServiceTaskInput): ServiceTask {
  const tasks = getServiceTasks();
  const task = tasks.find((item) => item.id === input.taskId);
  if (!task) throw new Error('عمل الخدمة المحدد غير موجود.');
  if (!OPEN_STATUSES.has(task.status)) throw new Error('تم إغلاق عمل الخدمة هذا بالفعل.');
  if (!input.completedDate) throw new Error('تاريخ إنهاء العمل مطلوب.');
  if (input.completedDate < task.startDate) throw new Error('تاريخ الإنهاء لا يمكن أن يسبق تاريخ البدء.');
  if (!Number.isFinite(input.cost) || input.cost < 0) throw new Error('تكلفة الخدمة غير صالحة.');
  if (!input.resultingItemStatus) throw new Error('حددي حالة العنصر بعد انتهاء الخدمة.');

  let relatedExpenseNumber: string | undefined;
  if (input.cost > 0) {
    const expense = addExpense({
      expenseDate: input.completedDate,
      title: `${SERVICE_TASK_TYPE_LABELS[task.type]} — ${task.dressCode}`,
      category: SERVICE_EXPENSE_CATEGORY[task.type],
      amount: input.cost,
      paymentMethod: 'cash',
      relatedDressCode: task.dressCode,
      notes: `تكلفة عمل الخدمة ${task.taskNumber}.`,
    });
    relatedExpenseNumber = expense.expenseNumber;
  }

  const updated: ServiceTask = {
    ...task,
    status: 'completed',
    completedDate: input.completedDate,
    cost: input.cost,
    relatedExpenseNumber,
    resultingItemStatus: input.resultingItemStatus,
    notes: input.notes?.trim() || task.notes,
  };

  writeCollection(COLLECTION, tasks.map((item) => (item.id === input.taskId ? updated : item)));
  updateDressStatus(task.dressCode, input.resultingItemStatus);
  recordAudit({
    action: 'status-change',
    entityType: 'dress',
    entityId: task.id,
    summary: `تم إنهاء عمل الخدمة ${task.taskNumber} للعنصر ${task.dressCode}.`,
    previousValues: { status: task.status },
    nextValues: { status: updated.status, cost: updated.cost, resultingItemStatus: input.resultingItemStatus },
  });
  return updated;
}

export function cancelServiceTask(taskId: string, reason: string): ServiceTask {
  const tasks = getServiceTasks();
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error('عمل الخدمة المحدد غير موجود.');
  if (!OPEN_STATUSES.has(task.status)) throw new Error('لا يمكن إلغاء عمل خدمة مغلق.');
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error('سبب إلغاء عمل الخدمة مطلوب.');

  const updated: ServiceTask = { ...task, status: 'cancelled', notes: normalizedReason };
  writeCollection(COLLECTION, tasks.map((item) => (item.id === taskId ? updated : item)));
  recordAudit({
    action: 'cancel',
    entityType: 'dress',
    entityId: task.id,
    summary: `تم إلغاء عمل الخدمة ${task.taskNumber}.`,
    previousValues: { status: task.status },
    nextValues: { status: updated.status, reason: normalizedReason },
  });
  return updated;
}
