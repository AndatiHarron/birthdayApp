import type { AuthSession, CurrentUser, OtpChallenge } from '@bday/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as Device from 'expo-device';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { api, onSessionChange, refreshSession, setTokens } from './api';
import { loadRefreshToken } from './storage';

type RegisterResult =
  | { kind: 'SESSION'; session: AuthSession; verification: (OtpChallenge & { debugCode?: string }) | null }
  | { kind: 'OTP_REQUIRED'; challenge: OtpChallenge & { debugCode?: string } };

interface AuthState {
  status: 'loading' | 'signed-out' | 'signed-in';
  user: CurrentUser | null;
  /** True until the user has finished onboarding (spec §4). */
  needsOnboarding: boolean;
  acceptSession: (session: AuthSession) => Promise<void>;
  signIn: (identifier: { email?: string; phone?: string; username?: string }, password: string) => Promise<void>;
  register: (input: Record<string, unknown>) => Promise<RegisterResult>;
  verifyOtp: (challengeId: string, code: string) => Promise<void>;
  setUser: (user: CurrentUser) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function deviceInfo() {
  return {
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    model: Device.modelName ?? undefined,
    osVersion: Device.osVersion ?? undefined,
  } as const;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<CurrentUser | null>(null);

  const acceptSession = useCallback(async (session: AuthSession) => {
    await setTokens(session.tokens);
    setUser(session.user);
    setStatus('signed-in');
  }, []);

  useEffect(() => {
    onSessionChange((session) => {
      if (session) {
        setUser(session.user);
        setStatus('signed-in');
      } else {
        setUser(null);
        setStatus('signed-out');
      }
    });

    void (async () => {
      const stored = await loadRefreshToken();
      if (!stored) {
        setStatus('signed-out');
        return;
      }
      try {
        const session = await refreshSession();
        if (!session) setStatus('signed-out');
      } catch {
        // Offline at launch: stay signed in on cached data; requests retry later.
        setStatus('signed-in');
        const cached = queryClient.getQueryData<CurrentUser>(['me']);
        if (cached) setUser(cached);
      }
    })();
  }, [queryClient]);

  const signIn = useCallback<AuthState['signIn']>(
    async (identifier, password) => {
      const session = await api.post<AuthSession>('/auth/login', { ...identifier, password, device: deviceInfo() });
      await acceptSession(session);
    },
    [acceptSession],
  );

  const register = useCallback<AuthState['register']>(
    async (input) => {
      const result = await api.post<RegisterResult>('/auth/register', { ...input, acceptedTerms: true, device: deviceInfo() });
      if (result.kind === 'SESSION') await acceptSession(result.session);
      return result;
    },
    [acceptSession],
  );

  const verifyOtp = useCallback<AuthState['verifyOtp']>(
    async (challengeId, code) => {
      const session = await api.post<AuthSession>('/auth/verify-otp', { challengeId, code, device: deviceInfo() });
      await acceptSession(session);
    },
    [acceptSession],
  );

  const signOut = useCallback(async () => {
    const refreshToken = await loadRefreshToken();
    if (refreshToken) await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    await setTokens(null);
    queryClient.clear();
    setUser(null);
    setStatus('signed-out');
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      needsOnboarding: status === 'signed-in' && user != null && user.onboardingCompletedAt == null,
      acceptSession,
      signIn,
      register,
      verifyOtp,
      setUser,
      signOut,
    }),
    [status, user, acceptSession, signIn, register, verifyOtp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
