# LENA Architecture Migration Baseline

> **Status:** Historical migration inventory (not an active delivery source)
> **Owner:** Phase 0.5 and the bounded refactor PRs that follow  
> **Release surface:** Official Web App + PWA with Supabase as the active source of truth per [ADR 0001](adr/0001-web-pwa-supabase-only.md); Tauri/Desktop code is retained only outside release scope.
>
> **Rule:** Update this file when a hotspot is migrated, split, or a new verified coupling is discovered.

This is not another roadmap. It records the current mixed-responsibility files and their intended owners so agents do not move code without understanding the dependency being removed.

## Verified hotspots

| Current path | Current mixed responsibilities | Target owner(s) | Required migration evidence |
| --- | --- | --- | --- |
| `src/app/router/*` | Router ownership is separated from bootstrap; `routePages.ts` is a temporary compatibility facade over current top-level legacy page exports until modules expose public `index.ts` entry points | `app/router` plus future module public page exports | Router characterization test; unchanged URLs, lazy inventory details, landing route, shell boundary, and 404 behavior |
| `src/app/shell/*` | App shell is now split into `AppShell`, header, desktop/mobile navigation, mobile more menu, navigation config, and the neutral persistence status hook `usePersistenceStatus` typed by `src/shared/persistence/persistenceStatus.ts`; legacy `src/components/layout/AppLayout.tsx` is a compatibility export only | `app/shell` | PR #80; shell characterization test; unchanged route URLs, labels, ordering, outlet boundary, mobile close behavior, and persistence notice |
| `src/platform/storage/*` | Owns the browser Web Storage port and concrete localStorage adapter; exact existing keys and JSON are preserved | `platform/storage` | Platform storage contract test plus existing persistence-error regression |
| `src/platform/runtime/*` | Owns dynamic Tauri API loading, invoke caching, unavailable-runtime fallback, and the existing test injection seam | `platform/runtime` | Runtime boundary characterization plus desktop behavior suite |
| `src/platform/desktop/*` | Owns desktop snapshot bootstrap, mirror serialization/application, retry attempts, 500ms synchronization, reload, and browser fallback, publishing typed statuses on the shared neutral persistence channel (`@shared/persistence/persistenceStatus`); retained temporarily and excluded from the official Web/PWA build per [ADR 0001](adr/0001-web-pwa-supabase-only.md); `src/services/desktopDatabase.ts` is a compatibility re-export only | `platform/desktop` | Existing four-scenario desktop behavior suite plus platform ownership and Web/PWA isolation tests; compatible Tauri relaunch remains Phase 4 |
| `src/services/localDatabase.ts` | Collection registry, schema metadata, migrations, backup/import/reset, memory fallback, ID/number generation; browser storage access now delegates to `platform/storage` | `engines/persistence`, later `platform/images` | Legacy-data migration, backup/restore, rollback, reset and relaunch tests |
| `src/features/dresses/dress.service.ts` | Inventory domain rules, code allocation, CRUD and direct `lena_dresses` storage | `modules/inventory` plus a temporary persistence compatibility adapter | Exact-once legacy-key migration, unique code tests, archive behavior, backup/restore evidence |
| `src/features/appointments/appointment.service.ts` | Appointment lifecycle and direct `lena_appointments` storage | `modules/appointments` plus a temporary persistence compatibility adapter | Exact-once migration and CRUD/backup/reset/relaunch evidence |
| `src/features/reservations/reservation.service.ts` | Reservation validation, availability, customer/inventory reads, financial calculations, persistence and separate audit write | `modules/reservations`, `engines/availability`, `engines/finance`, `engines/workflow` | Characterization tests before movement; overlap, cancellation, payment and atomic-audit tests |
| delivery/return services under `src/features/delivery-return/` | Fulfillment state, return settlement, inventory transitions, payments and audit | `modules/fulfillment`, `modules/service`, `engines/workflow` | Forced-failure rollback after every write boundary |
| payment/expense/daily-close services under `src/features/` | Money movements, business validation, storage and report-facing calculations | `modules/finance`, `engines/finance`, `engines/workflow` | Source-to-report reconciliation and closed-day tests |
| sales and sales-ledger services | Direct sale and invoice sale paths, item state and return handling | `modules/sales`, `engines/workflow`, `engines/documents` | One canonical invoice command and sale-return inspection tests |
| report pages/services | Read-model construction mixed with labels and operational service reads | `modules/reporting`, `engines/reporting` | Cash/revenue/liability reconciliation against authoritative facts |
| print helpers | Printable business model mixed with popup/runtime rendering | `engines/documents`, `platform/printing` | Popup-blocked fallback and printed-value reconciliation |

## Current structural debt retained temporarily

The following are accepted only during incremental migration and must not be copied into new target code:

- legacy `src/features`, `src/services`, `src/components`, and `src/pages` imports;
- direct feature storage keys used by inventory and appointments;
- cross-feature service imports;
- business operations that write audit after the operational write;
- deep relative imports that hide ownership.

Architecture tests protect the new target roots immediately. Legacy paths are removed only after callers, saved-data migration, backup/restore, and runtime evidence are complete.

## Migration update rule

When a bounded PR migrates a hotspot:

1. link the PR beside the affected row or replace the row with the remaining responsibility;
2. state which compatibility export remains;
3. state which old dependency direction was removed;
4. attach the exact tests and runtime evidence;
5. do not mark the migration complete until the PR is merged to `main` with green CI.
