# Final report — operational calendar, accessories, and inventory performance

Stage covering two dependent phases delivered from `main`, each on its own
branch, each merged only after both required CI workflows passed.

| Phase | Branch | PR | Head SHA | Merge SHA | Checks |
| --- | --- | --- | --- | --- | --- |
| 6 — calendar and accessories | `feature/calendar-accessories-20260728` | [#107](https://github.com/mohamedmasoud3030-tech/lenadress/pull/107) | `1def8fb8af41539358bb985eea73489f0e66c652` | `a1ac39d7035ac786473f9a506148634ec432f8fe` | Build #244, Verify #216 |
| 7 — inventory performance reports | `feature/inventory-performance-reports-20260728` | [#108](https://github.com/mohamedmasoud3030-tech/lenadress/pull/108) | `b255f9adae17293d4e9fa8c36e9a14580923b247` | `901e12dffc4f065fde16a21ae77ac9c4d59d102c` | Build #246, Verify #218 |

Workflows: `Build` (`.github/workflows/build.yml`) and `Verify`
(`.github/workflows/verify.yml`, which runs `npm test`, `npm run typecheck`,
`npm run lint`, `npm run build` and the Tauri environment gate).

## 1. What was delivered

### Phase 6 — operational calendar

A real reservation calendar with month, week and day views. Every date is built
through local-time helpers, because the previous `new Date('YYYY-MM-DD')`
pattern is parsed as UTC and could place a booking on the wrong calendar day for
any showroom outside UTC. Bookings carry pickup and return **times**, with
configurable showroom defaults, and those times appear on the calendar, the
reservation cards and the printed contract.

Status colours come from the design system. Opening an entry focuses the
matching booking, which links directly to the customer record and the item page.
Filters cover status, dress, customer and a date range. On phones the seven
column grid is replaced by a stacked agenda; the grid is desktop-only.

### Phase 6 — central conflict rule

`src/features/reservations/reservationConflicts.ts` is now the single definition
of an occupied period. Only active bookings block; cancelled and returned ones
release the item immediately; the window is widened by the configurable
preparation and cleaning days; and a booking never conflicts with itself.

It is enforced in the **service layer** — on creation, date change, item swap,
rental extension and accessory attachment — not only in the UI. `hasReservationOverlap`
delegates to it, so the reservation screen, the service queue and the write path
cannot disagree.

### Phase 6 — accessories

A full accessory family with monotonic never-reused stock codes from the shared
allocator, barcodes derived from those codes, printable labels through the shared
printing boundary, categories, operational states, optional sale/rental/deposit
prices, notes and image. Accessories are retired, never hard-deleted.

Reservation links record what was physically handed over and each accessory's
condition on return — intact, damaged, lost or needs service — with partial
returns as a first-class case. Damage and loss charges are posted as item-linked
expenses through the existing finance path; no parallel ledger exists.

### Phase 7 — inventory performance

A reporting centre at `/inventory-performance` covering both dresses and
accessories: rentals, sales, revenue, discounts, service and damage cost, net
result, occupied days, utilisation, average transaction value, average rental
length, late/damage/loss counts, last use, idle days and turnover.

KPI cards, a sortable detail table, a simple revenue-versus-cost trend, ranked
lists (top, low, idle, service-heavy, chronically late), and a per-item detail
view with bookings, revenue lines, costs and linked accessories. Filters cover
date range, item kind, category, status, operation type, granularity, idle
threshold, search and sort.

## 2. Main files

| Area | Files |
| --- | --- |
| Calendar | `src/features/reservations/reservationCalendar.ts`, `ReservationCalendar.tsx` |
| Conflict rule | `src/features/reservations/reservationConflicts.ts` |
| Reservation writes | `src/features/reservations/reservation.service.ts`, `src/features/workflows/reservationScheduleCommands.ts` |
| Local-time helpers | `src/shared/utils/date.ts` |
| Accessories | `src/features/accessories/*`, `src/features/workflows/accessoryCommands.ts`, `src/shared/domain/accessoryConstants.ts` |
| Shared barcode rule | `src/shared/utils/barcode.ts` |
| Handover | `src/features/delivery-return/deliveryReturn.operations.ts`, `DeliveryAccessoryChecklist.tsx` |
| Reports | `src/features/reports/inventoryPerformance.service.ts`, `inventoryPerformance.types.ts`, `InventoryPerformancePage.tsx`, `InventoryPerformanceDetailPanel.tsx`, `PerformanceTrendChart.tsx` |
| Export | `src/shared/utils/csv.ts`, `src/features/reports/inventoryPerformanceExport.ts` |
| Settings | `src/features/preferences/preferences.service.ts` |
| Docs | `docs/INVENTORY_PERFORMANCE_METRICS.md`, `docs/EXECUTION_CHECKLIST.md`, `docs/RELEASE_NOTES_V1.md`, `docs/RUNTIME_QA.md` |

## 3. New tests

All six suites are wired into the default `npm test` gate, so they run on every
pull request.

| Suite | Tests | Focus |
| --- | --- | --- |
| `tests/reservation-conflicts.test.mjs` | 15 | Creation without conflict, blocked overlap, buffer widening, cancel-then-rebook, returned bookings releasing the item, reschedule into a taken period, self-move, extension conflict, item-swap conflict, accessory conflict, reschedule re-checking accessories, time defaults, service-level time validation |
| `tests/reservation-calendar.test.mjs` | 12 | Local-time helpers and day-boundary safety, Arabic 12-hour labels, month/week/day grids, navigation without drift, entry placement and ordering, cancelled hidden by default, all filters, today marking, derived occupancy |
| `tests/accessory-lifecycle.test.mjs` | 17 | Code and barcode identity, retirement, lookup with normalisation, label escaping, filters, delivery of dress plus accessories, partial delivery, partial return, lost, damaged, forced-failure rollback on delivery and on return, duplicate command protection, double-charge prevention, detach guards, cancel releasing accessories |
| `tests/accessory-backup-integrity.test.mjs` | 9 | Registration, full round trip with handover state and charges, no duplication on repeated restore, counter monotonicity, new settings surviving, legacy preferences inheriting the old buffer, migration markers, rejected backup leaving data intact, price snapshots and accessory cost attribution surviving |
| `tests/inventory-performance.test.mjs` | 19 | No usage, one booking, several bookings, cancelled booking, unpaid booking, late rental, discount from snapshot, sale counted once and reversed by a return, maintenance cost, partial accessory return with a loss, occupancy clipping, date ranges, invalid range, ranking on value, reconciliation against the finance layer, per-item detail, timeline granularity, filters, sorting |
| `tests/inventory-performance-export.test.mjs` | 10 | BOM, column order, every formula trigger, quoting, injected item name, safe filename, period and timestamp in print, escaping and print-only chrome, blocked-popup Arabic failure, single clean print window |

Existing suites extended: `tests/ui-contract.test.mjs` (+6 assertions covering
the calendar, accessory screens and report page for RTL, mobile, accessibility,
design-system colours and the export/print contract) and a shared storage
helper at `tests/helpers/storage.mjs`.

## 4. Financial and operational formulas

Recorded in full in `docs/INVENTORY_PERFORMANCE_METRICS.md`. In brief:

```
occupiedDays    = Σ overlap(booking, [from, to]) over non-cancelled bookings,
                  counting both endpoints
availableDays   = days of the period, reduced when the item was retired
utilisationRate = occupiedDays ÷ availableDays
totalRevenue    = rentalRevenue + saleRevenue           (realised money only)
totalCost       = serviceCost + damageCost              (item-linked expenses)
netResult       = totalRevenue − totalCost
isIdle          = daysSinceLastUse ≥ configurable threshold
rankingScore    = netResult × (0.5 + utilisationRate)
```

Rental revenue is collected rental payments plus settlement fees plus retained
deposits, minus refunds, matched to the item through its reservation. Sale
revenue is sale records minus sale returns. A refundable deposit is never item
revenue. Discounts come from price snapshots taken when the deal was struck
(`listRentalPrice`, `listPrice`) and are reported separately rather than
subtracted from revenue, because they were never collected.

## 5. Data changes

Additive only; no destructive migration was required.

- New registered collections: `accessories`, `reservation-accessories`.
- New optional reservation fields: `pickupTime`, `returnTime`, `listRentalPrice`.
- New optional sale fields: `listPrice` on sale records and invoice lines.
- New optional expense fields: `relatedAccessoryCode`, `relatedAccessoryName`.
- New preferences: `preparationDaysBeforePickup`, `cleaningDaysAfterReturn`,
  `defaultPickupTime`, `defaultReturnTime`.

Existing installations behave correctly without intervention: bookings without
times fall back to the configured defaults, legacy preferences inherit their
stored single buffer for both new windows, and records without a price snapshot
report a zero discount, which is the truthful answer for data captured before
the snapshot existed. A test covers each of these paths.

## 6. Defects found and fixed while building this stage

1. **Date-only values were parsed as UTC.** Calendar cells and day boundaries
   could land one day off outside UTC. All date maths now uses local-time helpers.
2. **Barcode normalisation was about to be duplicated** for accessories; it is
   now defined once and shared, so the two families cannot drift apart.
3. **The invoice sale path carried no catalogue price snapshot**, which would
   have made every reported discount a guess against the current price list.
4. **Tabs were not quoted in CSV output**, which lets some importers split a cell.

## 7. Requires real-device testing

None of the following can be produced in this environment, and none of it is
claimed as done anywhere in the documentation:

- phone testing at 390×844 and at 360×740, per route, including the new calendar
  agenda and the report table;
- a real PWA installation;
- an offline reload of the installed app;
- a Windows Tauri build produced and launched on Windows;
- a real camera barcode scan, for both inventory items and accessories;
- printing a rental contract, a barcode label and an accessory label from a
  physical device and printer;
- printing the inventory performance report and opening the exported CSV in a
  real copy of Excel to confirm the Arabic rendering.

## 8. Is the product feature complete for a first launch?

**Functionally yes; for launch, not yet — and the gap is evidence, not code.**

Every operational capability a single showroom needs for its daily cycle is
implemented, atomic, covered by automated tests and gated by CI: inventory,
accessories, customers, reservations with a real calendar and a central conflict
rule, delivery and return including partial accessory returns, sales and sale
returns, payments and settlements, the service queue, expenses, the daily close,
the audit trail, backup and restore, barcodes and printing, and now inventory
performance and profitability reporting.

What is missing is **physical verification**. Seven items in section 7 remain
unproven, and two of them — the Windows Tauri build and real camera scanning —
could still surface genuine defects rather than cosmetic ones. Until those are
executed and recorded, a launch would be resting on assumptions.

**No release tag was created in this stage, and the tag remains withheld** until
all seven evidence items in section 7 are complete and recorded in
`docs/RUNTIME_QA.md`.
