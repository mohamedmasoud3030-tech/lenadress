-- 0016_centralized_showroom_state
-- Central authoritative state for the official Web/PWA runtime.
--
-- The existing normalized tables are retained for compatibility and reporting
-- during the transition. The application state itself is committed as one
-- revisioned JSON snapshot so every multi-collection showroom command reaches
-- Postgres atomically. A separate public catalogue projection prevents any
-- anonymous caller from reading the private operational snapshot.

create table if not exists public.showroom_state (
  id text primary key default 'main' check (id = 'main'),
  snapshot jsonb not null,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint showroom_state_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint showroom_state_application check (snapshot ->> 'applicationId' = 'dress-roomshow'),
  constraint showroom_state_collections check (jsonb_typeof(snapshot -> 'collections') = 'object')
);

create index if not exists showroom_state_updated_at_idx on public.showroom_state (updated_at desc);

create table if not exists public.showroom_mutations (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null,
  command_name text not null,
  resulting_revision bigint not null check (resulting_revision > 0),
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key),
  constraint showroom_mutations_key_length check (char_length(idempotency_key) between 8 and 200),
  constraint showroom_mutations_command_length check (char_length(command_name) between 3 and 100)
);

create index if not exists showroom_mutations_created_at_idx on public.showroom_mutations (created_at desc);

create table if not exists public.catalogue_items (
  id text primary key,
  code text not null unique,
  name text not null,
  description text,
  category text,
  color text,
  size text,
  item_type text not null default 'dress',
  rental_price numeric(12,3) not null default 0 check (rental_price >= 0),
  sale_price numeric(12,3) not null default 0 check (sale_price >= 0),
  security_deposit_amount numeric(12,3) not null default 0 check (security_deposit_amount >= 0),
  status text not null,
  is_for_rent boolean not null default true,
  is_for_sale boolean not null default false,
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_error_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  category text not null check (char_length(category) between 3 and 80),
  error_code text not null check (char_length(error_code) between 2 and 100),
  route text not null check (char_length(route) between 1 and 300),
  app_version text not null check (char_length(app_version) between 1 and 80),
  created_at timestamptz not null default now()
);

alter table public.showroom_state enable row level security;
alter table public.showroom_state force row level security;
alter table public.showroom_mutations enable row level security;
alter table public.showroom_mutations force row level security;
alter table public.catalogue_items enable row level security;
alter table public.catalogue_items force row level security;
alter table public.client_error_events enable row level security;
alter table public.client_error_events force row level security;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'showroom_state'
  ) then
    alter publication supabase_realtime add table public.showroom_state;
  end if;
end $$;

drop policy if exists showroom_state_select_active on public.showroom_state;
create policy showroom_state_select_active
on public.showroom_state for select
to authenticated
using (private.is_active_lena_user());

drop policy if exists showroom_mutations_select_admin on public.showroom_mutations;
create policy showroom_mutations_select_admin
on public.showroom_mutations for select
to authenticated
using (private.is_lena_admin());

drop policy if exists catalogue_items_public_available on public.catalogue_items;
create policy catalogue_items_public_available
on public.catalogue_items for select
to anon
using (status = 'available');

drop policy if exists catalogue_items_select_active on public.catalogue_items;
create policy catalogue_items_select_active
on public.catalogue_items for select
to authenticated
using (private.is_active_lena_user());

drop policy if exists client_error_events_insert_active on public.client_error_events;
create policy client_error_events_insert_active
on public.client_error_events for insert
to authenticated
with check (private.is_active_lena_user() and actor_id = auth.uid());

drop policy if exists client_error_events_select_admin on public.client_error_events;
create policy client_error_events_select_admin
on public.client_error_events for select
to authenticated
using (private.is_lena_admin());

revoke all on table public.showroom_state, public.showroom_mutations, public.catalogue_items from anon, authenticated;
revoke all on table public.client_error_events from anon, authenticated;
grant select on table public.showroom_state to authenticated;
grant select on table public.showroom_mutations to authenticated;
grant select on table public.catalogue_items to anon, authenticated;
grant insert, select on table public.client_error_events to authenticated;

