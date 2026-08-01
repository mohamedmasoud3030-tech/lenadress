# LENA v1.0 — Target Code Architecture

> **Status:** Active implementation contract  
> **Tracking:** Issue #76 and `FINAL_DELIVERY_PLAN.md`  
> **Release surface:** Official Web App + PWA backed by Supabase per [ADR 0001](adr/0001-web-pwa-supabase-only.md); Tauri/Desktop adapters are retained temporarily, excluded from the official Web build.
>
> **Migration rule:** Incremental, behavior-preserving, one bounded PR at a time

This document defines how the current codebase will be decomposed into reusable components, independent business modules, cross-module engines, and platform adapters without interrupting delivery or changing the verified business model.

The purpose is not to create more folders. The purpose is to make ownership, dependency direction, testing, and change impact explicit.

## 1. Current verified structural problems

### 1.1 Application composition owns too much detail

`src/app/App.tsx` imports almost every page directly and owns route composition and route-level loading UI. This makes the application root aware of the internal location of every feature.

### 1.2 The layout is a mixed-responsibility component

`src/components/layout/AppLayout.tsx` currently combines:

- desktop navigation data and rendering;
- mobile bottom navigation;
- the full mobile menu overlay;
- global header and create-reservation action;
- desktop/Tauri persistence status subscription;
- persistence warning presentation;
- route outlet and persistence error boundary.

These concerns should remain coordinated by the app shell but implemented as smaller reusable components and hooks.

### 1.3 Feature services mix domain, orchestration, and infrastructure

For example, `reservation.service.ts` directly imports:

- the local database adapter;
- date and financial helpers;
- audit recording;
- customer and inventory services;
- integrity rules;
- preferences.

That file validates business rules, queries other modules, writes state, updates money-derived fields, and commits audit separately. This pattern makes atomicity, testing, and reuse difficult.

### 1.4 Cross-cutting code has no single home

Cross-cutting behavior is split between `src/services`, `src/shared`, and `src/components/shared`. Storage, desktop mirroring, printing, date helpers, money calculations, error handling, UI feedback, and layout primitives therefore have inconsistent ownership.

### 1.5 Some feature code bypasses shared infrastructure

Inventory and appointments use direct feature-owned storage keys while other modules use `localDatabase`. A feature must not choose its own persistence mechanism.

### 1.6 Deep relative imports hide architectural coupling

The current TypeScript configuration has no path aliases. Imports such as `../../services/...` and `../features/...` make it difficult to see whether a dependency crosses an allowed boundary.

## 2. Target architecture principles

1. **Vertical business ownership:** each business area owns its domain model, application API, infrastructure adapter, and UI.
2. **One-way dependencies:** lower layers never import UI or application composition.
3. **Cross-module mutations use engines:** no page or feature service coordinates multi-module writes directly.
4. **Platform code contains no showroom rules:** localStorage, IndexedDB, Tauri, browser APIs, camera, and printing are adapters.
5. **Shared means business-neutral:** a component or helper enters `shared` only when it is reusable and contains no module-specific rules.
6. **Public APIs only:** modules expose supported contracts through `index.ts`; other modules do not import private internal files.
7. **Behavior-preserving migration:** moving code is separated from changing business behavior unless the active delivery phase requires both and tests prove the transition.
8. **No big-bang rewrite:** old exports may temporarily delegate to new implementations until all callers migrate.

## 3. Target source tree

