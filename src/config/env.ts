type RuntimeEnv = Record<string, string | undefined>;

export class MissingRuntimeConfigError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`إعداد ${key} مفقود. تحققي من ملف البيئة قبل تشغيل التطبيق.`);
    this.name = 'MissingRuntimeConfigError';
    this.key = key;
  }
}

export function readRequiredEnv(env: RuntimeEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new MissingRuntimeConfigError(key);
  return value;
}

export function getSupabaseConfig(env: RuntimeEnv = import.meta.env): {
  url: string;
  publishableKey: string;
} {
  const publishableKey =
    env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!publishableKey) throw new MissingRuntimeConfigError('VITE_SUPABASE_PUBLISHABLE_KEY');

  return {
    url: readRequiredEnv(env, 'VITE_SUPABASE_URL'),
    publishableKey,
  };
}
