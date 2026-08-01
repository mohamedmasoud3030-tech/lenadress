# LENA v1.0 — Final Delivery Plan

> **Status:** Active source of truth  
> **Tracking issue:** #76  
> **Release surface:** Official Web App + PWA backed by Supabase per [ADR 0001](adr/0001-web-pwa-supabase-only.md); Tauri/Desktop retained temporarily, out of release scope.
>
> **Current planning baseline:** `main@bd376a0e5c3dab8068d5afcd7f62b39a48429d17`

This document replaces every previous roadmap, audit plan, readiness-progress document, and stale delivery branch. Developers and agents must execute from the latest `main`, read issue #76, and use this file as the delivery contract.

The product goals, departmental responsibilities, state machines, accounting meanings, and end-to-end workflows are defined in [`BUSINESS_MODEL.md`](BUSINESS_MODEL.md). Code ownership, module boundaries, engines, shared components, dependency rules, and the incremental refactor sequence are defined in [`TARGET_CODE_ARCHITECTURE.md`](TARGET_CODE_ARCHITECTURE.md). Implementation is complete only when it conforms to all three contracts.

## 1. Product boundary

LENA is an Arabic-first, RTL, local-first operating system for one occasion-wear showroom.

Supported targets:

- Browser and installable PWA — the official release surface per [ADR 0001](adr/0001-web-pwa-supabase-only.md), with Supabase/PostgreSQL as the target centralized source of truth.
- Tauri desktop application for Windows — **outside the current release scope** (ADR 0001); the source is retained temporarily for compatibility and historical recovery but excluded from the official Web build.

Out of scope for v1.0:

- SaaS or multi-tenant architecture.
- Multi-device synchronization.
- Online payments.
- User roles, authentication, or remote account management.
- Cosmetic refactors that do not affect release safety, maintainability, or usability.

## 2. Current verified shape

The active app exposes dashboard, inventory, inventory details, customers, reservations, appointments, delivery/return, payments, expenses, daily closing, audit log, reports, preferences, landing, and 404 routes.

The current tree is organized mainly around `app`, `components`, `features`, `services`, and `shared`. It works, but responsibilities are mixed:

- `App.tsx` knows every page implementation directly.
- `AppLayout.tsx` combines desktop/mobile navigation, header, persistence status, error handling, and outlet composition.
- feature services mix business validation, cross-feature queries, persistence, derived calculations, and audit writes.
- runtime integrations are distributed between feature code and `src/services`.
- direct relative imports make architectural boundaries difficult to enforce.

The target decomposition is therefore a delivery requirement, but it must be implemented incrementally and without a big-bang rewrite.

Mandatory automated gates:

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

PR #77 established the final business/delivery source of truth. PR #78 added the focused five-skill agent contract. Both were merged after green Build and Verify workflows.

## 3. Confirmed release blockers

### 3.1 Inventory and appointments bypass canonical persistence

- `src/features/dresses/dress.service.ts` writes inventory to `lena_dresses`.
- `src/features/appointments/appointment.service.ts` writes appointments to `lena_appointments`.

The central adapter, backup/reset flow, and Tauri mirror operate on `dress-roomshow:*` data. Inventory and appointments can therefore be omitted from backup, reset, or desktop recovery.

### 3.2 IndexedDB images are outside backup/restore

`LocalDatabaseBackup` currently exports collection arrays only. IndexedDB image blobs are not represented in the backup schema and cannot be restored transactionally with operational state.

### 3.3 Empty installations fall back to fake operational data

Core services use mock customers, reservations, payments, expenses, and delivery records when storage is empty. Production delivery must start empty. Demo records may only be loaded through an explicit reversible action.

### 3.4 The collection registry is incomplete

`sales-invoices` and `sales-returns` are used but absent from `REGISTERED_COLLECTIONS`. Appointments and accepted service-task collections are also missing. Every operational entity must use one registry for browser persistence, backup, restore, reset, Tauri snapshots, and integrity checks.

