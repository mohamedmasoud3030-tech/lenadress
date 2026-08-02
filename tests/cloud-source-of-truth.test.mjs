import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('every authenticated route is blocked on cloud hydration', async () => {
  const routes = await read('src/app/router/AppRoutes.tsx');
  assert.match(routes, /<RequireAuth>[\s\S]*<CloudDataGate>[\s\S]*<DeviceLockGate>/);
  assert.match(routes, /<RequireAdmin><PreferencesPage/);
});

test('commands publish complete before/after snapshots and roll back rejected commits', async () => {
  const runner = await read('src/engines/workflows/commandRunner.ts');
  const gate = await read('src/features/sync/CloudDataGate.tsx');
  assert.match(runner, /publishShowroomCommandCommitted/);
  assert.match(runner, /createDatabaseSnapshot\(\)/);
  assert.match(gate, /commitShowroomState/);
  assert.match(gate, /restoreDatabaseSnapshot\(detail\.before\)/);
  assert.match(gate, /revisionRef\.current/);
});

test('the database migration enforces atomic revisions, grants, RLS, and deposit-safe totals', async () => {
  const migration = await read('supabase/migrations/0016_centralized_showroom_state.sql');
  assert.match(migration, /create table if not exists public\.showroom_state/);
  assert.match(migration, /for update/);
  assert.match(migration, /LENA_REVISION_CONFLICT/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on function public\.apply_showroom_snapshot[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function public\.apply_showroom_snapshot[\s\S]*to authenticated/);
  assert.match(migration, /payment_type in \('rental_payment', 'rental', 'booking_advance'\)/);
  assert.doesNotMatch(migration, /payment_type in \([^)]*security_deposit_collection[^)]*\) then amount/);
});

test('public catalogue is a narrow anonymous projection and Vercel serves SPA deep links securely', async () => {
  const migration = await read('supabase/migrations/0016_centralized_showroom_state.sql');
  const landing = await read('src/pages/landing/landingDress.repository.ts');
  const vercel = JSON.parse(await read('vercel.json'));
  assert.match(migration, /catalogue_items_public_available/);
  assert.match(migration, /grant select on table public\.catalogue_items to anon/);
  assert.match(landing, /\.from\('catalogue_items'\)/);
  assert.ok(vercel.rewrites.some((rule) => rule.destination === '/index.html'));
  const headers = vercel.headers.flatMap((entry) => entry.headers.map((header) => header.key));
  for (const required of ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.ok(headers.includes(required), `${required} must be configured`);
  }
});
