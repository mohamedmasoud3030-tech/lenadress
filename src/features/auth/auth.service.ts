import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../lib/supabaseClient';
import type { Profile } from './auth.model';

/**
 * Real access control for LENA.
 *
 * The showroom previously had no server, so "who is using the app" was just
 * an attributed display name (`operator.service.ts`) with no gate at all —
 * documented in the app itself as deliberately not authentication. Now that
 * data lives in Supabase, an unauthenticated visitor with the public anon
 * key could otherwise read and write every customer, reservation and
 * payment. This is the real login that closes that gap; the operator name is
 * kept as a separate, lighter-weight attribution layer on top of it (see
 * `operator.service.ts`).
 */

export class AuthError extends Error {}

export function toFriendlyAuthMessage(message: string): string {
  if (message.includes('Invalid login credentials')) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  }
  if (message.includes('Email not confirmed')) {
    return 'يجب تأكيد البريد الإلكتروني أولاً.';
  }
  if (message.toLowerCase().includes('network')) {
    return 'تعذر الاتصال بالخادم. تحققي من الإنترنت وحاولي مجدداً.';
  }
  if (message.toLowerCase().includes('rate limit')) {
    return 'تمت محاولات دخول كثيرة. انتظري قليلاً ثم حاولي مجدداً.';
  }
  if (message.toLowerCase().includes('weak password')) {
    return 'كلمة المرور لم تعد مطابقة لمتطلبات الأمان. أعيدي تعيينها أولاً.';
  }
  return 'تعذر تسجيل الدخول. حاولي مجدداً.';
}

export async function signIn(email: string, password: string): Promise<Session> {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) throw new AuthError('البريد الإلكتروني مطلوب.');
  if (!password) throw new AuthError('كلمة المرور مطلوبة.');

  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });

  if (error) throw new AuthError(toFriendlyAuthMessage(error.message));
  if (!data.session) throw new AuthError('تعذر تسجيل الدخول. حاولي مجدداً.');
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw new AuthError('تعذر تسجيل الخروج. حاولي مجدداً.');
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw new AuthError(error.message);
  return data.session;
}

export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  const {
    data: { subscription },
  } = getSupabaseClient().auth.onAuthStateChange((_event, session) => callback(session));
  return () => subscription.unsubscribe();
}

function mapProfileRow(row: {
  id: string;
  full_name: string;
  role: string;
  is_active: boolean;
}): Profile {
  return {
    id: row.id,
    fullName: row.full_name,
    role: row.role === 'admin' ? 'admin' : 'staff',
    isActive: row.is_active,
  };
}

export async function fetchProfile(user: User): Promise<Profile | null> {
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw new AuthError('تعذر تحميل بيانات المستخدم.');
  return data ? mapProfileRow(data) : null;
}
