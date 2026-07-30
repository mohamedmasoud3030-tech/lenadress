import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig, MissingRuntimeConfigError } from '../config/env';

/**
 * Lazily-created Supabase client.
 *
 * Config is only read the first time a caller actually needs the client, not
 * at module load. That keeps every screen that has nothing to do with
 * Supabase (which today is most of the app — see the local-first persistence
 * engine at `@engines/persistence`) working even when `VITE_SUPABASE_URL` /
 * `VITE_SUPABASE_ANON_KEY` are unset, e.g. in tests or a fresh checkout
 * before `.env` is configured.
 */
let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const { url, publishableKey } = getSupabaseConfig();
  cachedClient = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cachedClient;
}

/** True once the project URL and a publishable (or legacy anon) key are both set. */
export function isSupabaseConfigured(env: Record<string, string | undefined> = import.meta.env): boolean {
  try {
    getSupabaseConfig(env);
    return true;
  } catch (error) {
    if (error instanceof MissingRuntimeConfigError) return false;
    throw error;
  }
}