```text
src/
├── app/
│   ├── bootstrap/
│   │   ├── initializeApplication.ts
│   │   └── runStartupMigrations.ts
│   ├── providers/
│   ├── router/
│   │   ├── AppRouter.tsx
│   │   ├── routeConfig.tsx
│   │   └── RouteLoadingFallback.tsx
│   ├── shell/
│   │   ├── AppShell.tsx
│   │   ├── AppHeader.tsx
│   │   ├── DesktopNavigation.tsx
│   │   ├── MobileNavigation.tsx
│   │   ├── MobileMoreMenu.tsx
│   │   └── usePersistenceStatus.ts
│   └── App.tsx
│
├── modules/
│   ├── inventory/
│   ├── customers/
│   ├── reservations/
│   ├── appointments/
│   ├── fulfillment/
│   ├── finance/
│   ├── sales/
│   ├── service/
│   ├── reporting/
│   ├── audit/
│   └── settings/
│
├── engines/
│   ├── workflow/
│   ├── persistence/
│   ├── availability/
│   ├── finance/
│   ├── reporting/
│   └── documents/
│
├── platform/
│   ├── storage/
│   ├── images/
│   ├── desktop/
│   ├── browser/
│   ├── camera/
│   ├── printing/
│   └── runtime/
│
├── shared/
│   ├── ui/
│   ├── forms/
│   ├── layout/
│   ├── feedback/
│   ├── data-display/
│   ├── lib/
│   ├── types/
│   └── config/
│
└── tests/
    ├── architecture/
    ├── integration/
    └── workflows/
```

The existing top-level `tests/` directory may remain during migration. Tests move only when the target owner is clear; test behavior must not be lost merely to match the tree.

## 4. Standard module shape

Every business module follows this template where applicable:

```text
modules/<module>/
├── domain/
│   ├── entities.ts
│   ├── valueObjects.ts
│   ├── policies.ts
│   ├── stateMachine.ts
│   └── errors.ts
├── application/
│   ├── commands/
│   ├── queries/
│   ├── dto.ts
│   └── ports.ts
├── infrastructure/
│   ├── localRepository.ts
│   ├── mappers.ts
│   └── migration.ts
├── ui/
│   ├── pages/
│   ├── components/
│   ├── forms/
│   └── hooks/
├── __tests__/
└── index.ts
```

Not every module needs every folder. Empty abstractions must not be created. A folder is introduced only with real owned code.

### Domain

Pure business concepts and rules. No React, localStorage, IndexedDB, Tauri, DOM, printing, or audit side effects.

### Application

Use cases for one module: commands, queries, DTOs, and repository/engine contracts. It may coordinate domain rules but not concrete storage APIs.

### Infrastructure

Concrete persistence and platform adapters for the module. It implements application ports and maps stored records to domain records.

### UI

Pages, forms, hooks, and module-specific presentation. UI calls application commands/queries through the module public API; it does not write storage directly.

### Public API

`index.ts` exports only supported types, commands, queries, and page entry points. Imports such as `modules/inventory/infrastructure/localRepository` from another module are forbidden.

## 5. Business module boundaries

### `inventory`

Owns immutable item identity, code/barcode allocation, lifecycle state, archive policy, images, item search, and item history projections.

It does not own date-based reservation availability, payment totals, or service-task completion.

### `customers`

Owns customer identity, contact snapshots, archive/block state, and customer profile queries.

It does not calculate balances by scanning mutable phone numbers.

### `reservations`

Owns reservation identity, dates, reservation state, customer/item immutable references, display snapshots, cancellation rules, and reservation-level amounts.

Availability checks are delegated to the availability engine. Money movements are delegated to finance workflows.

### `appointments`

Owns showroom appointments and their lifecycle. It must use the canonical persistence registry.

### `fulfillment`

Owns delivery, physical return intake, handover evidence, and the transition into inspection/service.

It does not set an item directly to available after return.

### `finance`

Owns append-only money movements, payment methods, refunds, fees, adjustments, deposit liability, expenses, and daily-close records.

It exposes financial facts; it does not render reports or infer inventory state.

### `sales`

Owns sale invoices, lines, sale identity, collection linkage, sale return requests, and line-level return/refund status. Quick sale is an application convenience over the same canonical invoice command.

### `service`

Owns inspection, laundry, tailoring, maintenance, damage, service tasks, completion evidence, and eligibility to return an item to available state.

### `reporting`

Owns read models and report composition. It consumes authoritative facts from modules and finance/reporting engines; it must not mutate operational state.

### `audit`

Owns audit record shape and audit queries. Audit commitment is coordinated by workflow transactions so it succeeds or rolls back with the business operation.

### `settings`

Owns preferences, showroom profile, configurable reservation buffer, payment/delivery policy, and explicit demo-data controls.