### 3.5 Multi-module operations are not atomic

Payment, return settlement, delivery, return, sale invoice, inventory status, and audit writes are performed sequentially across multiple collections. A failure can leave money, reservations, inventory, reports, and audit inconsistent.

### 3.6 Historical links use mutable business keys

Reservations retain customer/item display snapshots but do not store immutable `customerId` and `inventoryItemId`. Customer history is reconstructed by phone and item history by code. Editing or reusing those values can orphan or misattach historical records.

### 3.7 Inventory identity and deletion are unsafe

Inventory codes use `dresses.length + 1`, so deletion can cause reuse. The UI hard-deletes inventory while the existing archive blocker is not wired into the delete path.

### 3.8 Sales have two disconnected command paths

Single-item direct sales and invoice sales are separate workflows. A direct sale can lack canonical invoice and line-return history. Sale returns also move items directly to `available` instead of inspection/service.

### 3.9 Reporting semantics mix cash, revenue, and liability

- Deposit collections are included in cash but are not clearly separated as refundable liability.
- Item performance counts listed rental price from every non-cancelled reservation as revenue even when uncollected or unfulfilled.
- Daily closing is cash-oriented, but surrounding reports must distinguish cash movement from earned revenue and profitability.

### 3.10 Code ownership and dependency boundaries are unclear

- the app shell owns multiple independent UI/runtime concerns;
- feature services import other feature services and infrastructure directly;
- `src/services`, `src/shared`, and `src/components/shared` overlap;
- direct storage/runtime API access is not structurally prohibited;
- there is no public-module API or automated import-boundary gate.

This increases the risk of reintroducing detached persistence and inconsistent workflows while fixing release blockers.

### 3.11 Historical branches cannot be merged directly

PR #62 and PR #63 are closed and substantially behind current `main`.

- PR #62 is a reference for selective recovery only.
- PR #63 is an obsolete agent/documentation framework.

## 4. Execution rules

1. Start every phase from latest `main` after checking open PRs and CI.
2. Read `BUSINESS_MODEL.md` before changing cross-module behavior.
3. Read `TARGET_CODE_ARCHITECTURE.md` before moving files, introducing shared code, engines, repositories, or cross-module commands.
4. Apply every matching repository skill from `.agents/skills/README.md`.
5. Use one implementation branch and PR per bounded phase or migration step.
6. Never merge PR #62 or PR #63 wholesale.
7. Do not change money, settlement, inventory state, backup, migration, identity, or persistence without regression tests.
8. Do not call a feature complete because a page renders. Verify persistence, backup, reset, audit, reports, daily closing, and desktop parity.
9. Refactor incrementally. Keep temporary compatibility delegates until all callers and saved-data migrations are verified.
10. Do not combine broad file movement, UI redesign, financial changes, and data migration in one PR.
11. Attach exact command results and runtime evidence to every PR.
12. Merge only after green CI and resolved release-blocking review comments.

## 5. Delivery phases

### Phase 0 — One source of truth and repository cleanup

Completed source-of-truth work:

- PR #77 merged the business model, final delivery plan, and developer contract.
- PR #78 merged five focused repository agent skills.
- PR #62 and PR #63 remain closed as superseded.

Remaining cleanup:

- remove generated or obsolete root debris after verification: one-off shell patch scripts, tracked build metadata, stale ZIPs, and duplicate delivery files;
- ensure the root contains only maintained source, configuration, and operator documentation.

**Exit criteria**

- Issue #76 and the three active contracts are the only delivery authorities.
- No stale PR is presented as an execution branch.
- Repository root contains only maintained material.

### Phase 0.5 — Architecture guardrails and incremental decomposition

This phase prepares the tree for safe Phase 1 and Phase 2 execution. It is not a parallel rewrite.

#### A. Guardrails

- introduce `@app`, `@modules`, `@engines`, `@platform`, and `@shared` aliases in TypeScript and Vite;
- add architecture tests that reject forbidden import directions, private cross-module imports, and direct storage/runtime access outside approved platform adapters;
- record mixed-responsibility files and migrate them only through bounded PRs.

