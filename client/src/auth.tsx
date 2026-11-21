import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { PublicUser } from '@shared/types';
import { api } from './api';
import { setCollabUser } from './collab';

interface AuthState {
  user: PublicUser | null;
  setUser(user: PublicUser | null): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  const setUser = useCallback((next: PublicUser | null) => {
    setCollabUser(next);
    setUserState(next);
  }, []);

  useEffect(() => {
    api
      .me()
      .then(({ user: me }) => setUser(me))
      .catch(() => setUser(null))
      .finally(() => setLoaded(true));
  }, [setUser]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    // A full reload drops every open collaboration connection, which were authenticated as this user.
    window.location.assign('/login');
  }, []);

  const value = useMemo(() => ({ user, setUser, logout }), [user, setUser, logout]);
  if (!loaded) {
    return (
      <div className="splash" aria-busy="true">
        <div className="spinner" />
      </div>
    );
  }
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** The signed-in user; only valid below <RequireAuth>. */
export function useUser(): PublicUser {
  const { user } = useAuth();
  if (!user) throw new Error('No signed-in user');
  return user;
}

export function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}
