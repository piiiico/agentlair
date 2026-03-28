// Auth context for the AgentLair dashboard.
// Stores API key or session token in localStorage. Provides useAuth() hook.
// Self-contained — no Astro-specific imports.

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { createElement } from "react";
import { setAuthHeaderProvider, apiCall } from "./api";

interface AccountData {
  id?: string;
  key_prefix?: string;
  recovery_email?: string;
  email?: string;
  tier?: string;
}

interface AuthState {
  /** Whether we're checking stored credentials on mount */
  loading: boolean;
  /** Current API key (null = not logged in via key) */
  apiKey: string | null;
  /** Current session token (null = not logged in via magic link) */
  session: string | null;
  /** Account data once authenticated */
  account: AccountData | null;
  /** Is the user authenticated? */
  isAuthenticated: boolean;
  /** Log in with an API key. Returns error message or null on success. */
  loginWithApiKey: (key: string) => Promise<string | null>;
  /** Request a magic link. Returns error message or null on success. */
  requestMagicLink: (email: string) => Promise<string | null>;
  /** Log out and clear stored credentials. */
  logout: () => void;
  /** Refresh account data from API. */
  refreshAccount: () => Promise<void>;
  /** Update the stored API key (e.g. after rotation). */
  setApiKey: (key: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountData | null>(null);

  // Register auth header provider for api.ts
  useEffect(() => {
    setAuthHeaderProvider(() => {
      if (apiKey) return `Bearer ${apiKey}`;
      if (session) return `Bearer session_${session}`;
      return null;
    });
  }, [apiKey, session]);

  const refreshAccount = useCallback(async () => {
    const { ok, data } = await apiCall<AccountData>("/v1/account/me");
    if (ok) {
      setAccount(data);
    } else {
      // Token invalid — log out
      setApiKeyState(null);
      setSession(null);
      setAccount(null);
      localStorage.removeItem("al_apikey");
      localStorage.removeItem("al_session");
    }
  }, []);

  // On mount: check URL hash for session token, then try stored credentials
  useEffect(() => {
    (async () => {
      let sess: string | null = null;
      let key: string | null = null;

      // Check for magic link redirect
      const hash = window.location.hash;
      if (hash.startsWith("#session=")) {
        sess = hash.slice(9);
        localStorage.setItem("al_session", sess);
        history.replaceState(null, "", window.location.pathname + window.location.search);
      } else {
        sess = localStorage.getItem("al_session");
      }

      if (!sess) {
        key = localStorage.getItem("al_apikey");
      }

      if (sess) {
        setSession(sess);
        // Set temporarily for the API call
        setAuthHeaderProvider(() => `Bearer session_${sess}`);
        const { ok, data } = await apiCall<AccountData>("/v1/account/me");
        if (ok) {
          setAccount(data);
        } else {
          localStorage.removeItem("al_session");
          sess = null;
        }
      } else if (key) {
        setApiKeyState(key);
        setAuthHeaderProvider(() => `Bearer ${key}`);
        const { ok, data } = await apiCall<AccountData>("/v1/account/me");
        if (ok) {
          setAccount(data);
        } else {
          localStorage.removeItem("al_apikey");
          key = null;
        }
      }

      setLoading(false);
    })();
  }, []);

  const loginWithApiKey = useCallback(async (key: string): Promise<string | null> => {
    // Temporarily set for validation
    setAuthHeaderProvider(() => `Bearer ${key}`);
    const { ok, data } = await apiCall<AccountData & { message?: string }>("/v1/account/me");
    if (ok) {
      setApiKeyState(key);
      setSession(null);
      setAccount(data);
      localStorage.setItem("al_apikey", key);
      localStorage.removeItem("al_session");
      return null;
    } else {
      // Restore previous auth provider
      setAuthHeaderProvider(() => {
        if (apiKey) return `Bearer ${apiKey}`;
        if (session) return `Bearer session_${session}`;
        return null;
      });
      return (data as { message?: string }).message || "Invalid API key.";
    }
  }, [apiKey, session]);

  const requestMagicLink = useCallback(async (email: string): Promise<string | null> => {
    const res = await fetch("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return null;
    return data.message || "Failed to send magic link.";
  }, []);

  const logout = useCallback(() => {
    setApiKeyState(null);
    setSession(null);
    setAccount(null);
    localStorage.removeItem("al_apikey");
    localStorage.removeItem("al_session");
  }, []);

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    localStorage.setItem("al_apikey", key);
  }, []);

  const isAuthenticated = !!(apiKey || session) && !!account;

  const value: AuthState = {
    loading,
    apiKey,
    session,
    account,
    isAuthenticated,
    loginWithApiKey,
    requestMagicLink,
    logout,
    refreshAccount,
    setApiKey,
  };

  return createElement(AuthContext.Provider, { value }, children);
}
