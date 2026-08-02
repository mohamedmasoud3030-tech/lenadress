# LENA v1.0 — Business Model and Workflow Contract

> **Status:** Active business source of truth  
> **Tracking issue:** #76  
> **Applies to:** Browser/PWA and Tauri Windows

This document defines what LENA is supposed to do as one connected showroom operating system. Code, tests, reports, and UI must follow these rules. Historical documents and stale PR descriptions do not override this contract.

## 1. Business objective

LENA manages one local occasion-wear showroom from item intake through rental or sale, customer handling, cash movement, operational handover, returns, service, daily closing, reporting, and recovery.

The system is not a generic inventory app. Its central job is to keep five views consistent at all times:

1. **Physical truth:** where each item is and whether it can be used.
2. **Commercial truth:** who reserved or bought it and under which terms.
3. **Financial truth:** what was collected, refunded, retained, or spent.
4. **Operational truth:** what must be delivered, returned, cleaned, repaired, or inspected.
5. **Control truth:** what was changed, by which workflow, and whether the day and backup reconcile.

## 2. Operational departments

### 2.1 Inventory

Inventory contains dresses, accessories, bags, shoes, veils, and other showroom items. An item may be rentable, saleable, both, or neither while inactive.

Every item must have:

- immutable internal ID;
- unique human code and barcode that are never reused;
- purchase cost;
- rental, sale, and deposit terms where applicable;
- physical lifecycle status;
- images and notes;
- historical links to reservations, sales, returns, expenses, and service work.

### 2.2 Customers

Customers store identity, phone, measurements, notes, and a commercial status:

- trusted;
- normal;
- warning;
- blocked.

A blocked customer cannot create a new reservation until the condition is resolved. Historical transactions must remain attached to the same immutable customer ID even if the phone or display name changes.

### 2.3 Reservations and availability

A reservation represents a dated rental commitment for one customer and one item. Availability is calculated from reservation date ranges plus the configured preparation buffer.

A reservation stores both:

- stable references: `customerId` and `inventoryItemId`;
- historical snapshots: customer name/phone and item code/name at the time of booking.

The stable references preserve data integrity. The snapshots preserve historical documents after names or contact details change.

### 2.4 Collections, deposits, fees, and refunds — canonical separation (ADR 0002)

Payment records are an append-only movement ledger. Existing movements are not silently edited or deleted; corrections are represented by explicit adjustment, reversal, or refund movements with reasons.

Money has different business meanings, with explicit Arabic labels and separate storage:

- rental collection (rental_payment): income against rental charge; reduces المتبقي من الإيجار;
- booking advance (booking_advance / دفعة الحجز): money paid in advance toward rental obligation; reduces المتبقي من الإيجار once; not a refundable liability; not refunded through security-deposit settlement; cancellation refundability depends on cancellation policy; must not be counted twice;
- security deposit collection (security_deposit_collection / التأمين المسترد / التأمين المحصل): refundable liability, not rental revenue; does not reduce المتبقي من الإيجار; liability = collected - refunded - retained, never negative;
- late/damage fee (late_fee / damage_fee): assessed revenue;
- retained deposit (security_deposit_retention / التأمين المحتجز): deposit liability converted to cover assessed fees; requires explicit reason; never exceeds available liability;
- security deposit refund (security_deposit_refund / التأمين المسترد للعميلة): cash leaving showroom, reduces liability, does not alter rental revenue;
- refund (rental refund): cash leaving, increases المتبقي من الإيجار;
- sale collection: sale revenue and cash inflow;
- expense: operating cash outflow.

Catalogue default: dresses.defaultSecurityDepositAmount (التأمين المسترد المقترح) replaces ambiguous deposit_amount.

Reports must separate: rental cash, booking advances, security deposits collected/refunded/retained, rental revenue, fee revenue, outstanding refundable liability. Collecting security deposit increases cash and liability, not income. Reports must not call all collected cash “profit” or “revenue”.

Legacy ambiguous depositAmount is preserved as legacyDepositAmount with classification (booking_advance | security_deposit | mixed | unresolved | reviewed) and needsFinancialClassification flag when evidence not clear. Unsafe automated refund/retention blocked until reviewed.