-- Advisor hardening: trigger helpers must never resolve attacker-controlled
-- objects through a mutable search_path.
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'set_updated_at' and pronamespace = 'public'::regnamespace
  ) then
    alter function public.set_updated_at() set search_path = '';
  end if;
end $$;

-- Current production rows are explicitly test data. Seed the authoritative
-- snapshot from the useful core rows once, while leaving all other collections
-- empty. New deployments start from the same complete collection contract.
update public.reservations r
set paid_amount = greatest(coalesce(x.paid_total, 0), 0),
    remaining_amount = greatest(r.total_amount - greatest(coalesce(x.paid_total, 0), 0), 0),
    updated_at = now()
from (
  select reservation_id,
    sum(case
      when payment_type in ('rental_payment', 'rental', 'booking_advance') then amount
      when payment_type in ('refund', 'reversal') then -amount
      else 0 end) as paid_total
  from public.payments
  group by reservation_id
) x
where r.id = x.reservation_id;

update public.reservations r
set paid_amount = 0,
    remaining_amount = greatest(r.total_amount, 0),
    updated_at = now()
where not exists (select 1 from public.payments p where p.reservation_id = r.id);

insert into public.showroom_state (id, snapshot, revision)
values (
  'main',
  jsonb_build_object(
    'applicationId', 'dress-roomshow',
    'schemaVersion', 3,
    'backupVersion', 4,
    'exportedAt', now(),
    'metadata', jsonb_build_object(
      'applicationId', 'dress-roomshow',
      'schemaVersion', 3,
      'updatedAt', now()
    ),
    'collections', jsonb_build_object(
      'customers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'name', name, 'phone', phone, 'address', coalesce(address, ''),
        'measurements', coalesce(measurements, ''), 'notes', notes, 'status', status,
        'totalReservations', 0, 'activeReservations', 0, 'totalPaid', 0, 'remainingBalance', 0
      ) order by created_at desc) from public.customers), '[]'::jsonb),
      'dresses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'code', code, 'name', name, 'description', coalesce(description, ''),
        'itemType', 'dress', 'category', coalesce(category, 'أخرى'), 'color', coalesce(color, ''),
        'size', coalesce(size, ''), 'purchasePrice', purchase_price, 'rentalPrice', rental_price,
        'salePrice', sale_price, 'depositAmount', default_security_deposit_amount,
        'defaultSecurityDepositAmount', default_security_deposit_amount,
        'status', status, 'isForRent', is_for_rent, 'isForSale', is_for_sale,
        'images', case when main_image_url is null then '[]'::jsonb else jsonb_build_array(main_image_url) end,
        'barcode', code, 'timesRented', 0, 'notes', notes
      ) order by created_at) from public.dresses), '[]'::jsonb),
      'reservations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id::text, 'reservationNumber', r.reservation_number, 'customerId', r.customer_id::text,
        'customerName', c.name, 'customerPhone', c.phone,
        'inventoryItemId', r.dress_id::text, 'dressCode', d.code, 'dressName', d.name,
        'pickupDate', r.pickup_date, 'returnDate', r.return_date,
        'status', r.status, 'rentalPrice', r.rental_price, 'totalAmount', r.total_amount,
        'paidAmount', r.paid_amount, 'remainingAmount', r.remaining_amount,
        'bookingAdvanceAmount', r.booking_advance_amount,
        'securityDepositAmount', r.security_deposit_amount,
        'securityDepositCollectedAmount', r.security_deposit_collected_amount,
        'securityDepositRefundedAmount', r.security_deposit_refunded_amount,
        'securityDepositRetainedAmount', r.security_deposit_retained_amount,
        'needsFinancialClassification', r.needs_financial_classification,
        'notes', r.notes, 'cancellationReason', r.cancellation_reason,
        'cancelledAt', r.cancelled_at, 'cancelledBy', r.cancelled_by,
        'cancellationPolicyAck', r.cancellation_policy_ack
      ) order by r.created_at desc)
      from public.reservations r
      join public.customers c on c.id = r.customer_id
      join public.dresses d on d.id = r.dress_id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id::text, 'reservationNumber', r.reservation_number,
        'paymentNumber', 'PAY-' || left(p.id::text, 8), 'customerName', c.name,
        'dressCode', d.code, 'dressName', d.name, 'paymentDate', p.payment_date,
        'type', p.payment_type, 'method', p.payment_method,
        'direction', case
          when p.payment_type in ('security_deposit_refund', 'refund') then 'refund'
          when p.payment_type in ('security_deposit_retention', 'late_fee', 'damage_fee') then 'settlement'
          else 'income' end,
        'amount', p.amount, 'reservationTotal', r.total_amount,
        'idempotencyKey', p.idempotency_key, 'notes', p.notes
      ) order by p.created_at desc)
      from public.payments p
      join public.reservations r on r.id = p.reservation_id
      join public.customers c on c.id = p.customer_id
      join public.dresses d on d.id = r.dress_id), '[]'::jsonb),
      'expenses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id::text, 'expenseNumber', 'EXP-' || left(e.id::text, 8),
        'expenseDate', e.expense_date, 'title', e.title, 'category', e.category,
        'amount', e.amount, 'paymentMethod', 'cash',
        'relatedDressCode', d.code, 'relatedDressName', d.name, 'notes', e.notes
      ) order by e.created_at desc)
      from public.expenses e left join public.dresses d on d.id = e.related_dress_id), '[]'::jsonb),
      'dress-designs', '[]'::jsonb,
      'accessories', '[]'::jsonb,
      'reservation-accessories', '[]'::jsonb,
      'appointments', '[]'::jsonb,
      'delivery-return', '[]'::jsonb,
      'sales', '[]'::jsonb,
      'sales-invoices', '[]'::jsonb,
      'sale-returns', '[]'::jsonb,
      'service-tasks', '[]'::jsonb,
      'audit-log', '[]'::jsonb,
      'audit', '[]'::jsonb,
      'daily-closings', '[]'::jsonb,
      'counters', '[]'::jsonb,
      'command-log', '[]'::jsonb,
      'reminder-dismissals', '[]'::jsonb,
      'operators', '[]'::jsonb,
      'customer-conduct-notes', '[]'::jsonb,
      'waitlist', '[]'::jsonb,
      'print-settings', '[]'::jsonb,
      'retired-codes', '[]'::jsonb,
      'preferences', '[]'::jsonb,
      'showroom-profile', '[]'::jsonb,
      'stocktake-sessions', '[]'::jsonb,
      'message-templates', '[]'::jsonb,
      'images', '[]'::jsonb
    ),
    'migrationMarkers', '{}'::jsonb
  ),
  0
)
on conflict (id) do nothing;

