-- 0017_realtime_and_bounded_log_hardening
-- Ensure other signed-in devices receive authoritative state changes, and do
-- not block staff once the local bounded command log legitimately trims its
-- oldest entries. Immutable financial rows remain protected by the RPC.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'showroom_state'
  ) then
    alter publication supabase_realtime add table public.showroom_state;
  end if;
end $$;

do $$
declare
  function_definition text;
  hardened_definition text;
  old_collection_list constant text := '''payments'', ''expenses'', ''sales'', ''sales-invoices'', ''sale-returns'',
      ''audit-log'', ''audit'', ''daily-closings'', ''command-log''';
  new_collection_list constant text := '''payments'', ''expenses'', ''sales'', ''sales-invoices'', ''sale-returns'',
      ''daily-closings''';
begin
  select pg_get_functiondef('public.apply_showroom_snapshot(bigint,jsonb,text,text)'::regprocedure)
  into function_definition;

  if position(old_collection_list in function_definition) > 0 then
    hardened_definition := replace(function_definition, old_collection_list, new_collection_list);
    execute hardened_definition;
  end if;
end $$;

revoke all on function public.apply_showroom_snapshot(bigint, jsonb, text, text) from public, anon;
grant execute on function public.apply_showroom_snapshot(bigint, jsonb, text, text) to authenticated;
