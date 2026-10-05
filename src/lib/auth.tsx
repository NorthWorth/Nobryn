import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import type { AuthUser, WorkspaceInfo } from "./types";

interface AuthContextValue {
  user: AuthUser | null;
  workspace: WorkspaceInfo | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    workspaceName: string;
  }) => Promise<void>;
  logout: () => void;
  setWorkspace: (workspace: WorkspaceInfo) => void;
  setUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

interface MeResponse {
  user: AuthUser;
  workspace: WorkspaceInfo | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [workspace, setWorkspaceState] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.get<MeResponse>("/api/auth/me");
        if (!cancelled) {
          setUserState(me.user);
          if (me.workspace) setWorkspaceState(me.workspace);
        }
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string }>("/api/auth/login", { email, password });
    setToken(res.token);
    const me = await api.get<MeResponse>("/api/auth/me");
    setUserState(me.user);
    if (me.workspace) setWorkspaceState(me.workspace);
  }, []);

  const register = useCallback(
    async (input: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      workspaceName: string;
    }) => {
      const res = await api.post<{ token: string }>("/api/auth/register", input);
      setToken(res.token);
      const me = await api.get<MeResponse>("/api/auth/me");
      setUserState(me.user);
      if (me.workspace) setWorkspaceState(me.workspace);
    },
    []
  );

  const logout = useCallback(() => {
    setToken(null);
    setUserState(null);
    setWorkspaceState(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      workspace,
      loading,
      login,
      register,
      logout,
      setWorkspace: setWorkspaceState,
      setUser: setUserState,
    }),
    [user, workspace, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
