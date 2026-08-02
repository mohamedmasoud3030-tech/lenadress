import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (profile?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

