drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_update_own_active on public.profiles;
drop policy if exists profiles_update_active on public.profiles;

create policy profiles_update_active
on public.profiles for update
to authenticated
using (
  private.is_lena_admin()
  or (
    id = (select auth.uid())
    and private.is_active_lena_user()
  )
)
with check (
  private.is_lena_admin()
  or (
    id = (select auth.uid())
    and private.is_active_lena_user()
  )
);
