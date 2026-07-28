# Runtime QA evidence — LENA

This document records what has been **actually verified**, and what is still
outstanding, for the browser, PWA and Tauri Windows targets. Nothing here is
claimed as passing unless it is backed by an automated gate or a reproducible
manual procedure.

Status vocabulary:

- **Automated** — enforced by a test in `npm test`; a regression fails CI.
- **Verified** — checked against real build output or a real run.
- **Outstanding** — not possible in the current environment; the procedure is
  written down so it can be executed and recorded before the release tag.

## 1. Automated coverage

| Area | Gate | What it proves |
| --- | --- | --- |
| Data identity and migrations | `npm run test:reference-migration` | Stable ids backfilled idempotently; exact rollback on forced failure |
| Codes and archiving | `npm run test:inventory-codes` | Codes never reused after deletion or restore; referenced records cannot be hard-deleted |
| Atomic workflows | `npm run test:workflows` | Forced failure after each write boundary restores the exact prior state |
| Sales, expenses, daily close | `npm run test:sales-close` | One sale path; post-close money rejection; no partial sale |
| Financial truth | `npm run test:finance-reconciliation` | Deposit is a liability; reports, finance layer and daily close agree |
| Service workflow | `npm run test:service` | Conflict guard, explicit completion outcome, cost posted as an item expense |
| Calendar, contract, printing | `npm run test:capability-recovery` | Date-derived availability; contract uses historical snapshots; blocked-popup recovery |
| UI contract | `npm run test:ui-contract` | RTL shell, overflow guards, modal focus trap and scrolling, a11y labels, duplicate-submit guards, route reachability |
| Backup and restore | `npm run test:backup-integrity` | Full collection coverage, validation before mutation, no partial restore, markers survive |
| Booking conflicts | `npm run test:reservation-conflicts` | One central rule enforced in the service layer for creation, reschedule, item swap, extension and accessory attach, including the preparation and cleaning windows |
| Reservation calendar | `npm run test:reservation-calendar` | Month/week/day grids built on local time; no day drift; filters, ordering and derived occupancy |
| Accessories | `npm run test:accessories` | Stable codes and barcodes, delivery, partial return, damage, loss, rollback on forced failure, no double charge |
| Accessory backup | `npm run test:accessory-backup` | Links, handover state, charges, counters and the new settings survive a restore without duplication |
| Inventory performance | `npm run test:inventory-performance` | Realised-money metrics, utilisation, idleness, ranking, date ranges, reconciliation against the finance layer |
| Report export | `npm run test:inventory-performance-export` | UTF-8 BOM, formula-injection protection, escaping, print contract and failure recovery |
| Designs and variants | `npm run test:designs` | Piece identity under a design, booking one size leaving others free, per-period availability with buffers, atomic creation with no orphan pieces, backup/restore with counter monotonicity |
| Daily operations board | `npm run test:dashboard` | Today's pickups and returns ordered by time, uncollected money totalled and ordered for collection, cash matching the finance layer, overdue returns, accessory counts |
| PWA build output | `npm run test:pwa` | Manifest, icons, bundled Arabic font, precached shell, navigation fallback |

## 2. Browser (desktop)

**Verified:** production build succeeds and the bundle is served from `dist/`
with the app shell, code-split routes and the service worker registered.

**Daily journey to walk through before the release tag** (each step must end with
the data visible in reports and the audit log):

1. Add an item → confirm the code is new and never a reused one.
2. Add a customer.
3. Create a reservation → verify the overlap and buffer rejection by retrying the same dates.
4. Collect a rental payment and a deposit → verify the deposit shows as a liability, not revenue.
5. Deliver → item becomes `rented`.
6. Return with a late fee → item lands in inspection, not available; deposit partly retained.
7. Complete the service task → choose the resulting state explicitly.
8. Sell an item → invoice created; print it.
9. Return a sale line → item goes to inspection; revenue drops everywhere.
10. Post an expense; close the day; confirm further money changes for that date are refused.
11. Export a backup, reset, re-import, confirm every record and image returns.

## 3. Mobile widths

**Automated:** `tests/ui-contract.test.mjs` enforces the 320px overflow guards,
`overflow-wrap`, safe-area insets, bottom navigation, modal body scrolling and
comfortable tap targets.

**Outstanding — device/emulator capture at 390×844 and 360×740.** The defects
reported from a real phone in this stage (print view with no way back, auto-zoom
on focus, sideways drift, dialogs jumping with the keyboard) are now fixed and
guarded by `tests/ui-contract.test.mjs`, but the contract tests verify the code,
not the phone. Re-confirm each on hardware, then capture: confirm no
horizontal scrollbar on every route, correct RTL mirroring, card layouts instead
of wide tables, modal scrolling with the keyboard open, and reachable bottom
navigation. Record screenshots per route, including the two routes added in this
stage: the calendar agenda on `/reservations` and the report table on
`/inventory-performance`, both of which must scroll their content rather than
widen the page.

## 4. PWA

**Verified from the real build output** (`npm run build`, then `npm run test:pwa`):

- Manifest is `lang: ar`, `dir: rtl`, `display: standalone`, scope and start URL `/`.
- 192px, 512px and maskable icons exist as files.
- 25 Arabic `woff2` faces are bundled and precached; there is no remote font dependency.
- The shell, manifest and all assets are precached (70 entries) and navigations
  fall back to the cached shell.

**Two real defects were found and fixed here:** the font `@import`s sat after
`@tailwind` so PostCSS dropped them and no font shipped at all; and the service
worker precached neither fonts nor a navigation fallback, so an offline reload
lost both the Arabic font and the app shell.

**Outstanding — manual install check:** install to the home screen on a real
device, reload offline, and confirm an empty first start and a reload with data
both render correctly.

## 5. Tauri Windows

**Not claimed as passing.** This environment is Linux without a Windows
toolchain, so a native build cannot be produced here. `tauri --info` is
explicitly **not** treated as build evidence.

**Outstanding procedure**, to be executed on a Windows machine and recorded:

1. `npm ci && npm run build && npm run tauri build`.
2. Install the produced bundle.
3. Launch, create records, close and relaunch → confirm the snapshot is restored.
4. Export a backup, restore it, relaunch → confirm data and images survive.
5. Print an invoice and a rental contract from the desktop app.
6. Install a newer version over the old one → confirm existing data is preserved.

## 6. Barcode and camera

**Automated:** barcode value generation and the runtime support probe.

**Outstanding on a real device:** grant and deny camera permission, run with no
camera available, and confirm the manual barcode entry fallback works in each
case.

## 7. Failure recovery

| Scenario | Status |
| --- | --- |
| Popup blocked during print | **Automated** — the shared print boundary raises an actionable Arabic error |
| Storage write failure / quota | **Automated** — persistence errors surface a user-facing Arabic message; snapshot rollback no longer clears data first |
| Partial write failure mid-command | **Automated** — forced-failure tests after every write boundary |
| Duplicate submit | **Automated** — idempotency keys plus disabled submit buttons |
| Corrupted or foreign backup | **Automated** — rejected before any mutation |
| Failed import | **Automated** — exact previous state restored, never a half-restore |
| Unexpected reload mid-flow | **Outstanding** — manual check that no partial record remains |
| IndexedDB unavailable | **Outstanding** — manual check with IndexedDB disabled |

## 8. Release gate summary

Ready: data identity, atomic workflows, financial truth, service workflow,
backup and restore, UI contract, PWA build output.

Still required before the release tag: mobile device capture, PWA install and
offline reload on a device, the full Tauri Windows procedure, real-camera
barcode checks, and the two outstanding failure-recovery scenarios.
