import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig, MissingRuntimeConfigError } from '../config/env';

/**
 * Lazily-created Supabase client.
 *
 * Config is only read the first time a caller actually needs the client, not
 * at module load. This keeps pure unit tests and fresh checkouts usable before
 * runtime configuration is present; production routes still fail closed until
 * their authenticated central snapshot has loaded.
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
