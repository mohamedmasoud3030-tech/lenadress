# Supabase Schema Gap Analysis

> **Status:** Partially addressed — inventory + 0014 canonical finance separation
> **Date:** 2026-08-02
> **Basis:** the actual SQL migrations under `supabase/migrations/` (`0001`–`0014`)
> **Related:** [ADR 0001 — Web/PWA + Supabase release architecture](adr/0001-web-pwa-supabase-only.md)

This document records what the current Supabase schema **already provides** and what is a **confirmed gap** for the target operating model (multi-item rental contracts, an authoritative financial ledger, and atomic operational workflows). It is an analysis artifact only: **no migrations are implemented in the PR that introduces this document.**

## Existing capabilities

Verified against the migrations (including 0014 canonical finance separation):

- **Core tables exist** for the operational baseline: `profiles`, `dresses`, `dress_images`, `customers`, `reservations`, `payments`, `returns`, `expenses` (`0002`–`0005`).
- **UUID identifiers in major tables:** every core table uses `uuid primary key default gen_random_uuid()` (`0002` onward).
- **Row Level Security is present** on all eight core tables, with active-user-scoped policies (`private.is_active_lena_user()`), admin-only deletes, and payment inserts constrained to the authenticated author (`created_by = auth.uid()`) (`0008`, `0011`, `0012`).
- **Authentication profile synchronization:** `public.handle_new_auth_user()` provisions a profile on `auth.users` insert, grants admin to the first user under an advisory lock, and a trigger prevents non-admins from changing account privileges (`0009`, `0010`, `0011`, `0012`).
- **Storage buckets exist:** `catalogue-images` (public read), `condition-photos`, and `backups`, with per-bucket `storage.objects` policies (`0011`).
- **Reservation overlap prevention through a trigger:** `prevent_overlapping_reservations()` rejects overlapping active reservations per dress (`0006`, hardened in `0011`).
- **Payment total refresh logic:** `refresh_reservation_payment_totals()` recomputes `reservations.paid_amount` / `remaining_amount` after payment changes (`0007`, hardened in `0011`).
- **Public landing read access** scoped to available dresses for anonymous visitors (`0013`).
- **Canonical finance separation (0014):** `dresses.default_security_deposit_amount`, `reservations.booking_advance_amount`, `reservations.security_deposit_amount`, `security_deposit_collected/refunded/retained`, legacy classification columns (`legacy_deposit_classification`, `needs_financial_classification`), non-negative checks, liability invariant `refunded+retained <= collected`, idempotency unique index on `payments (reservation_id, idempotency_key)`.

RLS and Storage buckets are **not** missing; they are part of the current baseline.

## Confirmed gaps

1. **`reservations` currently models one `dress_id`.** The table has a single `dress_id uuid not null references dresses(id)` (`0002`), so a booking spanning multiple items cannot be represented canonically; multi-dress behavior today lives only in application-side conventions.
2. **No canonical `rental_contracts` table.** Nothing in `0001`–`0013` creates a contract header entity that ties a customer, a lifecycle (booking → delivery → return → settlement), and operator attribution together.
3. **No canonical `rental_contract_lines` table.** There is no line-item relation linking contractual items (dresses/accessories) to a contract with per-line pricing, state, and condition.
4. **No unified, append-only `financial_movements` ledger.** `payments` is a mutable-style operational table (`0003`, grants + policies in `0011`) rather than an append-only ledger, and expenses/returns fees are separate tables with no shared monetary-movement abstraction, no immutability enforcement, and no sequencing.
5. **Ambiguous `deposit_amount` semantics — ADDRESSED by 0014.** `dresses.default_security_deposit_amount` is now canonical for catalogue suggestion; `reservations.security_deposit_amount` and `booking_advance_amount` are canonical; legacy `deposit_amount` retained for transition. New columns `security_deposit_collected/refunded/retained`, `legacy_deposit_classification`, `needs_financial_classification` distinguish booking advance vs security deposit with explicit Arabic labels (دفعة الحجز vs التأمين المسترد).
6. **No explicit split between booking advance and refundable security deposit — ADDRESSED by 0014.** 0014 adds `booking_advance_amount` (reduces rental receivable, not liability) and `security_deposit_*` columns (liability, not revenue), with checks preventing over-refund/retention and preserving RLS. Legacy ambiguous rows flagged unresolved for admin review.
7. **Overlap protection uses procedural triggers rather than range/exclusion constraints.** `prevent_overlapping_reservations()` is a `BEFORE INSERT OR UPDATE` trigger doing an `EXISTS` check (`0006`). There is no `daterange` column and no `EXCLUDE`/`btree_gist` exclusion constraint, so protection depends on procedural logic instead of a declarative, serialization-safe constraint.
8. **No complete atomic RPC boundary for multi-step operational workflows.** The only public functions are the two trigger functions (plus auth/RLS helpers); there are no `security definer` transactional RPCs for workflows such as "create reservation + record advance + mark items", so multi-write operations are not atomic at the database boundary.
9. **No canonical database relation for condition photos.** The `condition-photos` bucket exists in Storage (`0011`), but no table ties a photo to a contract/line and to a lifecycle event (e.g., at-delivery vs at-return), so photo evidence cannot be enforced or queried relationally.
10. **Human codes are not consistently protected by monotonic, non-reusable sequences.** `dresses.code`, `customers.phone`, and `reservations.reservation_number` are `text unique` columns assigned by the application (`0002`); no migration creates a `SEQUENCE` (or equivalent) for them, so codes can be reused after deletion and ordering is not guaranteed by the database.

## Out of scope for the originating PR

The originating PR documents these gaps only. It deliberately does **not**: migrate operational data, create Supabase RPCs, create an offline outbox, redesign financial models, or delete Tauri source files (see ADR 0001).
