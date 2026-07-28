import { commandBoundary, runCommand } from '@engines/workflows';
import {
  createSaleInvoice,
  recordSaleReturn,
  type SaleInvoice,
  type SaleReturnRecord,
} from '../dresses/salesLedger.service';
import type { SalePaymentMethod } from '../dresses/sale.service';

/**
 * Canonical sales commands.
 *
 * The invoice is the only source of truth for a sale. A "quick sale" is simply
 * an invoice with a single line, so every sale can be reprinted, reopened and
 * line-returned through exactly one path.
 */

export type CreateSaleInvoiceCommandInput = {
  saleDate: string;
  customerName: string;
  customerPhone?: string;
  paymentMethod: SalePaymentMethod;
  lines: Array<{ dressCode: string; amount: number }>;
  notes?: string;
  idempotencyKey?: string;
};

export function createSaleInvoiceCommand(input: CreateSaleInvoiceCommandInput): SaleInvoice {
  const { idempotencyKey, ...invoiceInput } = input;

  return runCommand(
    {
      name: 'sale.create-invoice',
      idempotencyKey,
      summarize: (invoice) => invoice.invoiceNumber,
    },
    () => {
      const invoice = createSaleInvoice(invoiceInput);
      commandBoundary('sale.create-invoice:after-write');
      return invoice;
    },
  );
}

export type QuickSaleCommandInput = {
  saleDate: string;
  customerName: string;
  customerPhone?: string;
  paymentMethod: SalePaymentMethod;
  dressCode: string;
  amount: number;
  notes?: string;
  idempotencyKey?: string;
};

/** A quick sale is a one-line invoice; there is no separate sale path. */
export function quickSaleCommand(input: QuickSaleCommandInput): SaleInvoice {
  const { dressCode, amount, ...rest } = input;
  return createSaleInvoiceCommand({ ...rest, lines: [{ dressCode, amount }] });
}

export type SaleReturnCommandInput = {
  invoiceNumber: string;
  dressCode: string;
  returnDate: string;
  notes?: string;
  idempotencyKey?: string;
};

export function recordSaleReturnCommand(input: SaleReturnCommandInput): SaleReturnRecord {
  const { idempotencyKey, ...returnInput } = input;

  return runCommand(
    {
      name: 'sale.return-line',
      idempotencyKey,
      summarize: (record) => record.returnNumber,
    },
    () => {
      const record = recordSaleReturn(returnInput);
      commandBoundary('sale.return-line:after-write');
      return record;
    },
  );
}
