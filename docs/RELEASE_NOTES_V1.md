# LENA v1.0 — Release Candidate notes

Arabic-first, RTL, local-first operating system for **one** showroom.
Targets: browser / PWA and Tauri Windows. No SaaS tenancy, no multi-branch, no
user roles, no online payments.

## What this release is

The application keeps five truths consistent and enforces that with tests:

1. **Physical truth** — item state, location and readiness.
2. **Commercial truth** — who booked or bought what, on which terms and dates.
3. **Financial truth** — what was collected, refunded, retained or spent.
4. **Operational truth** — what must be delivered, returned, inspected, washed or repaired.
5. **Control truth** — what changed, why, and whether reports, the daily close and the backup agree.

## Highlights

### Data identity and history
- Reservations, delivery/return and sales records carry stable `customerId` and
  `inventoryItemId` plus historical display snapshots. History no longer depends
  on a mutable phone number or item code.
- Inventory codes come from a durable monotonic allocator. A code is never
  reused after deletion, archiving, migration or restore.
- Anything with operational or financial history is archived, never hard
  deleted, with an Arabic explanation of the exact blockers.

### Atomic operations
- Every multi-write operation (reservation, payment, delivery, return, sale,
  sale return, expense, daily close, service) runs as one atomic command with a
  snapshot rollback, an idempotency key against duplicate submits, and its audit
  entry written inside the same boundary.
- Forced-failure tests prove exact rollback after every write boundary.

### Financial correctness
- A refundable deposit is a **liability**, never revenue. Only a retained
  deposit becomes income.
- Gross collected, net cash movement and recognised income are separate values.
- Item profitability is computed from realised money; an unfulfilled booking
  contributes nothing.
- Reports, the daily close and the ledger read the same movements.

### Operations
- Returned items pass through inspection, laundry, maintenance or damaged. They
  never become available implicitly.
- A real service queue with a conflict guard against confirmed bookings plus the
  preparation buffer, an explicit completion outcome, and cost posted as an
  item-linked expense.
- The invoice is the only sale path; a quick sale is a one-line invoice.
- After a daily close, money changes for that date are refused until an explicit
  reopen with a recorded reason.

### Interface
- Arabic-first RTL, mobile-first, no horizontal overflow at 320px.
- Unified Empty / Loading / Error states, modal focus trapping and body
  scrolling, safe-area handling, accessible labels, duplicate-submit protection.

### Operational calendar and accessories (Phase 6, PR #107)
- A real reservation calendar with month, week and day views, built entirely on
  local-time date helpers so a booking never lands on the wrong day for a
  showroom off UTC.
- Status colouring comes from the design system; a test fails the build on any
  hardcoded colour in the calendar or accessory screens.
- Pickup and return **times**, not just dates, on the calendar, the reservation
  cards and the printed contract, with configurable showroom defaults.
- One central conflict rule (`reservationConflicts.ts`) enforced in the service
  layer for booking creation, date changes, item swaps, rental extensions and
  accessory attachment. The UI only previews it.
- Configurable preparation-before-pickup and cleaning-after-return windows;
  existing installations inherit their previous single buffer value.
- A full accessory catalogue — veils, crowns, belts, bags, gloves and others —
  with monotonic never-reused stock codes, code-derived barcodes, printable
  labels through the shared printing boundary, and states from available through
  service, lost, damaged and retired.
- Accessories are linked to reservations and tracked through delivery, partial
  return, damage and loss. Damage and loss charges post through the existing
  expense and finance path; no parallel ledger exists.
- Phones get a stacked calendar agenda instead of a compressed desktop grid.

### Inventory performance and profitability (Phase 7, PR #108)
- A reporting centre at `/inventory-performance` answering what is in demand,
  what is idle, what actually earns, and what costs more service than it
  returns — per dress and per accessory.
- Every metric has a documented source of truth and formula in
  `docs/INVENTORY_PERFORMANCE_METRICS.md`.
- Discounts are provable rather than inferred: reservations store the catalogue
  rental price and sale lines store the catalogue sale price at the moment of
  the deal, so a later price change cannot invent a concession.
