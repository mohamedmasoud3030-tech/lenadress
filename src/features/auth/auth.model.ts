import type { Session } from '@supabase/supabase-js';

export type Profile = {
  id: string;
  fullName: string;
  role: 'admin' | 'staff';
  isActive: boolean;
};

export type AuthStatus =
  | 'loading'
  | 'signed-out'
  | 'signed-in'
  | 'disabled'
  | 'profile-missing'
  | 'auth-error';

export function resolveAuthStatus(
  session: Session | null,
  profile: Profile | null,
  failed = false,
): AuthStatus {
  if (!session) return failed ? 'auth-error' : 'signed-out';
  if (failed) return 'auth-error';
  if (!profile) return 'profile-missing';
  if (!profile.isActive) return 'disabled';
  return 'signed-in';
}

export function getSafeReturnPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}
