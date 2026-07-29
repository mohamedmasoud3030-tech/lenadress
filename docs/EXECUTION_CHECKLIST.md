# LENA v1.0 — Execution Checklist

> **Status:** Active operational queue  
> **Tracking:** GitHub Issue #76  
> **Rule:** The first unchecked, unblocked item in **Current execution queue** is the next agent's assignment.

This file converts the delivery plan into visible execution state. It does not replace `BUSINESS_MODEL.md`, `FINAL_DELIVERY_PLAN.md`, or `TARGET_CODE_ARCHITECTURE.md`.

## Completion marks

- `[x]` means the change is merged into `main`, required CI is green, and the evidence link is recorded.
- `[ ] **IN PROGRESS**` means an active branch or PR exists. It is not complete.
- `[ ] **NEXT**` means this is the first unblocked assignment after the active item.
- `[ ] **PENDING**` means ordered work that must not start before earlier dependencies.
- `[ ] **BLOCKED**` must include the exact blocker and the evidence required to unblock it.

An implementation, local command, draft PR, or written plan is not enough to mark `[x]`.

## Agent takeover protocol

Every agent entering the repository must:

1. start from latest `main` and inspect open PRs and CI;
2. read this checklist before selecting work;
3. continue the existing **IN PROGRESS** PR when it matches the current task;
4. otherwise take the first **NEXT** item without skipping ahead;
5. use one bounded branch and PR;
6. update this checklist in the same PR with state, PR link, exact checks, and remaining work;
7. mark `[x]` only after merge and green CI;
8. leave the next unfinished item explicitly marked **NEXT**.

## Current execution queue

### Phase 0.5A — Architecture guardrails

