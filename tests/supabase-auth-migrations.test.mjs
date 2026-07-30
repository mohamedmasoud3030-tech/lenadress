import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

async function migration(name) {
  return readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
}

test('every applied Auth and RLS migration is reproducible from the repository', async () => {
  const [rls, profileSync, triggerLockdown] = await Promise.all([
    migration('0008_rls_policies.sql'),
    migration('0009_auth_profile_sync.sql'),
    migration('0010_lock_down_trigger_function.sql'),
  ]);

  assert.match(rls, /enable row level security/i);
  assert.match(rls, /revoke all[\s\S]*from anon/i);
  assert.match(profileSync, /after insert on auth\.users/i);
  assert.match(profileSync, /public\.profiles/i);
  assert.match(triggerLockdown, /revoke all on function public\.handle_new_auth_user\(\)/i);
});

test('sale-ready hardening backfills the owner and gates data on an active profile', async () => {
  const sql = await migration('0011_sale_ready_auth_hardening.sql');

  assert.match(sql, /references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /from auth\.users/i);
  assert.match(sql, /account_order = 1/i);
  assert.match(sql, /private\.is_active_lena_user\(\)/i);
  assert.match(sql, /private\.is_lena_admin\(\)/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /revoke all on function public\.prevent_overlapping_reservations\(\)/i);
  assert.doesNotMatch(sql, /create policy[\s\S]{0,180}(using|with check) \(true\)/i);
});

test('private storage buckets and authenticated object policies ship with the schema', async () => {
  const sql = await migration('0011_sale_ready_auth_hardening.sql');

  for (const bucket of ['catalogue-images', 'condition-photos', 'backups']) {
    assert.match(sql, new RegExp(bucket));
  }
  assert.match(sql, /on storage\.objects for insert/i);
  assert.match(sql, /on storage\.objects for update/i);
  assert.match(sql, /on storage\.objects for delete/i);
});

test('profile updates use one policy so Postgres does not evaluate duplicate permissive branches', async () => {
  const sql = await migration('0012_merge_profile_update_policy.sql');

  assert.match(sql, /drop policy if exists profiles_update_admin/i);
  assert.match(sql, /drop policy if exists profiles_update_own_active/i);
  assert.equal((sql.match(/create policy profiles_update_active/gi) ?? []).length, 1);
  assert.match(sql, /private\.is_lena_admin\(\)[\s\S]*auth\.uid\(\)/i);
});