#### B. App shell decomposition

Split current layout responsibilities without visual or route behavior changes:

- `AppShell`;
- `AppHeader`;
- `DesktopNavigation`;
- `MobileNavigation`;
- `MobileMoreMenu`;
- `usePersistenceStatus` (neutral, typed by `src/shared/persistence/persistenceStatus.ts`);
- route configuration and route loading fallback.

Extract shared UI only when at least two modules use the same interaction contract.

#### C. Target ownership

Adopt the target tree from `TARGET_CODE_ARCHITECTURE.md`:

- `app` for bootstrap, providers, router, and shell;
- `modules` for vertical business ownership;
- `engines` for workflow, persistence, availability, finance, reporting, and documents;
- `platform` for localStorage, IndexedDB, Tauri, browser, camera, print, and runtime adapters;
- `shared` for business-neutral reusable UI and utilities.

#### D. Migration discipline

- create target folders only when real code moves into them;
- retain compatibility exports while callers migrate;
- move one module layer, adapter, engine capability, or shell concern per PR;
- preserve characterization tests before moving mixed service behavior;
- remove legacy `features`/`services` paths only after zero callers and successful migration/runtime evidence.

**Exit criteria**

- architectural boundaries are documented and automatically enforced;
- the app shell is decomposed without UI regression;
- Phase 1 can introduce the persistence engine and platform adapters without adding more cross-feature coupling;
- no big-bang refactor branch exists.

### Phase 1 — Data identity, safety, and unified persistence

Execute this phase through the architecture contract:

- concrete localStorage, IndexedDB, Tauri, browser file, and runtime integrations move under `platform`;
- one persistence engine owns registry, schema version, migrations, snapshots, backup, restore, reset, and compensation;
- modules access persistence through repositories/ports, not direct runtime APIs.

Required work:

- migrate `lena_dresses` and `lena_appointments` exactly once without loss or duplication;
- define one canonical operational collection registry;
- register invoices, sale returns, appointments, service tasks, and every UI-created entity;
- use the registry for browser persistence, backup, restore, reset, Tauri snapshots, and integrity verification;
- version backup format and include IndexedDB image blobs;
- make export/import asynchronous where image access requires it;
- implement exact compensation rollback across collections and images;
- preserve valid legacy collection-only backups and detached keys;
- remove automatic mock fallbacks from production startup;
- add explicit audited and reversible demo-data loading;
- add immutable customer/item references while preserving display snapshots;
- replace reusable length-based inventory codes with monotonic collision-safe allocation;
- archive referenced records instead of hard deletion.

**Required tests**

- legacy inventory and appointments migrate exactly once;
- CRUD survives export/import, reset, and Tauri relaunch;
- image blobs survive export/import;
- forced image or collection failure restores the exact previous snapshot;
- valid legacy backup import remains supported;
- fresh production startup contains no fake data;
- codes/barcodes remain unique through archive, reload, and migration;
- history remains attached after phone or display-code changes;
- no module uses direct storage APIs outside platform adapters.

**Exit criteria**

No supported operation can create data omitted from recovery or desktop persistence, and no historical relationship depends only on mutable phone/code values.

### Phase 2 — Atomic domain commands and financial correctness

Execute through module public APIs plus workflow, persistence, availability, and finance engines.

Create transaction/compensation-safe commands for:

1. Reservation creation/cancellation.
2. Payment, refund, fee, adjustment, and deposit settlement.
3. Delivery and return with inventory transitions.
4. Sale invoice and sale-line return/refund.
5. Expense posting.
6. Daily close and reopen.
7. Audit committed with every business operation.

Unify direct sale as a one-line invoice convenience path. Route every physical rental or sale return through inspection/service before availability.

Separate reports into:

- rental revenue;
- sale revenue;
- deposit liability collected/refunded/retained;
- fees;
- expenses;
- net cash movement;
- recognized item profitability.

