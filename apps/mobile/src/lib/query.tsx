import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { ApiError } from './api';

/**
 * Offline support (spec §52).
 *
 * Queries are persisted to AsyncStorage, so the home screen, upcoming birthdays,
 * profile and wishlist render from cache with no connection. Mutations made
 * offline are paused by React Query's online manager and resumed when the
 * device reconnects; conflicts are resolved by the server, which re-validates
 * every write (a reservation made meanwhile by someone else still wins).
 */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24 * 7,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: (count, error) => error instanceof ApiError && error.isNetwork && count < 3,
    },
  },
});

/** Only these query roots are written to disk; money and chat stay live-only. */
const PERSISTED_ROOTS = new Set(['me', 'home', 'birthdays', 'wishlist', 'my-wishlists', 'friends', 'interests', 'profile']);

const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'bday.query-cache', throttleTime: 2000 });

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false)),
);

export function QueryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));
    return () => subscription.remove();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24 * 7,
        // Bump whenever an API response shape changes: restored queries are
        // whatever the server sent last time, and a screen written for the new
        // shape will crash on the old one.
        buster: 'v2-home-rows',
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => query.state.status === 'success' && PERSISTED_ROOTS.has(String(query.queryKey[0])),
        },
      }}
      onSuccess={() => void queryClient.resumePausedMutations()}
    >
      {children}
    </PersistQueryClientProvider>
  );
}

export function useIsOnline(): boolean {
  return onlineManager.isOnline();
}
