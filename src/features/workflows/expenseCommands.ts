import { commandBoundary, runCommand } from '@engines/workflows';
import { addExpense } from '../expenses/expense.service';
import type { ExpenseCategory, ExpensePaymentMethod, ExpenseRecord } from '../expenses/expense.types';

/**
 * Expense posting command.
 *
 * Supports general operating expenses and item-linked costs (laundry,
 * tailoring, maintenance, purchase). Item-linked expenses feed the same money
 * source used by the daily close and the profitability reports, so an expense
 * can never be visible in one view and missing in another.
 */

export type PostExpenseCommandInput = {
  expenseDate: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  relatedDressCode?: string;
  notes?: string;
  idempotencyKey?: string;
};

export function postExpenseCommand(input: PostExpenseCommandInput): ExpenseRecord {
  const { idempotencyKey, ...expenseInput } = input;

  return runCommand(
    {
      name: 'expense.post',
      idempotencyKey,
      summarize: (expense) => expense.expenseNumber,
    },
    () => {
      const expense = addExpense(expenseInput);
      commandBoundary('expense.post:after-write');
      return expense;
    },
  );
}
