export type ExpenseCategory =
  | 'laundry'
  | 'tailoring'
  | 'maintenance'
  | 'purchase'
  | 'rent'
  | 'salary'
  | 'other';

export type ExpensePaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'other';

export type ExpenseRecord = {
  id: string;
  expenseNumber: string;
  expenseDate: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  relatedDressCode?: string;
  relatedDressName?: string;
  /** Set when the cost belongs to an accessory rather than an inventory item. */
  relatedAccessoryCode?: string;
  relatedAccessoryName?: string;
  notes?: string;
};

export type ExpenseFilters = {
  search: string;
  category: ExpenseCategory | 'all';
  paymentMethod: ExpensePaymentMethod | 'all';
};

export type ExpenseSummary = {
  totalExpenses: number;
  laundryExpenses: number;
  serviceExpenses: number;
  purchaseExpenses: number;
  otherExpenses: number;
};
