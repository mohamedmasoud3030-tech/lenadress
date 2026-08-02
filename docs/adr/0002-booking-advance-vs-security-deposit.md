# ADR 0002 — Separate booking advance from refundable security deposit

Date: 2026-08-02
Status: Accepted
Related: BUSINESS_MODEL.md, SUPABASE_SCHEMA_GAP_ANALYSIS.md, financial-correctness skill

## Context

The application historically used `depositAmount`, `deposit_amount`, and Arabic label "العربون" ambiguously across:

- reservation headers and contract lines
- dress catalogue `dresses.deposit_amount`
- payments (`type: 'deposit'`)
- returns (`deposit_refund_amount`)
- reports, daily close, printing, backups, Supabase

This caused:

1. Security deposit (refundable liability) reducing rental remaining balance — rental receivable included deposit.
2. Booking advance (money toward rental) being mixed into deposit settlement flow.
3. Reports and daily close sometimes treating deposit cash as revenue or double-counting.
4. Refund and retention sharing ambiguous `depositAmount`.
5. Legacy backups containing only `depositAmount` with no classification.
6. Contract printing using one Arabic term "العربون" for two different financial concepts.

Business requirement: keep five truths consistent (physical, commercial, financial, operational, control). Financial truth requires clear separation of cash movement, rental revenue, and deposit liability.

## Definitions — canonical

### Booking advance

- Canonical name: `bookingAdvanceAmount` / `bookingAdvanceCollectedAmount`
- Arabic: دفعة الحجز
- Meaning: money paid in advance toward rental obligation
  - Reduces outstanding rental receivable exactly once
  - Is not a refundable security-deposit liability
  - Must not be refunded through security-deposit settlement flow
  - Cancellation refundability depends on cancellation policy, not security-deposit rules
  - Must not be counted twice as both booking advance and normal rental payment
  - Remains distinguishable from later rental payments in reports and audit

### Refundable security deposit

- Canonical name: `securityDepositAmount`, `securityDepositCollectedAmount`, `securityDepositRefundedAmount`, `securityDepositRetainedAmount`
- Arabic: التأمين المسترد, التأمين المحصل, التأمين المحتجز, التأمين المسترد للعميلة
- Meaning: refundable customer money held against damage, delay, loss, or approved charges
  - Remains liability until refund or approved retention: `collected - refunded - retained`, never negative
  - Does not reduce outstanding rental receivable
  - Does not become revenue when collected
  - May only be retained through explicit settlement linked to assessed fees, with reason
  - Cannot be refunded or retained more than once; over-refund and over-retention rejected
  - Refund does not alter rental revenue or rental paid amount

### Catalogue default

- Old: `dresses.deposit_amount`
- New canonical: `defaultSecurityDepositAmount`
- Meaning: suggested refundable deposit for a piece, not a payment or liability
- Same for accessories: `defaultSecurityDepositAmount`

## Accounting treatment

### Rental balance formula (canonical)

```
rentalTotal = sum(lines.rentalPrice)
remainingRental = max(
  rentalTotal
  + assessedFees
  - bookingAdvanceCollected
  - rentalCollected
  - retainedDeposit (covers fees)
  + rentalRefunded,
  0
)
```

- Security deposit collected does NOT appear in this formula except via retained (covers fees).
- Booking advance collected DOES reduce remaining.
- Rental collected reduces remaining.
- Retained deposit reduces remaining because it covers fees.
- Rental refunded increases remaining.

Old formula: `totalAmount + fees - paid - settledDeposit + refunded` mixed rental+deposit.

### Security-deposit liability

```
liability = max(collected - refunded - retained, 0)
availableForRefund = liability
```

- Invariant: liability never negative.
- Collection: increases cash and liability, not income.
- Refund: reduces cash and liability, not rental revenue, not rental paid.
- Retention: reduces liability, requires reason, converts retained portion to fee revenue, leaves remaining refundable intact.
- Reporting: liability shown as "التأمين المسترد (التزام)".

### Booking advance

- Cash in, rental revenue (or separate booking advance revenue), reduces rental receivable.
- Not liability, not part of deposit settlement totals.
- Distinguishable in reports: `bookingAdvanceCollected`, `bookingAdvanceRevenue`.
- Idempotent via command log; duplicate retry does not duplicate financial effect.

### Revenue recognition

Preserved: rental revenue recognized when rental_payment or booking_advance collected, not when booking created. Security deposit never rental revenue; only retained portion becomes fee income.

## Settlement rules

On return:

1. Assess lateFee + damageFee.
2. Compute available liability.
3. retained = min(available, late+damage)
4. refund = available - retained
5. settledDepositAmount = securityDepositAmount (closes required obligation)
6. Post movements:
   - late_fee (settlement)
   - damage_fee (settlement)
   - deposit_settlement (closing, legacy)
   - security_deposit_retention (retained, with retentionReason)
   - security_deposit_refund (refund, cash out)
7. Update reservation:
   - assessedFees += late+damage
   - securityDepositRefunded += refund
   - securityDepositRetained += retained
   - remainingRental recomputed via canonical formula

Over-refund and over-retention rejected with Arabic errors.

Duplicate idempotency key blocked via command log.

## Legacy classification policy

Existing depositAmount values potentially ambiguous. Never silently classify every historical value as one category.

Deterministic classification only when evidence clear:

