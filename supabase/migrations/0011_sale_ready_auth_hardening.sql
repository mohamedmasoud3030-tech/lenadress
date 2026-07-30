create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_id_auth_users_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_id_auth_users_fkey
      foreign key (id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

with ranked_users as (
  select
    id,
    email,
    raw_user_meta_data,
    row_number() over (order by created_at, id) as account_order
  from auth.users
)
insert into public.profiles (id, full_name, role, is_active)
select
  id,
  coalesce(
    nullif(trim(raw_user_meta_data->>'full_name'), ''),
    nullif(split_part(coalesce(email, ''), '@', 1), ''),
    'مديرة المعرض'
  ),
  case when account_order = 1 then 'admin' else 'staff' end,
  account_order = 1
from ranked_users
on conflict (id) do nothing;

create or replace function private.is_active_lena_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
  );
$$;

create or replace function private.is_lena_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
      and role = 'admin'
  );
$$;

revoke all on function private.is_active_lena_user() from public;
revoke all on function private.is_lena_admin() from public;
grant execute on function private.is_active_lena_user() to authenticated;
grant execute on function private.is_lena_admin() to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_first_user boolean;
begin
  perform pg_advisory_xact_lock(hashtext('lena-first-user'));

  select not exists (
    select 1 from public.profiles where role = 'admin'
  ) into is_first_user;

  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'مستخدم جديد'
    ),
    case when is_first_user then 'admin' else 'staff' end,
    is_first_user
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public;
revoke all on function public.handle_new_auth_user() from anon;
revoke all on function public.handle_new_auth_user() from authenticated;

create or replace function private.protect_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'profile identity cannot be changed';
  end if;

  if (
    new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
  ) and not private.is_lena_admin() then
    raise exception 'only an active admin can change account privileges';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.protect_profile_privileges() from public;
revoke all on function private.protect_profile_privileges() from anon;
revoke all on function private.protect_profile_privileges() from authenticated;

drop trigger if exists profiles_protect_privileges on public.profiles;
create trigger profiles_protect_privileges
before update on public.profiles
for each row execute function private.protect_profile_privileges();

create or replace function public.prevent_overlapping_reservations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.reservations r
    where r.dress_id = new.dress_id
      and r.id <> new.id
      and r.status in ('pending', 'confirmed', 'delivered', 'overdue')
      and new.status in ('pending', 'confirmed', 'delivered', 'overdue')
      and r.pickup_date <= new.return_date
      and new.pickup_date <= r.return_date
  ) then
    raise exception 'reservation overlap';
  end if;

  return new;
end;
$$;

create or replace function public.refresh_reservation_payment_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_id uuid;
  paid_total numeric(12, 3);
begin
  target_id := coalesce(new.reservation_id, old.reservation_id);

  select coalesce(sum(amount), 0)
  into paid_total
  from public.payments
  where reservation_id = target_id;

  update public.reservations
  set paid_amount = paid_total,
      remaining_amount = greatest(total_amount - paid_total, 0),
      updated_at = now()
  where id = target_id;

  return null;
end;
$$;

revoke all on function public.prevent_overlapping_reservations() from public;
revoke all on function public.refresh_reservation_payment_totals() from public;
revoke all on function public.prevent_overlapping_reservations() from anon;
revoke all on function public.refresh_reservation_payment_totals() from anon;
revoke all on function public.prevent_overlapping_reservations() from authenticated;
revoke all on function public.refresh_reservation_payment_totals() from authenticated;

do $$
declare
  table_name text;
  operation text;
begin
  foreach table_name in array array[
    'profiles',
    'dresses',
    'dress_images',
    'customers',
    'reservations',
    'payments',
    'returns',
    'expenses'
  ]
  loop
    foreach operation in array array['select', 'insert', 'update', 'delete']
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        table_name || '_' || operation || '_authenticated',
        table_name
      );
    end loop;
  end loop;
end;
$$;

drop policy if exists profiles_update_own on public.profiles;

create policy profiles_select_account
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or private.is_active_lena_user()
);

create policy profiles_update_own_active
on public.profiles for update
to authenticated
using (
  id = (select auth.uid())
  and private.is_active_lena_user()
)
with check (
  id = (select auth.uid())
  and private.is_active_lena_user()
);

create policy profiles_update_admin
on public.profiles for update
to authenticated
using (private.is_lena_admin())
with check (private.is_lena_admin());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'dresses',
    'dress_images',
    'customers',
    'reservations',
    'returns',
    'expenses'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_active_lena_user())',
      table_name || '_select_active',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.is_active_lena_user())',
      table_name || '_insert_active',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.is_active_lena_user()) with check (private.is_active_lena_user())',
      table_name || '_update_active',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (private.is_lena_admin())',
      table_name || '_delete_admin',
      table_name
    );
  end loop;
end;
$$;

create policy payments_select_active
on public.payments for select
to authenticated
using (private.is_active_lena_user());

create policy payments_insert_active
on public.payments for insert
to authenticated
with check (
  private.is_active_lena_user()
  and created_by = (select auth.uid())
);

revoke all on table
  public.profiles,
  public.dresses,
  public.dress_images,
  public.customers,
  public.reservations,
  public.payments,
  public.returns,
  public.expenses
from anon;

grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table
  public.dresses,
  public.dress_images,
  public.customers,
  public.reservations,
  public.returns,
  public.expenses
to authenticated;
grant select, insert on table public.payments to authenticated;

create index if not exists dress_images_dress_id_idx
on public.dress_images (dress_id);
create index if not exists payments_reservation_id_idx
on public.payments (reservation_id);
create index if not exists payments_customer_id_idx
on public.payments (customer_id);
create index if not exists payments_created_by_idx
on public.payments (created_by);
create index if not exists reservations_created_by_idx
on public.reservations (created_by);
create index if not exists expenses_related_dress_id_idx
on public.expenses (related_dress_id);
create index if not exists expenses_created_by_idx
on public.expenses (created_by);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('catalogue-images', 'catalogue-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('condition-photos', 'condition-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('backups', 'backups', false, 104857600, array['application/json', 'application/gzip'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists lena_catalogue_public_read on storage.objects;
drop policy if exists lena_storage_active_read on storage.objects;
drop policy if exists lena_storage_active_insert on storage.objects;
drop policy if exists lena_storage_active_update on storage.objects;
drop policy if exists lena_storage_active_delete on storage.objects;

create policy lena_catalogue_public_read
on storage.objects for select
to anon, authenticated
using (bucket_id = 'catalogue-images');

create policy lena_storage_active_read
on storage.objects for select
to authenticated
using (
  bucket_id in ('condition-photos', 'backups')
  and private.is_active_lena_user()
);

create policy lena_storage_active_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id in ('catalogue-images', 'condition-photos', 'backups')
  and private.is_active_lena_user()
);

create policy lena_storage_active_update
on storage.objects for update
to authenticated
using (
  bucket_id in ('catalogue-images', 'condition-photos', 'backups')
  and private.is_active_lena_user()
)
with check (
  bucket_id in ('catalogue-images', 'condition-photos', 'backups')
  and private.is_active_lena_user()
);

create policy lena_storage_active_delete
on storage.objects for delete
to authenticated
using (
  bucket_id in ('catalogue-images', 'condition-photos', 'backups')
  and private.is_active_lena_user()
);
