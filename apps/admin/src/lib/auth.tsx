import type { AuthSession, CurrentUser } from '@bday/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, hasStoredSession, refreshSession, setSignedOutHandler, storeTokens } from './api';

interface AuthState {
  user: CurrentUser | null;
  status: 'loading' | 'signed-in' | 'signed-out';
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');

  const signOutLocal = useCallback(() => {
    storeTokens(null);
    setUser(null);
    setStatus('signed-out');
  }, []);

  useEffect(() => {
    setSignedOutHandler(signOutLocal);
    if (!hasStoredSession()) {
      setStatus('signed-out');
      return;
    }
    void refreshSession().then((session) => {
      if (session && ADMIN_ROLES.has(session.user.role)) {
        setUser(session.user);
        setStatus('signed-in');
      } else {
        signOutLocal();
      }
    });
  }, [signOutLocal]);

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await api.post<AuthSession>('/auth/login', { email, password, device: { platform: 'web' } });
    if (!ADMIN_ROLES.has(session.user.role)) {
      // Revoke the session we just created rather than leaving it dangling.
      storeTokens(session.tokens);
      await api.post('/auth/logout', { refreshToken: session.tokens.refreshToken }).catch(() => undefined);
      storeTokens(null);
      throw new ApiError(403, { code: 'FORBIDDEN', message: 'This account does not have admin access.' });
    }
    storeTokens(session.tokens);
    setUser(session.user);
    setStatus('signed-in');
  }, []);

  const signOut = useCallback(async () => {
    let refreshToken: string | null = null;
    try {
      refreshToken = sessionStorage.getItem('bday.admin.refresh');
    } catch {
      refreshToken = null;
    }
    if (refreshToken) await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    signOutLocal();
  }, [signOutLocal]);

  const value = useMemo(() => ({ user, status, signIn, signOut }), [user, status, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
