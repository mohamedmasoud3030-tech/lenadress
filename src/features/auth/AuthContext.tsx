import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchProfile, getCurrentSession, onAuthStateChange, signIn, signOut, type Profile } from './auth.service';
import { setCurrentOperatorName } from '../operators/operator.service';

type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  async function loadProfileFor(nextSession: Session | null) {
    if (!nextSession) {
      setProfile(null);
      return;
    }
    try {
      const loaded = await fetchProfile(nextSession.user);
      setProfile(loaded);
      // The signed-in account is now the source of truth for "who is doing
      // this" in the audit trail, replacing the old free-text operator name.
      if (loaded) setCurrentOperatorName(loaded.fullName);
    } catch {
      setProfile(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    getCurrentSession()
      .then(async (initialSession) => {
        if (cancelled) return;
        setSession(initialSession);
        await loadProfileFor(initialSession);
        if (!cancelled) setStatus(initialSession ? 'signed-in' : 'signed-out');
      })
      .catch(() => {
        if (!cancelled) setStatus('signed-out');
      });

    const unsubscribe = onAuthStateChange((nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      setStatus(nextSession ? 'signed-in' : 'signed-out');
      void loadProfileFor(nextSession);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      profile,
      signIn: async (email, password) => {
        await signIn(email, password);
      },
      signOut: async () => {
        await signOut();
      },
    }),
    [status, session, profile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider.');
  return context;
}