## 6. Engine responsibilities

Engines are not generic service bags. Each engine owns a cross-module capability that cannot belong to one module.

### 6.1 Workflow engine

Coordinates multi-module commands and exact compensation:

- reservation creation/cancellation with audit;
- payment/refund/fee/deposit settlement;
- delivery and return with inventory transitions;
- sale invoice and sale-line return;
- service completion and availability restoration;
- daily close/reopen.

No UI component or module repository may reproduce these sequences.

### 6.2 Persistence engine

Owns:

- canonical collection registry;
- schema version and migrations;
- snapshots and atomic/compensated writes;
- backup validation, export, import, and rollback;
- reset and demo-data transactions;
- reconciliation across collections and image blobs.

It depends on platform storage ports, not directly on React or module UI.

### 6.3 Availability engine

Combines physical lifecycle state, reservation date overlap, configured buffer days, service state, and archive state. It returns availability decisions with machine-readable reasons.

### 6.4 Finance engine

Provides pure calculation policies for:

- reservation balance;
- deposit liability;
- return settlement;
- fee/refund limits;
- cash movement;
- recognized rental/sale revenue;
- item profitability.

The engine calculates; the workflow engine persists.

### 6.5 Reporting engine

Builds read-only projections from authoritative facts. Reports must not calculate revenue from UI labels or unfulfilled listed prices.

### 6.6 Documents engine

Builds stable printable document models for rental contracts, receipts, sale invoices, labels, and closing reports. Platform printing renders or opens those models.

## 7. Platform adapters

`platform` contains concrete runtime integration only:

- `storage`: localStorage and in-memory test adapter;
- `images`: IndexedDB image repository and blob serialization;
- `desktop`: legacy Tauri snapshot/mirror — retained temporarily and excluded from the official Web/PWA release per [ADR 0001](adr/0001-web-pwa-supabase-only.md); publishes statuses on the shared neutral persistence channel;
- `browser`: download, file picker, URL, and popup adapters;
- `camera`: barcode scanner adapter;
- `printing`: print-window and desktop print adapters;
- `runtime`: capability detection and environment information.

Platform code must not know what a reservation, deposit, dress, or sale means.

## 8. Shared components and utilities

A shared component is extracted only when at least two modules use the same interaction contract or when it is an application-wide shell primitive.

Approved shared categories:

- buttons, inputs, selects, checkboxes, dialog/drawer primitives;
- page header, section card, responsive data list/table, empty state;
- loading, error, confirmation, persistence warning, toast/feedback;
- money, date, phone, and identifier formatting;
- generic form field and validation presentation;
- focus management and RTL-safe layout helpers.

Not shared:

- reservation payment form;
- inventory status badge containing lifecycle rules;
- return-settlement summary;
- customer balance card;
- sales invoice line editor.

These remain module-owned even if visually reusable. Their business meaning is not generic.

## 9. Dependency rules

Allowed dependency direction:

```text
app → module UI/public APIs → module application/domain
app → shared
module UI → shared + its module public/application API
module application → its domain + engine contracts
module infrastructure → its domain/application ports + platform
engines → module public domain contracts + platform + shared pure utilities
platform → shared pure utilities
shared → no module, engine, platform, or app imports
```

Mandatory prohibitions:

1. No direct `localStorage`, IndexedDB, Tauri, camera, popup, or print access outside `platform`.
2. No cross-module import from another module's `ui`, `infrastructure`, or private file.
3. No business rule inside `shared`.
4. No React import inside module domain or pure engines.
5. No multi-collection write sequence outside the workflow/persistence engines.
6. No audit write after a business write as an unrelated second operation.
7. No page importing a repository implementation.
8. No new file under legacy `src/services` once the relevant target owner exists.

## 10. Path aliases and public imports

Introduce these aliases during the architecture guardrail PR:

```text
@app/*       -> src/app/*
@modules/*   -> src/modules/*
@engines/*   -> src/engines/*
@platform/*  -> src/platform/*
@shared/*    -> src/shared/*
```

Do not convert every import in one commit. Convert imports only in the bounded area being migrated.