Do not calculate item revenue from listed rental price on an unfulfilled booking.

Verify complete workflows:

- Inventory → customer → reservation → payment → delivery → return → deposit/fee settlement → inspection/service → reports → daily closing → audit.
- Invoice sale → collection → sold state → line return/refund → inspection → reports → daily closing → audit.
- Closed-day rejection and explicit reopen.
- Duplicate-submit/idempotency protection for every money-changing action.

**Required failure tests**

For every multi-module command, force failure after every write boundary and prove exact restoration of collections, item state, balances, and audit.

**Exit criteria**

For the same scenario, money totals, liability, inventory state, customer/item history, audit, documents, reports, and daily closing agree.

### Phase 3 — Selective recovery from PR #62

Evaluate and reintroduce only useful capabilities still missing from current `main`:

- reservation calendar;
- printable rental contract;
- service queue for inspection, laundry, tailoring, maintenance, and damage;
- reachable sales ledger and sale-return history;
- barcode label and lifecycle helpers not already replaced.

Each accepted capability must:

- follow `BUSINESS_MODEL.md` state transitions;
- use the owning target module and public API;
- be reachable from desktop and mobile navigation;
- use unified persistence and immutable references;
- participate in backup, reset, Tauri snapshot, integrity, reports, and audit;
- include tests and current RTL/mobile patterns.

**Exit criteria**

No old architecture, detached collection, private cross-module import, old route naming, or unsafe status transition is reintroduced.

### Phase 4 — Runtime QA and release UX

Required runtime matrix:

- desktop browser;
- phone viewports 390×844 and 360×740;
- installable PWA with offline reload;
- Tauri Windows install, launch, relaunch, persistence, backup, restore, and printing;
- real-device camera/barcode scan;
- popup-blocked invoice and contract printing;
- simulated storage quota failure at atomic workflow boundaries;
- Arabic RTL layout, keyboard focus, accessible labels, modal scrolling, and no horizontal page overflow.

Record commit SHA, OS/browser/WebView, viewport/device, expected and actual result, and evidence for failures.

**Exit criteria**

All core workflows pass on phone, desktop browser, and Windows runtime with the same business result.

### Phase 5 — Release packaging and handover

- produce a clean release candidate from current `main`;
- add compatible Windows Tauri build verification;
- verify PWA manifest, icons, cache, offline startup, and bundled Arabic font;
- finalize installation, backup/recovery, upgrade, demo-data, and operator guides;
- publish release notes with migrations, architecture compatibility notes, limitations, and rollback instructions;
- tag only after every gate passes.

**Exit criteria**

A new operator can install, start empty, optionally load demo data, operate, close the day, back up, restore, upgrade, and recover the shipped application using maintained documentation.

## 6. Stop-the-line criteria

Block release only for:

- data loss or corruption;
- incorrect money, refund, deposit, fee, liability, profitability, or daily-closing calculations;
- broken inventory, reservation, sale, delivery, return, inspection, or service workflow;
- failed backup/restore or missing operational data from persistence;
- application startup, installation, or core navigation failure;
- critical security vulnerability.

Non-blocking cosmetic improvements are recorded for post-release and must not delay delivery.

## 7. Definition of done

LENA v1.0 is delivered only when:

- all phases close with linked PRs and green CI;
- behavior conforms to `BUSINESS_MODEL.md`;
- code ownership and dependency direction conform to `TARGET_CODE_ARCHITECTURE.md`;
- app composition, business modules, engines, platform adapters, and shared code have clear non-overlapping ownership;
- architecture tests prevent direct storage access, private cross-module imports, and forbidden dependency directions;
- no operational data exists outside unified persistence;
- backup/restore includes inventory, appointments, invoices, returns, service tasks, audit, and images and survives induced failure;
- production first run contains no fake operational records;
- browser/PWA and Tauri Windows evidence is attached;
- one final release note and one operator handover guide describe the shipped system exactly.