- Evidence for security_deposit:
  - matching security-deposit collection/refund/retention events
  - explicit return settlement data (depositRefundAmount, lateFee, damageFee)
  - payment-type history containing deposit_settlement, retained_deposit, security_deposit_*, refund source return
  - settledDepositAmount >0

- Evidence for booking_advance:
  - new canonical payment type booking_advance exists (old backups don't have this)
  - no security settlement evidence

When meaning cannot be determined confidently:

- preserve original value as legacyDepositAmount
- mark record as needsFinancialClassification = true
- legacyDepositClassification = 'unresolved'
- classificationReason = explanation
- do not destroy source value
- expose in admin review list via getReservationsNeedingFinancialClassification()
- prevent unsafe automated refund/retention until reviewed (throw in settle path)

Classification states:

- booking_advance
- security_deposit
- mixed (future, when one reservation has both types in lines)
- unresolved
- reviewed

Migration:

- idempotent, repeatable, non-destructive
- runs via financialDepositMigration, guarded by migration marker
- backfills defaultSecurityDepositAmount from deposit_amount for dresses/accessories
- backfills securityDepositAmount and bookingAdvanceAmount for contract lines
- for reservations: if settlement evidence => security_deposit, else unresolved
- preserves legacyDepositAmount
- safe when interrupted and rerun (snapshot rollback)

Fixtures: old backups with only depositAmount still import, flagged unresolved.

## Migration consequences

### Local persistence

- Storage schema version 1 -> 2
- Backup schema version 2 -> 3
- New backups preserve canonical values: securityDepositAmount, bookingAdvanceAmount, collected/refunded/retained, defaultSecurityDepositAmount
- Old backups import, flagged for review
- Restoring same backup does not duplicate payments or settlement records (idempotency via command log and unique index on payments.idempotency_key)
- No historical payment, refund, retention event discarded

### Supabase migration 0014

Additive, idempotent:

- dresses: add default_security_deposit_amount, backfill, non-negative check
- reservations: add booking_advance_amount, security_deposit_amount, security_deposit_collected/refunded/retained, legacy_deposit_amount, legacy_deposit_classification, needs_financial_classification, classification_reason, classified_at, classified_by
- payments: add booking_advance_amount, security_deposit_amount, retention_reason, idempotency_key; unique index on (reservation_id, idempotency_key) where not null
- returns: add security_deposit_refund/retained/collected, retention_reason
- Checks: non-negative, refunded+retained <= collected, classification enum check
- Preserve RLS, no policy drop, no trigger drop (refresh_reservation_payment_totals still works for legacy)
- Rollback: drop added columns and indexes, legacy deposit_amount remains
- No silent classification: existing rows marked unresolved, needs review

## Non-goals

- canonical rental_contracts table (later phase)
- canonical rental_contract_lines table (later)
- full Supabase source-of-truth migration (later)
- full append-only financial ledger redesign (later, unified ledger)
- full offline outbox
- multi-device synchronization
- PostgreSQL exclusion constraints (range)
- complete atomic RPC suite (small RPC not needed here)
- deletion of Tauri source files
- broad UI redesign

Dependencies documented but not implemented here.

## Files and models changed

- types: Dress, Accessory, Reservation, ContractLine, PaymentRecord
- helpers: contractLineHelpers (securityDeposit, bookingAdvance)
- services: reservation.service (rental outstanding excludes deposit), payment.service (canonical types, liability checks), finance.service (separate categories), dress.service, accessory.service
- persistence: financialDepositMigration, collectionRegistry version bump, persistenceEngine backup version bump
- Supabase: 0014 migration
- UI: CreateReservationModal (breakdown: rental, booking advance, security deposit, cash to collect), AddPaymentModal (distinct types, liability preview), PaymentsPage (separate summary cards), DeliveryReturnModal (وسيلة رد التأمين المسترد, liability preview), ReportsPage (separate booking advance and security deposit sections), printRentalContract (distinct Arabic labels, breakdown)
- tests: booking-advance-vs-security-deposit, updates to finance-reconciliation, workflow-commands, domain-constants, persistence-engine, capability-recovery, multi-item-contracts, inventory-performance

## Financial invariants enforced and tested

1. booking advance reduces rental balance
2. security deposit does not reduce rental balance
3. collection creates refundable liability
4. full refund
5. partial refund
6. partial retention + refund
7. full retention with fees
8. over-refund rejected
9. over-retention rejected
10. duplicate retry does not duplicate
11. cancellation independent of deposit settlement
12. daily close classification separates categories
13. recognized-income classification excludes liability
14. customer balance reconciliation excludes deposit
15. multi-item calculation remains correct
16. legacy single-item compatibility
17. legacy backup import
18. unresolved classification
19. reviewed classification
20. contract and receipt labels distinct
21. no canonical runtime use of ambiguous depositAmount (architecture test via explicit canonical fields)
22. security deposit liability formula never negative

## Remaining work for canonical contract-lines phase

- Introduce canonical rental_contracts and rental_contract_lines tables in Supabase
- Full append-only financial_movements ledger replacing mutable payments table
- Atomic RPCs for multi-step workflows with serialization safety
- Exclusion constraint for overlap protection instead of trigger
- Complete offline outbox and idempotency store
- Server-side backup target and storage capacity management
- Final removal of legacy depositAmount after all clients migrated and reviewed
