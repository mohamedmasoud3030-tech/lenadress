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
  const { url, anonKey } = getSupabaseConfig();
  cachedClient = createClient(url, anonKey);
  return cachedClient;
}

/** True once VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are both set. */
export function isSupabaseConfigured(env: Record<string, string | undefined> = import.meta.env): boolean {
  try {
    getSupabaseConfig(env);
    return true;
  } catch (error) {
    if (error instanceof MissingRuntimeConfigError) return false;
    throw error;
  }
}
