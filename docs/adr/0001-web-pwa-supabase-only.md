# ADR 0001: Official release surface is Web App + PWA backed by Supabase

- **Status:** Accepted
- **Date:** 2026-08-01
- **Related:** PR [#131](https://github.com/mohamedmasoud3030-tech/lenadress/pull/131), [`docs/SUPABASE_SCHEMA_GAP_ANALYSIS.md`](../SUPABASE_SCHEMA_GAP_ANALYSIS.md)

## Decision

- The official product is the **Web App + installable PWA**.
- **Tauri/Desktop is outside the current release scope.**
- **Supabase/PostgreSQL is the target centralized source of truth.**
- Existing local browser storage **remains temporarily during migration**.
- Local storage is **not** the final authoritative database.
- **Offline writes will not be enabled** until idempotency, ordering, retries, and conflict handling are designed.
- Existing Desktop code (`src/platform/desktop/**`, `src/platform/runtime/**`, `src-tauri/**`, and the legacy `src/services/desktopDatabase.ts` delegate) is **retained temporarily but excluded from the official Web build**. Web code must never import it; this is enforced permanently by `tests/architecture/web-runtime-isolation.test.mjs`.

## Context

The product was trying to support, simultaneously:

- a browser Web App,
- an installable PWA with its own service-worker lifecycle,
- local-first `localStorage` persistence as the de-facto database,
- a Tauri desktop shell mirroring `localStorage` snapshots into SQLite, and
- a Supabase/PostgreSQL backend with RLS, auth, and storage buckets.

Each of these has a different answer to "where is the truth?". Keeping all of them active at once created:

- **Multiple sources of truth.** The same booking could be "current" in browser storage, in the desktop SQLite mirror, and in Supabase, with no defined reconciliation between them.
- **Undefined conflict semantics.** The desktop mirror performed a last-write-wins snapshot copy with a periodic timer; Supabase enforces its own constraints; neither knew about the other. Any concurrent use would silently destroy data.
- **Release complexity.** Every operational feature had to be verified against three runtimes (browser, PWA, Tauri) and two storage behaviors, which slowed delivery and made release sign-off ambiguous.
- **Misleading UI state.** The interface reported "sync" status even though no cloud synchronization of operational data existed.

The business priority is multi-device operation for one showroom, which requires a centralized, authoritative store. Supabase already provides the schema, RLS, authentication profile synchronization, and storage buckets for that direction (see the gap analysis for what remains).

## Consequences

### Positive

- **Reduced release complexity:** one deployment surface (static Web/PWA build) plus one Supabase project.
- **One official runtime to verify:** `npm test`, typecheck, lint, and the Web build cover the released product; desktop parity testing is no longer a release gate.
- **Multi-device operation** becomes possible through Supabase instead of the single-machine snapshot mirror.
- **Honest UI state:** the persistence status contract (`src/shared/persistence/persistenceStatus.ts`) reports a typed, neutral default of `local-only` ("البيانات المحلية متاحة مؤقتًا، وجارٍ الانتقال إلى المزامنة السحابية.") instead of implying cloud sync that does not exist.

### Neutral / managed

- **Temporary migration compatibility:** legacy `dress-roomshow:*` browser data remains readable; this decision deletes and migrates nothing on its own.
- **Desktop island preserved:** `src/platform/desktop/**`, `src/platform/runtime/**`, and `src-tauri/**` remain in the repository for compatibility and historical recovery, quarantined from the Web build.
- **No unrestricted offline financial or booking operations:** offline writes stay disabled until idempotency, ordering, retries, and conflict handling are designed and implemented.

### Negative

- The Tauri Windows build is no longer a supported release artifact; users on the desktop build have no upgrade path within the official scope.
- Until the Supabase data flow is wired, the officially supported runtime still persists operational data locally in the browser (transition period).

## Non-goals

This ADR does not:

- migrate operational data;
- create Supabase RPCs;
- create an offline outbox;
- redesign financial models;
- delete Tauri source files.

## Enforcement

- `tests/architecture/web-runtime-isolation.test.mjs` scans the official Web/PWA dependency surface (`src/main*`, `src/app/**`, `src/pages/**`, `src/features/**`, `src/components/**`) and fails if any file imports `@tauri-apps/*`, `@platform/desktop`, `src/platform/desktop`, the Tauri runtime adapter (`@platform/runtime`), any Desktop bootstrap module, or `src/services/desktopDatabase`. It also fails if `src/app/App.tsx` reintroduces a Desktop side-effect import.
- `tests/platform-desktop-boundary.test.mjs` proves the desktop island still exists in isolation, that the Web bootstrap performs no destructive storage operations, and that the shared persistence contract is pure, neutral, and typed.
