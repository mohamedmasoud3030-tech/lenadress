import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MissingRuntimeConfigError,
  getSupabaseConfig,
  readRequiredEnv,
} from '../src/config/env.ts';

test('readRequiredEnv trims configured values', () => {
  assert.equal(readRequiredEnv({ VITE_SUPABASE_URL: ' https://example.test ' }, 'VITE_SUPABASE_URL'), 'https://example.test');
});

test('getSupabaseConfig rejects missing required Supabase settings', () => {
  assert.throws(
    () => getSupabaseConfig({ VITE_SUPABASE_URL: 'https://example.test' }),
    (error) => {
      assert.equal(error instanceof MissingRuntimeConfigError, true);
      assert.equal(error.key, 'VITE_SUPABASE_PUBLISHABLE_KEY');
      return true;
    },
  );
});

test('getSupabaseConfig prefers modern publishable keys and keeps the legacy anon fallback', () => {
  assert.deepEqual(
    getSupabaseConfig({
      VITE_SUPABASE_URL: 'https://example.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: ' sb_publishable_modern ',
      VITE_SUPABASE_ANON_KEY: 'legacy',
    }),
    {
      url: 'https://example.test',
      publishableKey: 'sb_publishable_modern',
    },
  );

  assert.equal(
    getSupabaseConfig({
      VITE_SUPABASE_URL: 'https://example.test',
      VITE_SUPABASE_ANON_KEY: ' legacy ',
    }).publishableKey,
    'legacy',
  );
});
