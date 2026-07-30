import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchProfile, getCurrentSession, onAuthStateChange, signIn, signOut } from './auth.service';
import { resolveAuthStatus, type AuthStatus, type Profile } from './auth.model';
import { setCurrentOperatorName } from '../operators/operator.service';

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  message: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const applySession = useCallback(async (nextSession: Session | null) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setSession(nextSession);
    setMessage(null);

    if (!nextSession) {
      setProfile(null);
      setStatus('signed-out');
      return;
    }

    setStatus('loading');
    try {
      const loaded = await fetchProfile(nextSession.user);
      if (requestIdRef.current !== requestId) return;
      setProfile(loaded);
      setStatus(resolveAuthStatus(nextSession, loaded));
      if (loaded?.isActive) setCurrentOperatorName(loaded.fullName);
    } catch (reason) {
      if (requestIdRef.current !== requestId) return;
      setProfile(null);
      setStatus(resolveAuthStatus(nextSession, null, true));
      setMessage(reason instanceof Error ? reason.message : 'تعذر التحقق من صلاحية الحساب.');
    }
  }, []);

  const retry = useCallback(async () => {
    setStatus('loading');
    try {
      await applySession(await getCurrentSession());
    } catch (reason) {
      setSession(null);
      setProfile(null);
      setStatus('auth-error');
      setMessage(reason instanceof Error ? reason.message : 'تعذر الاتصال بخدمة تسجيل الدخول.');
    }
  }, [applySession]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: () => void = () => undefined;

    void retry();
    try {
      unsubscribe = onAuthStateChange((nextSession) => {
        if (!cancelled) void applySession(nextSession);
      });
    } catch (reason) {
      setStatus('auth-error');
      setMessage(reason instanceof Error ? reason.message : 'تعذر تشغيل خدمة تسجيل الدخول.');
    }

    return () => {
      cancelled = true;
      requestIdRef.current += 1;
      unsubscribe();
    };
  }, [applySession, retry]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      profile,
      message,
      signIn: async (email, password) => {
        await applySession(await signIn(email, password));
      },
      signOut: async () => {
        await signOut();
        await applySession(null);
      },
      retry,
    }),
    [applySession, message, profile, retry, session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider.');
  return context;
}
