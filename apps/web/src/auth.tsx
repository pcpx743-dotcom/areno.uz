import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, post, setToken, getToken, setUnauthorizedHandler } from './api';

export type Role = 'owner' | 'branch_admin' | 'coach' | 'guardian';

export interface Membership {
  id: string;
  clubId: string;
  clubName: string;
  role: Role;
  branchIds: string[];
}

export interface Me {
  user: { id: string; email: string; fullName: string; isSuperadmin: boolean };
  memberships: Membership[];
  club: null | {
    membershipId: string;
    clubId: string;
    clubName: string | null;
    logoUrl: string | null;
    role: Role;
    branchIds: string[] | null;
    coachIds: string[];
  };
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  switchMembership: (id: string) => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>('/auth/me'));
    } catch {
      setToken(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setMe(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    refresh();
  }, [refresh, logout]);

  const login = async (email: string, password: string) => {
    const r = await post<{ token: string }>('/auth/login', { email, password });
    setToken(r.token);
    await refresh();
  };

  const switchMembership = async (membershipId: string) => {
    const r = await post<{ token: string }>('/auth/switch', { membershipId });
    setToken(r.token);
    await refresh();
  };

  return <Ctx.Provider value={{ me, loading, login, logout, switchMembership }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export function useRole(): Role | null {
  return useAuth().me?.club?.role ?? null;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Klub egasi',
  branch_admin: 'Filial administratori',
  coach: 'Murabbiy',
  guardian: 'Ota-ona',
};