Completed by [PR #80](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/80).  
Merge SHA: `3cf83a47fe87520414e5327251567267ea06f72f`

- [x] **0.5A-01:** Added `@app`, `@modules`, `@engines`, `@platform`, and `@shared` aliases to TypeScript.
  - Evidence: exact mappings exist in `tsconfig.json`.
- [x] **0.5A-02:** Added the same aliases to Vite.
  - Evidence: development and production resolution use the same target roots.
- [x] **0.5A-03:** Added an automated architecture test.
  - Evidence: guarded target roots reject forbidden dependency directions, private cross-module imports, direct runtime/storage access outside `platform`, and imports back into legacy roots.
- [x] **0.5A-04:** Added the architecture test to the default `npm test` gate.
- [x] **0.5A-05:** Recorded the verified mixed-responsibility baseline in `ARCHITECTURE_BASELINE.md`.
- [x] **0.5A-06:** Added this checklist to the mandatory agent reading order and README.
- [x] **0.5A-07:** Final PR head passed Build #181 and Verify #149, including tests, TypeScript, lint, build, and Tauri environment gate.
- [x] **0.5A-08:** Squash-merged PR #80 as `3cf83a47fe87520414e5327251567267ea06f72f`.

**Exit met:** future target-architecture code cannot silently introduce reversed dependencies or direct platform access, and every agent has one visible next task.

### Phase 0.5B — App shell decomposition

Completed by [PR #80](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/80).

- [x] **0.5B-01:** Added route/shell characterization coverage before completing the layout migration.
- [x] **0.5B-02:** Moved navigation configuration to `src/app/shell/navigation.ts` without changing labels, paths, or ordering.
- [x] **0.5B-03:** Extracted `useDesktopPersistenceStatus`.
- [x] **0.5B-04:** Extracted `AppHeader`.
- [x] **0.5B-05:** Extracted `DesktopNavigation`.
- [x] **0.5B-06:** Extracted `MobileNavigation` and `MobileMoreMenu`.
- [x] **0.5B-07:** Replaced legacy layout composition with `AppShell`; `src/components/layout/AppLayout.tsx` remains a compatibility export.
- [x] **0.5B-08:** Characterization tests and final CI verified unchanged route composition, navigation order, outlet/error boundary, persistence warning contract, mobile-menu close behavior, and retained RTL/focus classes.
  - Manual phone/tablet/desktop browser evidence remains explicitly tracked in Phase 4 and was not claimed by this refactor PR.

**Exit met:** the app shell composes bounded pieces and contains no showroom business rules.

### Phase 0.5C — Router ownership

Completed by [PR #82](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/82).  
Merge SHA: `fd4ca7f333fcad59a7b79a3dbbf6fa49236c8fb3`

- [x] **0.5C-01:** Extracted route composition, lazy page registry, and loading fallback under `src/app/router` while preserving every current URL and 404 behavior.
- [x] **0.5C-02:** Kept current top-level page exports behind `routePages.ts` as a temporary compatibility facade; module internals were not migrated in this PR.
- [x] **0.5C-03:** Router characterization verified lazy inventory details, landing page, shell routes, route ordering, loading copy, and 404 behavior.
  - Evidence: Build #184 and Verify #152 passed on the final PR head.

**Exit met:** `src/app/App.tsx` is now bootstrap-only and route ownership is isolated under `src/app/router`.

## Phase 1 queue — Data identity, safety, and unified persistence

Do not start these before Phase 0.5A is merged. Shell/router work may proceed only in bounded PRs that do not overlap the same files.

### Persistence/platform foundation

- [x] **1.01:** Introduced `StoragePort` and `BrowserLocalStorageAdapter` under `platform/storage` without changing saved data, keys, schema version, backup format, in-memory fallback, or public local-database APIs.
  - Evidence: [PR #83](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/83), merge `dc5122b90af0bcc3ef5d1961787ddcb2a5833f9a`, Build #188, Verify #156.
- [x] **1.02:** Moved dynamic Tauri invoke loading to `platform/runtime` and desktop snapshot synchronization/status to `platform/desktop`; retained `src/services/desktopDatabase.ts` as a compatibility re-export.
  - Evidence: [PR #84](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/84), merge `65f929700ae102ea72c3c68f3688f70576c181df`, Build #192, Verify #160.
  - Limitation: `tauri -- info` passed, but compatible Windows build/install/relaunch evidence remains Phase 4 and is not claimed here.
- [x] **1.03:** Introduced the persistence engine and canonical operational collection registry.
  - Evidence: [PR #85](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/85), merge `6c889327bcf9fe1a98039c9d083da3fd9fad98b3`; verified by `test:persistence-engine`, `test:architecture`, and full test suite; `src/services/localDatabase.ts` retained as a compatibility re-export without changing keys, JSON structure, or schema version.
- [x] **1.04:** Registered appointments, sales invoices, sale returns, service tasks, audit, preferences, images, and every UI-created entity.
  - Evidence: [PR #86](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/86), merge `bc8e86c15cfee1a91f1881cc0014f60b1f54b297`.
- [x] **1.05:** Added transaction/snapshot primitives used by migrations, backup, restore, reset, and later workflow commands.
  - Evidence: [PR #87](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/87), merge `71b4bc9bc71df50453ec46e1cc48c81f717b8036`.

### Legacy data migration

- [x] **1.06:** Migrated `lena_dresses` exactly once into canonical inventory storage without duplication.
  - Evidence: [PR #88](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/88), merge `0ac2e983c8942f951e2cdf984db08552198c0599`.
- [x] **1.07:** Migrated `lena_appointments` exactly once into canonical appointment storage without duplication.
  - Evidence: [PR #89](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/89), merge `6107b93b134dfd2ed97d437b7ea658d385830df3`.
- [x] **1.08:** Preserved temporary legacy service exports cleanly until all callers migrate.
  - Evidence: [PR #90](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/90), merge `dffa1c2f34d176c3f70dd6c80477c486d4e089a6`.
- [x] **1.09:** Added migration markers, retry behavior, and exact rollback on failure.
  - Evidence: [PR #91](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/91), merge `d0030ef0632b72dfa7b8baab2a0c510772735f22`.

### Backup, images, and recovery

- [x] **1.10:** Versioned the backup schema and included IndexedDB image blobs.
  - Evidence: [PR #92](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/92), merge `f7e3a1b6ea3916851a4f51d15aa893fc6ef1cf93`; introduced `exportDatabaseBackupAsync` / `importDatabaseBackupAsync` with versioned schema (`CURRENT_BACKUP_SCHEMA_VERSION = 2`) and exact image rollback.
- [x] **1.11:** Make export/import asynchronous where image access requires it.
  - Evidence: [PR #92](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/92), merge `f7e3a1b6ea3916851a4f51d15aa893fc6ef1cf93`.
- [x] **1.12:** Validate the full backup before mutation.
  - Evidence: [PR #92](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/92), merge `f7e3a1b6ea3916851a4f51d15aa893fc6ef1cf93`.
- [x] **1.13:** Restore the exact prior collections and images after any forced import failure.
  - Evidence: [PR #92](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/92), merge `f7e3a1b6ea3916851a4f51d15aa893fc6ef1cf93`.
- [x] **1.14:** Keep valid legacy collection-only backups importable.
  - Evidence: [PR #92](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/92), merge `f7e3a1b6ea3916851a4f51d15aa893fc6ef1cf93`.
- [x] **1.15:** Verified browser reset and restore across every registered collection.
  - Evidence: `tests/backup-integrity.test.mjs`; Tauri Windows relaunch remains 4.04 and is documented in `docs/RUNTIME_QA.md`.
  - Reality: automated coverage exists in `tests/persistence-engine.test.mjs`; real Tauri Windows relaunch evidence remains Phase 4 (4.04).

### Identity and production startup

- [x] **1.16:** Removed automatic mock fallback data from production startup.
  - Evidence: [PR #93](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/93), merge `6cc44047189ac71322252f30df6d5a532d93736a`.
- [x] **1.17:** Added explicit confirmed demo-data loading and reversible reset.
  - Evidence: [PR #94](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/94), merge `eb8af6d`; introduced `loadConfirmedDemoData` / `revertDemoDataToPreviousSnapshot` in `@engines/persistence/demoData.ts` backed by clean `demoDataRecords.ts`.
- [x] **1.18:** Added immutable customer and inventory references while preserving display snapshots.
  - Evidence: [PR #96](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/96), merge `b44ee5a`.
- [x] **1.19:** Replaced length-based inventory codes with a monotonic collision-safe allocator.
  - Evidence: [PR #97](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/97); durable `counters` collection, `retired-codes` ledger, reconciliation after restore/migration, `tests/inventory-codes-and-archive.test.mjs`.
- [x] **1.20:** Archive referenced inventory/customers instead of hard-deleting them.
  - Evidence: [PR #97](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/97); `archiveDress`/`archiveCustomer`, hard-delete blockers across reservations, sales, invoices, returns, payments, expenses, delivery/return and service tasks, plus Arabic UI explanation on the item page.

**Phase 1 exit:** no supported operation creates data omitted from backup/restore or desktop persistence, and historical relations do not depend only on mutable phone/code values.

## Phase 2 queue — Atomic workflows and financial correctness

- [x] **2.01:** Reservation create/cancel command with audit in the same transaction boundary.
  - Evidence: `@engines/workflows/commandRunner.ts` + `src/features/workflows/reservationCommands.ts`; `tests/workflow-commands.test.mjs`.
- [x] **2.02:** Payment, refund, fee, adjustment, and deposit-settlement commands (atomic, duplicate-guarded).
  - Evidence: `src/features/workflows/paymentCommands.ts`; forced-failure ledger/balance rollback tests.
- [x] **2.03:** Delivery and return commands with inventory/service transitions.
  - Evidence: `src/features/workflows/deliveryReturnCommands.ts`; a returned item can no longer become `available` directly and must pass inspection/laundry/maintenance/damaged.
- [x] **2.04:** Canonical sale invoice and sale-line return/refund commands; quick sale is now a one-line invoice.
  - Evidence: `src/features/workflows/salesCommands.ts`; sale returns route the item to `inspection` and the legacy `sales-returns` collection is folded into the registered `sale-returns` exactly once.
- [x] **2.05:** Expense posting command (general and item-linked).
  - Evidence: `src/features/workflows/expenseCommands.ts`.
- [x] **2.06:** Daily close and explicit reopen commands with post-close money blocking.
  - Evidence: `src/features/workflows/dailyCloseCommands.ts`; tests prove expenses and sales are rejected after the close.
- [x] **2.07:** Forced-failure tests after every command write boundary proving exact rollback.
  - Evidence: [PR #106](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/106), merge `7d8eb9c5789f1494bbd9aed831af8a85fece5f9a`, Build #241, Verify #213; `tests/workflow-commands.test.mjs`, `tests/sales-and-close-commands.test.mjs`, and `tests/phase-2-07-rollback-completeness.test.mjs` prove reservation, payment, delivery, return, sale, sale-line return, expense and daily-close failures restore the exact previous state and leave idempotency keys retryable.
- [x] **2.08:** Separated rental revenue, sale revenue, deposit liability, fees, expenses, net cash movement and recognised profitability.
  - Evidence: `src/features/finance/finance.service.ts` is now the single money interpretation; reports project it instead of computing their own numbers.
- [x] **2.09:** Reconciled operational records, reports and daily close for the same scenarios.
  - Evidence: `tests/finance-reconciliation.test.mjs`; deposits are liabilities, unfulfilled bookings earn nothing, sale returns reduce revenue everywhere, and the close counts the same cash movements.

## Phase 3 queue — Selective capability recovery

- [x] **3.01:** Reservation calendar rebuilt against the current public APIs.
  - Evidence: `src/features/reservations/reservationCalendar.ts` + `ReservationCalendar.tsx`; occupancy is derived from reservations and dates, never from a stored `reserved` flag.
- [x] **3.02:** Printable rental contract through a shared printing boundary.
  - Evidence: `@platform/printing` owns every popup/print call; `printRentalContract.ts` prints historical snapshots and states that the deposit is refundable.
- [x] **3.03:** Inspection, laundry, tailoring, maintenance and damage service queue.
  - Evidence: `src/features/service/*` with a reachable `/service` route; tasks carry stable item ids, block conflicts with confirmed bookings plus the preparation buffer, post their cost as an item-linked expense, and require an explicit resulting item status. `tests/service-workflow.test.mjs`.
- [x] **3.04:** Reachable sales ledger and sale-return history.
  - Evidence: `/sales` route and navigation entry; the page was previously implemented but unreachable.
- [x] **3.05:** Stable barcode labels and current-architecture lifecycle helpers.
  - Evidence: [PR #105](https://github.com/mohamedmasoud3030-tech/dress-roomshow/pull/105), merge `9f08b0c38b4d1050af8a481659a781c2ab9035b8`, Build #238, Verify #210; item-code-derived barcode identity, normalized legacy/manual/camera lookup, escaped shared-boundary printing, canonical realised-money lifecycle panel, and `tests/barcode-lifecycle.test.mjs` in the default gate.

Never merge PR #62 wholesale.

## Phase 6 queue — Operational calendar and accessories

Completed by [PR #107](https://github.com/mohamedmasoud3030-tech/lenadress/pull/107).
Head SHA: `1def8fb8af41539358bb985eea73489f0e66c652`. Merge SHA: `a1ac39d7035ac786473f9a506148634ec432f8fe`.
Required checks: Build #244 and Verify #216, both green on the final head.

- [x] **6.01:** Operational reservation calendar with month, week and day views.
  - Implementation: `src/features/reservations/reservationCalendar.ts` builds every grid from local-time helpers; `ReservationCalendar.tsx` renders the desktop grid and a phone agenda.
  - Evidence: `tests/reservation-calendar.test.mjs` (12 tests) in the default gate.
- [x] **6.02:** Central reservation conflict rule shared by every write path.
  - Implementation: `src/features/reservations/reservationConflicts.ts`; create, reschedule, item swap, extension and accessory attach all resolve through it.
  - Evidence: `tests/reservation-conflicts.test.mjs` (15 tests) in the default gate.
- [x] **6.03:** Configurable preparation-before-pickup and cleaning-after-return windows.
  - Implementation: `preferences.service.ts` splits the legacy single buffer and keeps existing installations on their stored value.
- [x] **6.04:** Accessory catalogue with stable stock codes, derived barcodes and printable labels.
  - Implementation: `src/features/accessories/*`, `@platform/printing` label path, `shared/utils/barcode.ts`.
  - Evidence: `tests/accessory-lifecycle.test.mjs` (17 tests) in the default gate.
- [x] **6.05:** Accessories linked to reservations across delivery, return, partial return, damage and loss.
  - Implementation: `reservationAccessory.service.ts`; charges post through the existing expense/finance path, never a parallel ledger.
- [x] **6.06:** Backup and restore coverage for accessories, links, handover state, charges and the new settings.
  - Evidence: `tests/accessory-backup-integrity.test.mjs` (9 tests) in the default gate.

## Phase 7 queue — Inventory performance and profitability reports

Completed by [PR #108](https://github.com/mohamedmasoud3030-tech/lenadress/pull/108).
Head SHA: `b255f9adae17293d4e9fa8c36e9a14580923b247`. Merge SHA: `901e12dffc4f065fde16a21ae77ac9c4d59d102c`.
Required checks: Build #246 and Verify #218, both green on the final head.

- [x] **7.01:** Per-item performance metrics for dresses and accessories.
  - Evidence: `tests/inventory-performance.test.mjs` (19 tests) in the default gate.
  - Implementation: `src/features/reports/inventoryPerformance.service.ts` computes rentals, sales, revenue, discounts, service/damage cost, net result, occupied days, utilisation, average transaction value, average rental length, late/damage/loss counts, last use, idle days and turnover.
  - Every figure is read from the operational and finance layers, never aggregated from a screen.
- [x] **7.02:** Documented, unambiguous definitions for every metric.
  - Implementation: `docs/INVENTORY_PERFORMANCE_METRICS.md` records the source of truth and the exact formula for each figure.
- [x] **7.03:** Provable discounts through price snapshots.
  - Implementation: reservations store `listRentalPrice` and sale lines store `listPrice`, so a concession is recorded when it is granted instead of inferred from a later catalogue price.
- [x] **7.04:** Filters, KPI cards, sortable table, trend chart, ranked lists and a per-item detail view.
  - Implementation: `InventoryPerformancePage.tsx`, `InventoryPerformanceDetailPanel.tsx`, `PerformanceTrendChart.tsx`, reachable at `/inventory-performance`.
- [x] **7.05:** CSV and print export with UTF-8 BOM and formula-injection protection.
  - Implementation: `src/shared/utils/csv.ts` and `inventoryPerformanceExport.ts`; printing uses the shared boundary with full escaping.
  - Evidence: `tests/inventory-performance-export.test.mjs` (10 tests) covering the BOM, every formula trigger, injected item names, escaping and the blocked-popup path.
- [x] **7.06:** Accessory costs attributable to the accessory itself.
  - Implementation: expenses carry `relatedAccessoryCode`; the accessory return workflow now stamps it on every damage and loss charge.

## Phase 8 queue — UX hardening from real-device feedback

Completed by [PR #110](https://github.com/mohamedmasoud3030-tech/lenadress/pull/110) (merge `044b0ccd177b74708f84d9efc19fa48f55388940`, Build #250 + Verify #222)
and [PR #111](https://github.com/mohamedmasoud3030-tech/lenadress/pull/111) (merge `16599a78e760cafdacf05597d50740604bfa1e87`, Build #252 + Verify #224).
Full analysis: `docs/UX_HARDENING_REPORT.md`.

- [x] **8.01:** Printing no longer traps the operator in a chromeless popup.
  - Root cause: `window.open` in a standalone PWA has no back button. Documents now render in a dismissible in-app overlay with three exits.
- [x] **8.02:** iOS no longer force-zooms when a field is focused.
  - Root cause: controls rendered at 14px. They now render at 16px on touch devices, without locking zoom.
- [x] **8.03:** The page no longer drifts sideways while scrolling.
  - Root cause: `overflow-x: hidden` does not stop touch overscroll. Both axes are now pinned.
- [x] **8.04:** Dialogs stay stable when the software keyboard opens.
  - Root cause: a `position: fixed` body lock. The sheet now follows `visualViewport`.
- [x] **8.05:** The dashboard reports uncollected money and the day's actual work.
  - Evidence: `tests/dashboard-operations.test.mjs` (11 tests) in the default gate.
- [x] **8.06:** Shared form, section and filter primitives replace per-page markup.
  - Evidence: ten new contract assertions in `tests/ui-contract.test.mjs`.
- [x] **8.07:** Eleven unreported defects found by auditing the same paths were fixed.
  - Including three unguarded write modals, two `Math.random()` identifier sources, missing appointment validation, and unlabelled filter controls. Each has a guardrail test.

## Phase 9 queue — Designs, variants and interface depth

Completed by [PR #113](https://github.com/mohamedmasoud3030-tech/lenadress/pull/113) (merge `ca61067f8f07cb44c0d5bf8bf38d2b672e41c386`, Build #256 + Verify #228).
Full analysis: `docs/DRESS_DESIGNS_AND_VARIANTS.md`.

- [x] **9.01:** Model the same design existing in several sizes and colours.
  - The piece stays the unit of truth; a design is a grouping above it with its own separate code counter. Evidence: `tests/dress-designs.test.mjs` (20 tests).
- [x] **9.02:** Design availability resolves through the existing central conflict rule.
  - No second definition of an occupied period was introduced; buffers, damaged pieces and per-period checks all fall out of the shared rule.
- [x] **9.03:** No migration required for existing inventory.
  - The design link is optional, so one-off and pre-existing pieces keep working untouched. Covered by test.
- [x] **9.04:** Searchable, clearable pickers replace native selects for long lists.
  - Reservations, payments, delivery/return, quick sale and the sale invoice.
- [x] **9.05:** Grid/list view switching and group-by-design on the inventory page.
- [x] **9.06:** Visual pass — tinted surfaces, a deeper canvas, visible form fields.
  - Root cause of the "pale, all white" report: every tile faded `to-white` on a near-white page.
- [x] **9.07:** Summary tiles are 2-up on phones on every page.
  - `ReportsPage` was the remaining single-column page. Enforced by a contract test.

## Phase 10 queue — Design management, design reporting and customer follow-up

Completed by [PR #115](https://github.com/mohamedmasoud3030-tech/lenadress/pull/115) (merge `a42436864f1da52c6dfc963e410cb3306e43bf3f`, Build #260 + Verify #232).
Analysis: `docs/DRESS_DESIGNS_AND_VARIANTS.md`, `docs/CUSTOMER_REMINDERS.md`.

- [x] **10.01:** Design detail page with period-aware availability at `/designs/:code`.
- [x] **10.02:** Add sizes, colours and copies to a design after it was created.
- [x] **10.03:** Link an already-existing piece to a design, so current stock can be grouped.
  - The command existed and was tested in Phase 9 but had no UI, so the feature only helped stock added afterwards.
- [x] **10.04:** Design performance in the reports, summed from per-piece rows.
  - Utilisation is pooled across pieces so one busy piece cannot hide idle ones. Evidence: `tests/design-performance.test.mjs` (6 tests).
- [x] **10.05:** Grid/list view switching extended to accessories and customers.
- [x] **10.06:** The printed contract identifies the exact piece by size and colour.
- [x] **10.07:** Customer reminders for pickup, return, overdue items and unpaid balances.
  - Derived, never stored; dismissals expire daily. Evidence: `tests/reminders-whatsapp.test.mjs` (13 tests).
- [x] **10.08:** WhatsApp hand-off with prepared Arabic messages and number normalisation.
  - Deliberately a reviewed hand-off, not an automatic send: see `docs/CUSTOMER_REMINDERS.md` section 4.

## Phase 4 queue — Runtime QA

- [x] **4.01:** Desktop browser workflow evidence.
  - Evidence: `docs/RUNTIME_QA.md` section 2 with the automated gate matrix and the daily journey walkthrough.
- [ ] **NEXT — 4.02:** Phone evidence at 390×844 and 360×740.
  - Automated: overflow, safe area, modal scrolling and tap targets are enforced by `tests/ui-contract.test.mjs`. Outstanding: device capture per route.
- [x] **4.03:** PWA manifest, icons, bundled Arabic font and offline shell verified from real build output.
  - Evidence: `tests/pwa-build-contract.test.mjs`. Fixed two real defects: dropped font `@import`s and a service worker that precached neither fonts nor a navigation fallback. Manual on-device install remains outstanding.
- [ ] **PENDING — 4.04:** Compatible Tauri Windows build, install, launch, relaunch, persistence, backup, restore, and printing.
- [ ] **PENDING — 4.05:** Real-device camera/barcode test with manual fallback.
- [x] **4.06:** Popup-blocked print recovery and storage-failure recovery.
  - Evidence: `tests/capability-recovery.test.mjs` and `tests/backup-integrity.test.mjs`.
- [x] **4.07:** RTL, keyboard focus, accessible labels, modal scrolling and no horizontal overflow.
  - Evidence: `tests/ui-contract.test.mjs` enforces the RTL shell, the 320px overflow guards, modal focus trapping and body scrolling, unified Arabic Empty/Loading/Error states, accessible labels on icon-only controls, duplicate-submit guards, and navigation reachability for the whole daily journey.

## Phase 5 queue — Release and handover

- [x] **5.01:** Release candidate audited from current `main`.
  - Evidence: `tests/release-gate.test.mjs` turns all twelve launch claims into executable assertions.
- [ ] **PENDING — 5.02:** Windows build verification in a compatible environment.
- [ ] **PENDING — 5.03:** PWA manifest, icons, cache, offline startup, and bundled Arabic font verification.
- [x] **5.04:** Installation, empty-start, demo-data, backup/recovery, upgrade and rollback guides.
  - Evidence: `docs/OPERATIONS_GUIDE.md` (Arabic, showroom-facing).
- [x] **5.05:** Release notes and honest known limitations.
  - Evidence: `docs/RELEASE_NOTES_V1.md`, including the nine defects found during delivery and the outstanding runtime evidence.
- [ ] **BLOCKED — 5.06:** Release tag withheld. No tag was created in this stage. It stays blocked until all seven real-device evidence items are executed and recorded in `docs/RUNTIME_QA.md`:
  1. phone testing at 390×844;
  2. phone testing at 360×740;
  3. a real PWA installation;
  4. an offline reload of the installed app;
  5. a Windows Tauri build produced and launched on Windows;
  6. a real camera barcode scan;
  7. printing a rental contract and barcode/accessory labels from a physical device.

## Deferred Phase 0 cleanup

- [ ] **BLOCKED:** Remove one-off root shell scripts, tracked build metadata, and stale archives only after repository search and CI prove they are unreferenced.
  - Unblock evidence: path inventory, no callers in maintained scripts/workflows/docs, clean build and tests after deletion.

## Evidence log

| Item | PR / commit | Required checks | Runtime evidence | State |
| --- | --- | --- | --- | --- |
| Source-of-truth documents | PR #77 | Build + Verify | Documentation only | Complete |
| Focused agent skills | PR #78 | Build + Verify | Documentation only | Complete |
| Target architecture contract | PR #79 / `befefeaaeb842f70d8ddcf7b065e49b882bbe76d` | Build #160 + Verify #128 | Documentation only | Complete |
| Mobile summary cards 2×2 | PR #81 / `9ca10a65d7bf11d18ae121b4ad067bfaee30d2dd` | Build #165 + Verify #133 | Five summary grids; no business logic changed | Complete |
| Phase 0.5A guardrails + 0.5B app shell | PR #80 / `3cf83a47fe87520414e5327251567267ea06f72f` | Build #181 + Verify #149 | Characterization coverage; visual styling intentionally unchanged; device matrix remains Phase 4 | Complete |
| Phase 0.5C router ownership | PR #82 / `fd4ca7f333fcad59a7b79a3dbbf6fa49236c8fb3` | Build #184 + Verify #152 | Static router characterization; no visual or business behavior changed | Complete |
| Phase 1.01 platform storage | PR #83 / `dc5122b90af0bcc3ef5d1961787ddcb2a5833f9a` | Build #188 + Verify #156 | Exact key/JSON contract and persistence-error regressions; no migration | Complete |
| Phase 1.02 platform desktop/runtime | PR #84 / `65f929700ae102ea72c3c68f3688f70576c181df` | Build #192 + Verify #160 | Four desktop behavior scenarios + ownership contract; Windows relaunch remains Phase 4 | Complete |
| Phase 1.03 persistence engine & registry | PR #85 / `6c889327bcf9fe1a98039c9d083da3fd9fad98b3` | Build + Verify | Persistence engine registry & storage delegation characterization; no migration | Complete |
| Phase 1.04 register operational collections | PR #86 / `bc8e86c15cfee1a91f1881cc0014f60b1f54b297` | Build + Verify | Register appointments, sales invoices, returns, service tasks, audit, and images | Complete |
| Phase 1.05 transaction & snapshot primitives | PR #87 / `71b4bc9bc71df50453ec46e1cc48c81f717b8036` | Build + Verify | Snapshot creation/restoration & atomic compensated transaction rollback | Complete |
| Phase 1.06 migrate legacy inventory storage | PR #88 / `0ac2e983c8942f951e2cdf984db08552198c0599` | Build + Verify | Migrate lena_dresses exactly once into canonical inventory storage without duplication | Complete |
| Phase 1.07 migrate legacy appointment storage | PR #89 / `6107b93b134dfd2ed97d437b7ea658d385830df3` | Build + Verify | Migrate lena_appointments exactly once into canonical appointment storage without duplication | Complete |
| Phase 1.08 preserve legacy service delegates | PR #90 / `dffa1c2f34d176c3f70dd6c80477c486d4e089a6` | Build + Verify | Convert all concrete services in `src/services/` into pure compatibility re-export delegates | Complete |
| Phase 1.09 migration markers & retry rollback | PR #91 / `d0030ef0632b72dfa7b8baab2a0c510772735f22` | Build + Verify | Add migration markers, retry behavior, and exact rollback on failure | Complete |
| Phase 1.10-1.14 versioned backup schema & images | PR #92 / `f7e3a1b6ea3916851a4f51d15aa893fc6ef1cf93` | Build + Verify | Versioned backup schema, async export/import, full validation, and exact image rollback | Complete (1.15 runtime evidence deferred to 4.04) |
| Phase 1.16 remove production mock fallback | PR #93 / `6cc44047189ac71322252f30df6d5a532d93736a` | Build + Verify | Default operational queries to empty arrays instead of injecting mock data | Complete |
| Phase 1.17 confirmed demo data & reversible reset | PR #94 / `eb8af6dcb` | Build + Verify | Explicit confirmed demo loading (`loadConfirmedDemoData`) with pre-demo snapshot rollback | Complete |
| Phase 1.18 immutable references & display snapshots | PR #96 / `b44ee5a` | Build + Verify | Stable `customerId`/`inventoryItemId` on reservations, idempotent backfill migration, non-destructive snapshot rollback | Complete |
| Phase 2.07 rollback completeness | PR #106 / `7d8eb9c5789f1494bbd9aed831af8a85fece5f9a` | Build #241 + Verify #213 | Forced delivery and sale-return failures restore all linked operational, financial, audit and idempotency state | Complete |
| Phase 3.05 barcode labels and lifecycle helpers | PR #105 / `9f08b0c38b4d1050af8a481659a781c2ab9035b8` | Build #238 + Verify #210 | Shared-boundary print failure, stable lookup/identity, canonical lifecycle projection; real camera remains 4.05 | Complete |
| Phase 6 calendar and accessories | PR #107 / `a1ac39d7035ac786473f9a506148634ec432f8fe` | Build #244 + Verify #216 | Month/week/day calendar on local time, central conflict rule enforced in the service layer, accessory catalogue with derived barcodes, accessory delivery/return/partial-return/damage/loss, backup coverage; real-device evidence remains 4.02/4.04/4.05 | Complete |
| Phase 7 inventory performance reports | PR #108 / `901e12dffc4f065fde16a21ae77ac9c4d59d102c` | Build #246 + Verify #218 | Per-item realised-money metrics with documented formulas, provable discounts via price snapshots, ranked lists, per-item detail, CSV with BOM and injection guard, escaped print through the shared boundary | Complete |
| Phase 8 UX hardening | PR #110 / `044b0cc`, PR #111 / `16599a7` | Build #250 + Verify #222, Build #252 + Verify #224 | In-app print overlay, 16px touch controls, pinned overscroll, viewport-aware dialogs, operational dashboard with uncollected money, shared form/filter primitives, eleven audit fixes | Complete (device confirmation remains 4.02) |
| Phase 9 designs and variants | PR #113 / `ca61067f8f07cb44c0d5bf8bf38d2b672e41c386` | Build #256 + Verify #228 | Design/variant model resolved through the shared conflict rule, no migration needed, searchable pickers, grid/list views, visual system pass, 2-up tiles everywhere | Complete (device confirmation remains 4.02) |
| Phase 10 designs, reporting and reminders | PR #115 / `a42436864f1da52c6dfc963e410cb3306e43bf3f` | Build #260 + Verify #232 | Design page with period availability, later variants, piece linking, pooled design performance, grid/list everywhere, piece identity on the contract, derived reminders with expiring dismissals, WhatsApp deep-link hand-off | Complete (real-device WhatsApp confirmation outstanding) |
