-- 0014_booking_advance_vs_security_deposit
-- Purpose: Separate booking advance (دفعة الحجز) from refundable security deposit (التأمين المسترد)
-- without destroying legacy deposit_amount. Implements financial correctness invariants.
--
-- Canonical definitions:
-- - booking_advance_amount: money paid in advance toward rental obligation, reduces rental receivable, not liability
-- - security_deposit_amount: refundable liability, does not reduce rental receivable, not revenue when collected
-- - security_deposit_collected_amount: actual cash collected as security deposit
-- - security_deposit_refunded_amount: amount refunded to customer
-- - security_deposit_retained_amount: amount retained to cover approved fees
-- - legacy_deposit_classification: booking_advance | security_deposit | mixed | unresolved | reviewed
-- - needs_financial_classification: true when ambiguous legacy value requires review
--
-- Rollback: DROP columns and constraints added here. Legacy deposit_amount remains.
-- Recovery: If migration fails mid-way, re-run is safe due to IF NOT EXISTS guards.

-- ── dresses: catalogue suggested refundable deposit ─────────────────────────
alter table public.dresses
  add column if not exists default_security_deposit_amount numeric(12,3) not null default 0;

-- Keep legacy deposit_amount for transition, but ensure new canonical is used going forward
-- Backfill canonical from legacy where canonical is still 0
update public.dresses
set default_security_deposit_amount = deposit_amount
where default_security_deposit_amount = 0 and deposit_amount <> 0;

-- Non-negative check for canonical
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'dresses_default_security_deposit_non_negative'
  ) then
    alter table public.dresses add constraint dresses_default_security_deposit_non_negative check (default_security_deposit_amount >= 0);
  end if;
end $$;

-- ── reservations: booking advance vs security deposit ───────────────────────
alter table public.reservations
  add column if not exists booking_advance_amount numeric(12,3) not null default 0,
  add column if not exists security_deposit_amount numeric(12,3) not null default 0,
  add column if not exists security_deposit_collected_amount numeric(12,3) not null default 0,
  add column if not exists security_deposit_refunded_amount numeric(12,3) not null default 0,
  add column if not exists security_deposit_retained_amount numeric(12,3) not null default 0,
  add column if not exists legacy_deposit_amount numeric(12,3),
  add column if not exists legacy_deposit_classification text,
  add column if not exists needs_financial_classification boolean not null default false,
  add column if not exists classification_reason text,
  add column if not exists classified_at timestamptz,
  add column if not exists classified_by uuid references public.profiles(id) on delete set null;

-- Backfill security_deposit_amount from legacy deposit_amount for existing rows where new is 0
update public.reservations
set security_deposit_amount = deposit_amount,
    legacy_deposit_amount = deposit_amount,
    legacy_deposit_classification = 'unresolved',
    needs_financial_classification = true,
    classification_reason = 'Legacy deposit_amount present without settlement evidence; requires review'
where security_deposit_amount = 0 and deposit_amount <> 0;

-- Non-negative checks
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_booking_advance_non_negative') then
    alter table public.reservations add constraint reservations_booking_advance_non_negative check (booking_advance_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservations_security_deposit_amount_non_negative') then
    alter table public.reservations add constraint reservations_security_deposit_amount_non_negative check (security_deposit_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservations_security_deposit_collected_non_negative') then
    alter table public.reservations add constraint reservations_security_deposit_collected_non_negative check (security_deposit_collected_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservations_security_deposit_refunded_non_negative') then
    alter table public.reservations add constraint reservations_security_deposit_refunded_non_negative check (security_deposit_refunded_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservations_security_deposit_retained_non_negative') then
    alter table public.reservations add constraint reservations_security_deposit_retained_non_negative check (security_deposit_retained_amount >= 0);
  end if;
end $$;

-- Classification check
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_legacy_classification_check') then
    alter table public.reservations add constraint reservations_legacy_classification_check
      check (legacy_deposit_classification is null or legacy_deposit_classification in ('booking_advance','security_deposit','mixed','unresolved','reviewed'));
  end if;
end $$;

-- Liability invariant: refunded + retained <= collected
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_security_deposit_liability_check') then
    alter table public.reservations add constraint reservations_security_deposit_liability_check
      check (security_deposit_refunded_amount + security_deposit_retained_amount <= security_deposit_collected_amount);
  end if;
end $$;

-- ── payments: canonical movement types ───────────────────────────────────────
-- payments currently has payment_type text; we keep it permissive for legacy but document canonical types
-- Add optional canonical columns for breakdown (optional, additive)
alter table public.payments
  add column if not exists booking_advance_amount numeric(12,3) not null default 0,
  add column if not exists security_deposit_amount numeric(12,3) not null default 0,
  add column if not exists retention_reason text,
  add column if not exists idempotency_key text;

-- Non-negative for new payment breakdown columns
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_booking_advance_non_negative') then
    alter table public.payments add constraint payments_booking_advance_non_negative check (booking_advance_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_security_deposit_non_negative') then
    alter table public.payments add constraint payments_security_deposit_non_negative check (security_deposit_amount >= 0);
  end if;
end $$;

-- Unique idempotency key per reservation to prevent duplicate financial effects on retry
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_idempotency_key_unique') then
    -- Only unique when idempotency_key is not null
    create unique index if not exists payments_idempotency_key_unique_idx on public.payments (reservation_id, idempotency_key) where idempotency_key is not null;
  end if;
end $$;

-- ── returns: explicit security deposit handling ─────────────────────────────
alter table public.returns
  add column if not exists security_deposit_refund_amount numeric(12,3) not null default 0,
  add column if not exists security_deposit_retained_amount numeric(12,3) not null default 0,
  add column if not exists security_deposit_collected_amount numeric(12,3) not null default 0,
  add column if not exists retention_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'returns_security_deposit_refund_non_negative') then
    alter table public.returns add constraint returns_security_deposit_refund_non_negative check (security_deposit_refund_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'returns_security_deposit_retained_non_negative') then
    alter table public.returns add constraint returns_security_deposit_retained_non_negative check (security_deposit_retained_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'returns_security_deposit_collected_non_negative') then
    alter table public.returns add constraint returns_security_deposit_collected_non_negative check (security_deposit_collected_amount >= 0);
  end if;
end $$;

-- Backfill returns canonical from legacy deposit_refund_amount
update public.returns
set security_deposit_refund_amount = deposit_refund_amount
where security_deposit_refund_amount = 0 and deposit_refund_amount <> 0;

-- Preserve RLS: no policy changes, existing policies remain (checked in 0008-0012)
-- Preserve triggers: refresh_reservation_payment_totals continues to work;
-- its logic summing payments into paid_amount remains for legacy, new columns are independent.
-- To avoid silent misclassification, we do NOT auto-classify legacy rows with RLS or triggers;
-- classification stays as unresolved until admin review.

-- Comment for rollback documentation
comment on column public.reservations.booking_advance_amount is 'دفعة الحجز: money paid in advance toward rental, reduces rental receivable, not liability';
comment on column public.reservations.security_deposit_amount is 'التأمين المسترد: refundable security deposit required, liability not revenue';
comment on column public.reservations.security_deposit_collected_amount is 'Actual collected security deposit liability';
comment on column public.reservations.legacy_deposit_classification is 'booking_advance | security_deposit | mixed | unresolved | reviewed';
