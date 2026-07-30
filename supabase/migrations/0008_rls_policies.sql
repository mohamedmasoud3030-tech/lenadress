do $$
declare
  table_name text;
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
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

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

grant select on table public.profiles to authenticated;
grant select, insert, update, delete on table
  public.dresses,
  public.dress_images,
  public.customers,
  public.reservations,
  public.payments,
  public.returns,
  public.expenses
to authenticated;

create policy profiles_select_authenticated
on public.profiles for select
to authenticated
using (true);

create policy profiles_update_own
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'dresses',
    'dress_images',
    'customers',
    'reservations',
    'payments',
    'returns',
    'expenses'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      table_name || '_select_authenticated',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (true)',
      table_name || '_insert_authenticated',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (true) with check (true)',
      table_name || '_update_authenticated',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (true)',
      table_name || '_delete_authenticated',
      table_name
    );
  end loop;
end;
$$;