-- Correct the compatibility-table aggregate: refundable security deposits are
-- liabilities and must never reduce the rental receivable.
create or replace function public.refresh_reservation_payment_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_id uuid;
  paid_total numeric(12,3);
begin
  target_id := coalesce(new.reservation_id, old.reservation_id);

  select coalesce(sum(
    case
      when payment_type in ('rental_payment', 'rental', 'booking_advance') then amount
      when payment_type in ('refund', 'reversal') then -amount
      else 0
    end
  ), 0)
  into paid_total
  from public.payments
  where reservation_id = target_id;

  update public.reservations
  set paid_amount = greatest(paid_total, 0),
      remaining_amount = greatest(total_amount - greatest(paid_total, 0), 0),
      updated_at = now()
  where id = target_id;

  return null;
end;
$$;

-- Apply one complete showroom command atomically with optimistic concurrency.
create or replace function public.apply_showroom_snapshot(
  p_expected_revision bigint,
  p_snapshot jsonb,
  p_idempotency_key text,
  p_command_name text
)
returns table (revision bigint, applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  current_revision bigint;
  existing_revision bigint;
  next_revision bigint;
  item jsonb;
  current_snapshot jsonb;
  actor_is_admin boolean;
  protected_collection text;
begin
  if actor is null or not private.is_active_lena_user() then
    raise exception using errcode = '42501', message = 'LENA_AUTH_REQUIRED';
  end if;

  if p_snapshot is null
     or jsonb_typeof(p_snapshot) <> 'object'
     or p_snapshot ->> 'applicationId' <> 'dress-roomshow'
     or jsonb_typeof(p_snapshot -> 'collections') <> 'object' then
    raise exception using errcode = '22023', message = 'LENA_INVALID_SNAPSHOT';
  end if;

  if octet_length(p_snapshot::text) > 20971520 then
    raise exception using errcode = '22023', message = 'LENA_SNAPSHOT_TOO_LARGE';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200
     or p_command_name is null or char_length(p_command_name) not between 3 and 100 then
    raise exception using errcode = '22023', message = 'LENA_INVALID_COMMAND_IDENTITY';
  end if;

  select m.resulting_revision into existing_revision
  from public.showroom_mutations m
  where m.actor_id = actor and m.idempotency_key = p_idempotency_key;
  if found then
    return query select existing_revision, false;
    return;
  end if;

  select s.revision, s.snapshot into current_revision, current_snapshot
  from public.showroom_state s where s.id = 'main' for update;

  if current_revision is distinct from p_expected_revision then
    raise exception using errcode = '40001', message = 'LENA_REVISION_CONFLICT';
  end if;

  actor_is_admin := private.is_lena_admin();
  if not actor_is_admin then
    -- Staff may operate the showroom, but cannot replace configuration or erase
    -- datasets. Existing financial/audit rows are immutable and append-only.
    foreach protected_collection in array array[
      'preferences', 'showroom-profile', 'print-settings', 'message-templates'
    ] loop
      if coalesce(p_snapshot #> array['collections', protected_collection], '[]'::jsonb)
         is distinct from coalesce(current_snapshot #> array['collections', protected_collection], '[]'::jsonb) then
        raise exception using errcode = '42501', message = 'LENA_ADMIN_REQUIRED';
      end if;
    end loop;

    foreach protected_collection in array array[
      'payments', 'expenses', 'sales', 'sales-invoices', 'sale-returns',
      'daily-closings'
    ] loop
      if not coalesce(p_snapshot #> array['collections', protected_collection], '[]'::jsonb)
             @> coalesce(current_snapshot #> array['collections', protected_collection], '[]'::jsonb) then
        raise exception using errcode = '42501', message = 'LENA_APPEND_ONLY_VIOLATION';
      end if;
    end loop;

    foreach protected_collection in array array[
      'customers', 'dresses', 'reservations', 'accessories', 'appointments', 'service-tasks'
    ] loop
      if jsonb_array_length(coalesce(p_snapshot #> array['collections', protected_collection], '[]'::jsonb))
         < jsonb_array_length(coalesce(current_snapshot #> array['collections', protected_collection], '[]'::jsonb)) then
        raise exception using errcode = '42501', message = 'LENA_ADMIN_REQUIRED_FOR_DELETE';
      end if;
    end loop;
  end if;

  next_revision := current_revision + 1;
  update public.showroom_state
  set snapshot = p_snapshot,
      revision = next_revision,
      updated_at = now(),
      updated_by = actor
  where id = 'main';

  -- The catalogue is a deliberately narrow public projection.
  delete from public.catalogue_items;
  for item in select value from jsonb_array_elements(coalesce(p_snapshot #> '{collections,dresses}', '[]'::jsonb)) loop
    if coalesce(item ->> 'id', '') = '' or coalesce(item ->> 'code', '') = '' or coalesce(item ->> 'name', '') = '' then
      raise exception using errcode = '22023', message = 'LENA_INVALID_CATALOGUE_ITEM';
    end if;
    insert into public.catalogue_items (
      id, code, name, description, category, color, size, item_type,
      rental_price, sale_price, security_deposit_amount, status,
      is_for_rent, is_for_sale, images, updated_at
    ) values (
      item ->> 'id', item ->> 'code', item ->> 'name', item ->> 'description',
      item ->> 'category', item ->> 'color', item ->> 'size', coalesce(item ->> 'itemType', 'dress'),
      coalesce(nullif(item ->> 'rentalPrice', '')::numeric, 0),
      coalesce(nullif(item ->> 'salePrice', '')::numeric, 0),
      coalesce(nullif(coalesce(item ->> 'defaultSecurityDepositAmount', item ->> 'depositAmount'), '')::numeric, 0),
      coalesce(item ->> 'status', 'inactive'),
      coalesce((item ->> 'isForRent')::boolean, true),
      coalesce((item ->> 'isForSale')::boolean, false),
      case when jsonb_typeof(item -> 'images') = 'array' then item -> 'images' else '[]'::jsonb end,
      now()
    );
  end loop;

  insert into public.showroom_mutations (actor_id, idempotency_key, command_name, resulting_revision)
  values (actor, p_idempotency_key, p_command_name, next_revision);

  return query select next_revision, true;
end;
$$;

revoke all on function public.apply_showroom_snapshot(bigint, jsonb, text, text) from public, anon;
grant execute on function public.apply_showroom_snapshot(bigint, jsonb, text, text) to authenticated;

-- Recompute compatibility rows after replacing the trigger function.
update public.reservations r
set paid_amount = greatest(coalesce(x.paid_total, 0), 0),
    remaining_amount = greatest(r.total_amount - greatest(coalesce(x.paid_total, 0), 0), 0),
    updated_at = now()
from (
  select reservation_id,
    sum(case
      when payment_type in ('rental_payment', 'rental', 'booking_advance') then amount
      when payment_type in ('refund', 'reversal') then -amount
      else 0 end) as paid_total
  from public.payments
  group by reservation_id
) x
where r.id = x.reservation_id;

update public.reservations r
set paid_amount = 0,
    remaining_amount = greatest(r.total_amount, 0),
    updated_at = now()
where not exists (select 1 from public.payments p where p.reservation_id = r.id);

-- Populate the initial public catalogue from the seeded snapshot.
insert into public.catalogue_items (
  id, code, name, description, category, color, size, item_type,
  rental_price, sale_price, security_deposit_amount, status,
  is_for_rent, is_for_sale, images
)
select
  item ->> 'id', item ->> 'code', item ->> 'name', item ->> 'description',
  item ->> 'category', item ->> 'color', item ->> 'size', coalesce(item ->> 'itemType', 'dress'),
  coalesce(nullif(item ->> 'rentalPrice', '')::numeric, 0),
  coalesce(nullif(item ->> 'salePrice', '')::numeric, 0),
  coalesce(nullif(coalesce(item ->> 'defaultSecurityDepositAmount', item ->> 'depositAmount'), '')::numeric, 0),
  coalesce(item ->> 'status', 'inactive'),
  coalesce((item ->> 'isForRent')::boolean, true),
  coalesce((item ->> 'isForSale')::boolean, false),
  case when jsonb_typeof(item -> 'images') = 'array' then item -> 'images' else '[]'::jsonb end
from public.showroom_state s,
     jsonb_array_elements(s.snapshot #> '{collections,dresses}') item
where s.id = 'main'
on conflict (id) do update set
  code = excluded.code,
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  color = excluded.color,
  size = excluded.size,
  item_type = excluded.item_type,
  rental_price = excluded.rental_price,
  sale_price = excluded.sale_price,
  security_deposit_amount = excluded.security_deposit_amount,
  status = excluded.status,
  is_for_rent = excluded.is_for_rent,
  is_for_sale = excluded.is_for_sale,
  images = excluded.images,
  updated_at = now();

analyze public.showroom_state;
analyze public.showroom_mutations;
analyze public.catalogue_items;
