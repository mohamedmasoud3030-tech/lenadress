import { generateId, generateNumber, readCollection, writeCollection } from '../../services/localDatabase';
import { getTodayISO } from '../../shared/utils/date';
import { recordAudit } from '../audit/audit.service';
import { getAccessories } from '../accessories/accessory.service';
import { getDresses } from '../dresses/dress.service';
import { assertBusinessDateOpen } from '../integrity/integrity.service';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_PAYMENT_METHOD_LABELS } from './expense.constants';
import type {
  ExpenseCategory,
  ExpenseFilters,
  ExpensePaymentMethod,
  ExpenseRecord,
  ExpenseSummary,
} from './expense.types';

const COLLECTION = 'expenses';

type AddExpenseInput = {
  expenseDate: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  relatedDressCode?: string;
  /** Optional accessory attribution, so accessory costs are reportable per item. */
  relatedAccessoryCode?: string;
  notes?: string;
};

export function getExpenses(): ExpenseRecord[] {
  return readCollection<ExpenseRecord>(COLLECTION, []);
}

export function addExpense(input: AddExpenseInput): ExpenseRecord {
  const title = input.title.trim();
  const relatedDress = input.relatedDressCode
    ? getDresses().find((dress) => dress.code === input.relatedDressCode)
    : undefined;

  if (!title) throw new Error('عنوان المصروف مطلوب.');
  if (!input.expenseDate) throw new Error('تاريخ المصروف مطلوب.');
  if (input.expenseDate > getTodayISO()) throw new Error('تاريخ المصروف لا يمكن أن يكون في المستقبل.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('قيمة المصروف يجب أن تكون أكبر من صفر.');
  if (input.relatedDressCode && !relatedDress) throw new Error('العنصر المحدد غير موجود.');
  const relatedAccessory = input.relatedAccessoryCode
    ? getAccessories().find((accessory) => accessory.code === input.relatedAccessoryCode)
    : undefined;
  if (input.relatedAccessoryCode && !relatedAccessory) throw new Error('الملحق المحدد غير موجود.');
  assertBusinessDateOpen(input.expenseDate);

  const expense: ExpenseRecord = {
    id: generateId(),
    expenseNumber: generateNumber('EXP'),
    expenseDate: input.expenseDate,
    title,
    category: input.category,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    relatedDressCode: relatedDress?.code,
    relatedDressName: relatedDress?.name,
    relatedAccessoryCode: relatedAccessory?.code,
    relatedAccessoryName: relatedAccessory?.name,
    notes: input.notes?.trim() || undefined,
  };

  writeCollection(COLLECTION, [expense, ...getExpenses()]);
  recordAudit({ action: 'create', entityType: 'expense', entityId: expense.id, summary: `تم تسجيل المصروف ${expense.expenseNumber}.`, nextValues: { amount: expense.amount, paymentMethod: expense.paymentMethod, expenseDate: expense.expenseDate } });
  return expense;
}

export function filterExpenses(expenses: ExpenseRecord[], filters: ExpenseFilters): ExpenseRecord[] {
  const normalizedSearch = filters.search.trim().toLowerCase();

  return expenses.filter((expense) => {
    const matchesCategory = filters.category === 'all' || expense.category === filters.category;
    const matchesPaymentMethod =
      filters.paymentMethod === 'all' || expense.paymentMethod === filters.paymentMethod;

    if (!normalizedSearch) {
      return matchesCategory && matchesPaymentMethod;
    }

    const matchesSearch =
      expense.expenseNumber.toLowerCase().includes(normalizedSearch) ||
      expense.title.toLowerCase().includes(normalizedSearch) ||
      expense.relatedDressCode?.toLowerCase().includes(normalizedSearch) ||
      expense.relatedAccessoryCode?.toLowerCase().includes(normalizedSearch) ||
      expense.relatedDressName?.toLowerCase().includes(normalizedSearch) ||
      expense.notes?.toLowerCase().includes(normalizedSearch);

    return Boolean(matchesCategory && matchesPaymentMethod && matchesSearch);
  });
}

export function summarizeExpenses(expenses: ExpenseRecord[]): ExpenseSummary {
  return expenses.reduce<ExpenseSummary>(
    (acc, expense) => {
      acc.totalExpenses += expense.amount;

      if (expense.category === 'laundry') {
        acc.laundryExpenses += expense.amount;
      }

      if (expense.category === 'tailoring' || expense.category === 'maintenance') {
        acc.serviceExpenses += expense.amount;
      }

      if (expense.category === 'purchase') {
        acc.purchaseExpenses += expense.amount;
      }

      if (expense.category === 'rent' || expense.category === 'salary' || expense.category === 'other') {
        acc.otherExpenses += expense.amount;
      }

      return acc;
    },
    {
      totalExpenses: 0,
      laundryExpenses: 0,
      serviceExpenses: 0,
      purchaseExpenses: 0,
      otherExpenses: 0,
    },
  );
}

export function formatExpenseCategoryLabel(category: ExpenseCategory): string {
  return EXPENSE_CATEGORY_LABELS[category];
}

export function formatExpensePaymentMethodLabel(method: ExpensePaymentMethod): string {
  return EXPENSE_PAYMENT_METHOD_LABELS[method];
}