### 2.5 Delivery, return, inspection, and service

Delivery is the controlled handover of a reserved item to the customer. Return is a combined operational and financial workflow:

- confirm the item was handed back;
- assess lateness and damage;
- settle the collected deposit;
- record refund or retained amount;
- close the reservation;
- move the item to its correct physical state;
- create audit evidence.

Returned items do not become automatically available merely because a refund was recorded. They must pass inspection, or an explicit “inspected and ready” decision must be recorded. Otherwise they move to laundry, maintenance, damaged, or inspection/service queue.

### 2.6 Direct sales and sale returns

The invoice is the canonical sale document. A one-item quick sale is a convenience path that creates a one-line invoice; it must not create a second disconnected sales model.

A sale return must:

- identify the original invoice line;
- prevent duplicate return of the same line;
- record the refunded amount and method;
- update reports and daily closing;
- move the physical item to inspection/service, not directly to available;
- preserve the original invoice and return history.

### 2.7 Expenses and item service cost

Expenses may be general operating costs or linked to one inventory item. Laundry, tailoring, maintenance, and purchase costs contribute to item profitability and service history.

### 2.8 Daily closing

Daily closing is a cash-control snapshot, not an income statement. It reconciles by payment method:

- collections;
- refunds;
- expenses;
- expected cash;
- actual cash;
- difference.

Once a day is closed, money-changing operations for that business date are blocked until the day is explicitly reopened with a reason and audit entry.

### 2.9 Reports and audit

Reports are derived from operational ledgers; they are not independent editable totals.

Required views include:

- cash movement;
- rental revenue and outstanding balances;
- deposit liability, refunded deposit, and retained deposit;
- sale revenue and sale returns;
- expenses;
- item utilization and item profitability;
- overdue reservations and operational queue;
- customer balances;
- daily-closing reconciliation.

Audit entries are part of the business operation, not optional logging added after success.

### 2.10 Appointments, landing page, and preferences

Appointments support showroom visits and must participate in backup, restore, reset, and desktop persistence. The public landing page is a read-only presentation layer over approved inventory/showroom profile data and must never expose private customer or financial data. Preferences define business rules such as reservation buffer and dormant-item thresholds.

## 3. Canonical state models

### 3.1 Inventory physical lifecycle

Canonical physical states:

```text
available
rented
inspection
laundry
maintenance
damaged
sold
inactive
```

“Reserved” is a date-range availability condition derived from active reservations; it is not a reliable physical state. An item may be physically available today and reserved for a future date.

Allowed high-level transitions:

```text
available -> rented -> inspection -> available
inspection -> laundry -> available
inspection -> maintenance -> available
inspection -> damaged
available -> sold -> inspection (sale return)
any non-terminal safe state -> inactive
```

`sold` and historically referenced items are not hard-deleted.

### 3.2 Reservation lifecycle

```text
pending -> confirmed -> delivered -> returned
pending/confirmed -> cancelled
pending/confirmed/delivered -> overdue (derived by date)
```

Rules:

- no overlap for the same item across the reservation period plus preparation buffer;
- blocked customers cannot reserve;
- sold, inactive, damaged, laundry, maintenance, or inspection items cannot start a conflicting handover;
- a delivered or overdue reservation is resolved through return, not cancellation;
- a reservation with collected money cannot be cancelled until its financial movements are explicitly settled;
- delivery requires the configured upfront amount to be collected; the release default is full reservation balance, with any override requiring a recorded reason.

### 3.3 Financial movement lifecycle

Financial movements are immutable after posting. Corrections create new linked movements. Every money-changing command has an idempotency key or duplicate-submit guard.

The same atomic command must update:

- the financial movement;
- reservation or invoice balance/state;
- inventory state where applicable;
- audit entry;
- any operational return/delivery record.

If any write fails, all writes roll back to the exact previous snapshot.

## 4. End-to-end workflows

### 4.1 Rental workflow

1. Register an inventory item.
2. Register or select a customer.
3. Check date-range availability and preparation buffer.
4. Create a reservation using stable IDs plus historical snapshots.
5. Collect rental/deposit amounts through the payment ledger.
6. Validate delivery gate and hand over the item.
7. On return, assess lateness/damage and settle the deposit.
8. Close the reservation.
9. Move the item to inspection, laundry, maintenance, damaged, or ready state.
10. Reconcile reports, daily closing, and audit from the same movements.

