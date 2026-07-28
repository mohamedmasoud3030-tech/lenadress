import { commandBoundary, runCommand } from '@engines/workflows';
import { closeDay, reopenDay } from '../reports/report.service';
import type { DayCloseRecord } from '../reports/report.types';

/**
 * Daily close is a cash-control snapshot, not a profit report.
 *
 * After a close, every money-changing command for that business date is
 * rejected by `assertBusinessDateOpen`; only an explicit reopen with a recorded
 * reason lifts the block, and both actions write audit inside the boundary.
 */

export type CloseDayCommandInput = {
  businessDate: string;
  openingCash: number;
  actualCash: number;
  notes?: string;
  idempotencyKey?: string;
};

export function closeDayCommand(input: CloseDayCommandInput): DayCloseRecord {
  const { idempotencyKey, ...closeInput } = input;

  return runCommand(
    {
      name: 'daily-close.close',
      idempotencyKey,
      summarize: (closing) => closing.businessDate,
    },
    () => {
      const closing = closeDay(closeInput);
      commandBoundary('daily-close.close:after-write');
      return closing;
    },
  );
}

export function reopenDayCommand(id: string, reason: string, idempotencyKey?: string): DayCloseRecord {
  return runCommand({ name: 'daily-close.reopen', idempotencyKey }, () => {
    const reopened = reopenDay(id, reason);
    commandBoundary('daily-close.reopen:after-write');
    return reopened;
  });
}
