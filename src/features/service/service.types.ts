import type { DressStatus } from '../dresses/dress.types';

export type ServiceTaskType = 'inspection' | 'laundry' | 'tailoring' | 'maintenance' | 'repair';

export type ServiceTaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';

/** Item states a completed service task may produce. */
export type ServiceOutcomeStatus = Extract<
  DressStatus,
  'available' | 'inspection' | 'laundry' | 'maintenance' | 'damaged' | 'inactive'
>;

export type ServiceTask = {
  id: string;
  taskNumber: string;
  /** Stable item reference; the code is kept only as a historical snapshot. */
  inventoryItemId: string;
  dressCode: string;
  dressName: string;
  type: ServiceTaskType;
  status: ServiceTaskStatus;
  startDate: string;
  expectedCompletionDate?: string;
  completedDate?: string;
  cost: number;
  /** Expense record created for the cost, if any. */
  relatedExpenseNumber?: string;
  /** Item status explicitly chosen when the task was completed. */
  resultingItemStatus?: ServiceOutcomeStatus;
  notes?: string;
};

export type ServiceTaskFilters = {
  search: string;
  type: ServiceTaskType | 'all';
  status: ServiceTaskStatus | 'all';
};

export type ServiceQueueSummary = {
  open: number;
  inProgress: number;
  completedToday: number;
  overdue: number;
};