### 4.2 Sale workflow

1. Select one or more saleable, physically available, unreserved items.
2. Create one invoice with immutable line snapshots.
3. Record the sale collection and mark items sold atomically.
4. Print or reopen the invoice from the sales ledger.
5. For a return, create one return record per invoice line, record the refund, and move the item to inspection.
6. Reflect the return in reports, daily closing, item history, and audit.

### 4.3 Service workflow

1. Item enters inspection, laundry, tailoring/maintenance, or damaged state.
2. Create a service task with expected completion and optional linked expense.
3. Block service scheduling that conflicts with a confirmed future reservation and preparation buffer.
4. Complete or cancel the task with explicit resulting item status.
5. Preserve service and expense history for item profitability.

### 4.4 Backup and recovery workflow

One versioned backup contains every operational collection, metadata, preferences, showroom profile, appointments, invoices, returns, service tasks, audit records, and IndexedDB images.

Import is transactional:

1. validate the complete backup before destructive action;
2. snapshot current collections and images;
3. restore the new collections and images;
4. verify counts, keys, references, and image hashes/sizes;
5. on any failure, restore the exact previous collections and images;
6. report success only after verification.

Tauri snapshots must cover the same canonical data contract as browser backup. Prefix-based mirroring must not omit legacy or detached keys.

## 5. Cross-module invariants

1. No operational entity may bypass the canonical persistence adapter.
2. No hard deletion is allowed after an item/customer has financial or operational history; use archive/inactive status.
3. Human codes and barcodes are unique, monotonic, and never reused after deletion or archive.
4. Historical records store immutable IDs plus display snapshots.
5. Every multi-collection workflow is atomic or compensation-safe.
6. Audit is committed with the business operation.
7. Daily closing reads the same movement ledger used by reports.
8. Item profitability uses realized/recognized money, not merely listed price or an unfulfilled booking.
9. Deposit collections are separated from revenue in financial reporting.
10. Demo data is loaded only through an explicit action; a new production workspace starts empty.
11. Browser, PWA, and Tauri must produce the same business result for the same operation.
12. Backup/restore covers every entity and image that the UI can create.

## 6. Current implementation conflicts found on `main`

These are confirmed from current code and must be corrected before release:

1. `dress.service.ts` stores inventory under `lena_dresses`, outside the central `dress-roomshow:*` adapter and outside the Tauri mirror prefix.
2. `appointment.service.ts` stores appointments under `lena_appointments`, also outside backup/reset/Tauri coverage.
3. The central backup schema exports collection arrays only and omits IndexedDB images.
4. `sales-invoices` and `sales-returns` are used but absent from `REGISTERED_COLLECTIONS`.
5. Core services fall back to mock customers, reservations, payments, expenses, and delivery records on empty storage, so a clean production install can appear to contain real operations.
6. Reservation history stores customer/item snapshots but not immutable customer and item IDs.
7. Inventory codes are generated from `dresses.length + 1`, so deletion can cause code reuse.
8. The UI hard-deletes inventory directly; the existing archive blocker is not wired into the delete path.
9. Payment, return, delivery, sale, invoice, inventory-status, and audit writes occur sequentially without a shared transaction or compensation rollback.
10. Single-item sales and invoice sales are separate command paths; single-item sales can lack invoice/line-return behavior.
11. A sale return moves an item directly to `available` instead of inspection/service.
12. Item performance counts booked `rentalPrice` from every non-cancelled reservation as revenue, even when it was not collected or completed.
13. The current `reserved` inventory status overlaps conceptually with date-derived reservation availability.
14. `timesRented` is displayed but the delivery/return workflow does not maintain it as an authoritative metric.

## 7. Release acceptance model

A workflow is complete only when the same scenario is consistent across:

- source record;
- linked customer and inventory history;
- payment or refund ledger;
- item physical state;
- operational queue;
- audit trail;
- report totals;
- daily closing;
- browser backup/restore;
- Tauri relaunch/restore.

A rendered page or successful isolated write is not sufficient evidence of completion.