## 11. Migration sequence

### Step A — Architecture guardrails

- Add aliases to TypeScript and Vite.
- Add a lightweight architecture test that rejects forbidden import directions and direct storage/platform API access outside approved folders.
- Record the current import map and oversized/mixed-responsibility files.
- Create target folders only when the first real owner is moved.

**Exit:** future code cannot silently deepen the current coupling.

### Step B — App shell and shared UI extraction

Decompose `AppLayout.tsx` into shell components and one persistence-status hook without visual or routing changes. Move navigation configuration into `app/router` or `app/shell`.

Extract only proven shared primitives used by at least two modules.

**Exit:** the app shell composes small components and contains no business rules.

### Step C — Persistence/platform foundation

This step is executed together with delivery Phase 1:

- move concrete localStorage, IndexedDB, backup, desktop mirror, and runtime access under `platform`;
- implement the persistence engine over those adapters;
- migrate detached inventory and appointment storage through compatibility adapters;
- retain old service exports as temporary delegates where necessary.

**Exit:** no feature controls its own storage mechanism.

### Step D — Core modules

Migrate in this dependency order:

1. inventory;
2. customers;
3. settings/preferences;
4. reservations;
5. appointments.

Start with domain types and read queries, then commands, infrastructure, and UI. Keep each module migration independently releasable.

**Exit:** these modules expose stable public APIs and no longer import each other's private service files.

### Step E — Workflow and finance decomposition

Executed with delivery Phase 2:

- create finance calculation policies as pure engine functions;
- move payments, deposits, refunds, fees, and expenses into the finance module;
- create workflow transaction commands for all multi-module mutations;
- commit audit inside the transaction boundary;
- add forced-failure rollback tests after every write boundary.

**Exit:** UI actions invoke one command and receive one committed result or one complete rollback.

### Step F — Fulfillment, sales, service, reporting, and documents

- split delivery/return into fulfillment;
- unify quick sale and invoice sale under sales;
- add service/inspection ownership;
- migrate reports to read models;
- isolate printable models from popup/desktop rendering.

**Exit:** physical workflow, financial facts, reporting, and printing use the same authoritative records.

### Step G — Legacy removal

Remove compatibility delegates, dead `features` paths, obsolete `services`, duplicate shared folders, and old names only after:

- repository search shows no callers;
- migration tests cover existing saved data;
- backup/restore and Tauri evidence pass;
- CI and workflow tests are green.

## 12. PR boundaries

A refactor PR must be bounded by one of these units:

- one app-shell concern;
- one shared primitive family;
- one platform adapter;
- one engine capability;
- one module layer;
- one complete module when small enough.

Do not combine unrelated UI redesign, data migration, financial behavior change, and broad file movement in one PR.

Every PR must state:

- files/modules moved;
- old compatibility path retained or removed;
- dependency rule improved;
- behavior intentionally unchanged or explicitly changed by the active phase;
- tests and runtime evidence;
- rollback strategy.

## 13. Required tests and automated enforcement

In addition to the standard CI commands, architecture work requires:

- import-boundary test;
- no-direct-storage test;
- no-private-cross-module-import test;
- route smoke test after app-shell changes;
- characterization tests before moving mixed-responsibility services;
- workflow integration tests after command extraction;
- backup/restore and legacy-data migration tests for persistence moves.

The mandatory repository commands remain:

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

## 14. Definition of architectural completion

The decomposition is complete when:

- `app` only composes bootstrap, providers, routes, and shell;
- every business area has one clear module owner and public API;
- all concrete runtime APIs live under `platform`;
- all cross-module writes run through workflow/persistence engines;
- shared code is business-neutral and demonstrably reused;
- no module imports another module's private internals;
- no operational service bypasses canonical persistence;
- reports and documents consume authoritative module facts;
- legacy `features`, mixed `services`, and duplicate shared locations are removed;
- CI enforces the boundary rules so the old structure cannot return.

This architecture is a delivery mechanism, not a parallel roadmap. Its steps are executed inside the active phases in `FINAL_DELIVERY_PLAN.md` and never override `BUSINESS_MODEL.md`.