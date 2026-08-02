import { getSupabaseClient, isSupabaseConfigured } from '../../lib/supabaseClient';

declare const __APP_VERSION__: string;

let installed = false;

function classify(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null) {
    const candidate = reason as Record<string, unknown>;
    if (typeof candidate.code === 'string') return candidate.code.slice(0, 100);
    if (typeof candidate.name === 'string') return candidate.name.slice(0, 100);
  }
  return typeof reason === 'string' ? 'StringError' : 'UnknownError';
}

export async function reportClientError(category: string, reason: unknown): Promise<void> {
  if (!isSupabaseConfigured() || typeof window === 'undefined') return;
  try {
    const client = getSupabaseClient();
    const { data } = await client.auth.getSession();
    if (!data.session) return;
    await client.from('client_error_events').insert({
      category: category.slice(0, 80),
      error_code: classify(reason),
      route: `${window.location.pathname}${window.location.search}`.slice(0, 300),
      app_version: __APP_VERSION__,
    });
  } catch {
    // Telemetry must never become a second application failure.
  }
}

export function initializeClientObservability(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => { void reportClientError('window.error', event.error); });
  window.addEventListener('unhandledrejection', (event) => { void reportClientError('unhandledrejection', event.reason); });
}

