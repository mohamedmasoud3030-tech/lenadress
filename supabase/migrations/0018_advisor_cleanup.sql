-- 0018_advisor_cleanup
-- Remove catalogue bucket listing, make auth lookups init-plan friendly, and
-- cover every new/legacy foreign key used by deletes and administrative reads.

drop policy if exists lena_catalogue_public_read on storage.objects;

drop policy if exists client_error_events_insert_active on public.client_error_events;
create policy client_error_events_insert_active
on public.client_error_events for insert
to authenticated
with check (
  private.is_active_lena_user()
  and actor_id = (select auth.uid())
);

create index if not exists client_error_events_actor_id_idx
  on public.client_error_events (actor_id);
create index if not exists reservations_cancelled_by_idx
  on public.reservations (cancelled_by);
create index if not exists reservations_classified_by_idx
  on public.reservations (classified_by);
create index if not exists showroom_state_updated_by_idx
  on public.showroom_state (updated_by);
