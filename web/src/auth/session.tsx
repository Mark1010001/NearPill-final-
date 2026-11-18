import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { api, ApiError } from '../api/client';
import type { SessionUser } from '../api/types';
import { clearCheckoutAttempts } from '../features/customer/cart';

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  checking: boolean;
  otherTabSignOuts: number;
  error: Error | null;
  retry: () => void;
  clearSession: () => void;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const sessionChannelName = 'nearpill-session-change';

function clearPrivateData(queryClient: QueryClient) {
  const user = queryClient.getQueryData<SessionUser | null>(['session']);
  if (user?.role === 'customer') clearCheckoutAttempts(String(user.id));
  queryClient.removeQueries({ predicate: ({ queryKey }) =>
    ['admin', 'partner', 'customer-orders', 'customer-profile', 'customer-checkout-inventory', 'prescription-review', 'partner-prescriptions'].includes(String(queryKey[0])) });
  queryClient.getMutationCache().clear();
}

function resetSession(queryClient: QueryClient) {
  void queryClient.cancelQueries({ queryKey: ['session'] });
  clearPrivateData(queryClient);
  queryClient.setQueryData(['session'], null);
}

export function authorizationScope(user: SessionUser | null | undefined) {
  return user && JSON.stringify([String(user.id), user.role, user.memberships?.map(
    ({ drugstoreId, membershipRole, isActive }) => [drugstoreId, membershipRole, isActive !== false],
  )]);
}

function announceSessionChange(change: 'sign-in' | 'sign-out') {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(sessionChannelName);
  channel.postMessage(change);
  channel.close();
}

export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [otherTabSignOuts, setOtherTabSignOuts] = useState(0);
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async ({ signal }) => {
      const user = await api.me(signal).catch((error: unknown) => {
        if (error instanceof ApiError && [401, 403].includes(error.status)) return null;
        throw error;
      });
      const previous = queryClient.getQueryData<SessionUser | null>(['session']);
      if (!signal.aborted && previous && authorizationScope(previous) !== authorizationScope(user)) {
        clearPrivateData(queryClient);
      }
      return user;
    },
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) => query.state.data ? 60_000 : false,
    refetchIntervalInBackground: true,
    retry: 1,
  });

  const lifetime = session.data?.sessionExpiresInMs;
  useEffect(() => {
    if (typeof lifetime !== 'number' || !Number.isFinite(lifetime)) return;
    const delay = Math.max(0, session.dataUpdatedAt + lifetime - Date.now());
    const timer = window.setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ['session'] }); }, delay);
    return () => window.clearTimeout(timer);
  }, [lifetime, queryClient, session.dataUpdatedAt]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(sessionChannelName);
    channel.onmessage = ({ data }) => {
      if (data !== 'sign-out' && data !== 'sign-in') return;
      if (data === 'sign-out') {
        resetSession(queryClient);
        setOtherTabSignOuts((count) => count + 1);
      }
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    };
    return () => channel.close();
  }, [queryClient]);

  function clearSession() {
    resetSession(queryClient);
    announceSessionChange('sign-out');
  }

  return (
    <SessionContext.Provider value={{
      user: session.data ?? null,
      loading: session.isPending,
      checking: session.isFetching,
      otherTabSignOuts,
      error: session.error,
      retry: () => { void session.refetch(); },
      clearSession,
      login: async (email, password) => {
        await queryClient.cancelQueries({ queryKey: ['session'] });
        await api.login(email, password);
        announceSessionChange('sign-in');
        const user = await api.me();
        await queryClient.cancelQueries({ queryKey: ['session'] });
        clearPrivateData(queryClient);
        queryClient.setQueryData(['session'], user);
        return user;
      },
      logout: async () => {
        try { await api.logout(); }
        catch (error) {
          if (!(error instanceof ApiError && error.status === 401)) throw error;
        }
        clearSession();
      },
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider is required.');
  return value;
}