- High performers are ranked on net result weighted by utilisation, never on
  booking count alone.
- CSV export with a UTF-8 BOM and central formula-injection protection; printing
  through the shared boundary with full escaping, the reporting period, the
  generation timestamp, and interactive chrome excluded from the page.

### Backup and safety
- The backup covers every registered collection, images, counters, retired
  codes, audit and migration markers, including the accessory catalogue, the
  reservation–accessory links with their delivery and return state, and the new
  preparation, cleaning and default-time settings.
- A backup is fully validated **before** any mutation; a failed import restores
  the exact previous state with no partial restore.
- PWA ships the Arabic font bundled and precaches the shell for offline reload.

## Defects found and fixed during this delivery

These were not in the original plan; they were found by probing the system.

1. **Snapshot rollback destroyed data.** It cleared every application key before
   rewriting. If storage was the cause of the failure, the rewrite failed too
   and the showroom was left with nothing. Now overwrite-then-prune.
2. **Migration markers were wiped by backup/restore**, so one-time legacy
   migrations could re-run over already-migrated data.
3. **Sale returns were written to an unregistered collection** and were
   invisible to registry-driven flows.
4. **Returned items went straight back to available**, skipping inspection.
5. **The Arabic font was never bundled** — the `@import`s sat after `@tailwind`
   and PostCSS dropped them, so production shipped zero `@font-face` rules.
6. **The service worker precached no fonts and had no navigation fallback**, so
   an offline reload lost both the Arabic font and the app shell.
7. **The sales ledger and sale-return history were unreachable** — implemented
   but with no route or navigation entry.
8. **Unlabelled icon-only buttons** in the image gallery.
9. **Pseudorandom submission keys** flagged as a security issue; now crypto-backed.
10. **Date-only values were parsed as UTC.** `new Date('2026-07-28')` is a UTC
    instant, so calendar cells and day boundaries could land one day off for any
    showroom outside UTC. All date maths now goes through local-time helpers.
11. **Barcode normalisation was about to be duplicated** for accessories. It is
    now defined once in `@shared/utils/barcode` and reused by both families, so
    the two cannot drift into different ideas of "the same scanned code".
12. **A sale created through the invoice path carried no catalogue price
    snapshot**, which would have made every reported discount a guess against
    the current price list.

## Quality gates

`npm ci`, `npm test` (31 suites, 200+ assertions), `npm run typecheck`,
`npm run lint`, `npm run build` — all green, enforced on every pull request by
the Build and Verify workflows plus SonarCloud.

## Known limitations (honest)

- **Tauri Windows is not yet verified.** The delivery environment is Linux with
  no Windows toolchain. `tauri --info` is explicitly not treated as build
  evidence. The full build/install/launch/relaunch/backup/print/upgrade
  procedure is written down in `docs/RUNTIME_QA.md` and must be executed and
  recorded on Windows before the final tag.
- **Mobile evidence is enforced by tests, not yet captured on a device.**
  Overflow, safe area, modal scrolling and tap targets are asserted
  automatically; per-route screenshots at 390×844 and 360×740 are outstanding.
- **PWA install and offline reload are verified from build output, not on a
  device.** Manifest, icons, bundled font, precache and navigation fallback are
  asserted against real artifacts; a physical install check is outstanding.
- **Camera barcode scanning is untested on real hardware.** Manual barcode entry
  is always available as a fallback.
- **Two failure-recovery scenarios remain manual:** an unexpected reload mid-flow
  and a browser with IndexedDB unavailable.
- Single showroom, single user, no authentication, no online payments, no
  multi-device sync. These are product boundaries, not gaps.

## Release tag policy

**No release tag is created yet.** The tag stays withheld until all of the
following real-device evidence is executed and recorded in `docs/RUNTIME_QA.md`:

1. phone testing at 390×844;
2. phone testing at 360×740;
3. a real PWA installation;
4. an offline reload of the installed app;
5. a Windows Tauri build produced and launched on Windows;
6. a real camera barcode scan;
7. printing a rental contract and barcode/accessory labels from a physical device.

Everything else is implemented, tested and gated by CI.
