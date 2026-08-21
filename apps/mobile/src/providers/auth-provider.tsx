import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";

import {
  type AuthResult,
  friendlyAuthError,
  guardAuthResult,
} from "@/lib/auth/errors";
import { prepareAuthStorage } from "@/lib/auth/secure-storage";
import { mobileEnvironment } from "@/lib/environment";
import { createMobileSupabaseClient, type MobileSupabaseClient } from "@/lib/supabase";

type AuthContextValue = {
  session: Session | null;
  isInitializing: boolean;
  initializationError: string | null;
  isConfigured: boolean;
  missingConfiguration: readonly string[];
  requiresReauthentication: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  refreshSession: () => Promise<string | null>;
  recoverSession: () => Promise<AuthResult>;
  markSessionUnauthorized: () => void;
  retryInitialization: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [client, setClient] = useState<MobileSupabaseClient | null>(null);
  const [isInitializing, setIsInitializing] = useState(mobileEnvironment.isConfigured);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [requiresReauthentication, setRequiresReauthentication] = useState(false);

  useEffect(() => {
    if (!mobileEnvironment.isConfigured) return;
    let active = true;
    let initializedClient: MobileSupabaseClient | null = null;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      try {
        await prepareAuthStorage();
        if (!active) return;
        initializedClient = createMobileSupabaseClient();
        if (!initializedClient) throw new Error("Mobile authentication is not configured.");
        const { data } = initializedClient.auth.onAuthStateChange((event, nextSession) => {
          if (!active) return;
          setSession(nextSession);
          if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "SIGNED_OUT") {
            setRequiresReauthentication(false);
          }
        });
        unsubscribe = () => data.subscription.unsubscribe();
        setClient(initializedClient);
        const { data: sessionData } = await initializedClient.auth.getSession();
        if (active) setSession(sessionData.session);
      } catch {
        unsubscribe?.();
        unsubscribe = null;
        initializedClient?.auth.stopAutoRefresh();
        if (active) {
          setClient(null);
          setSession(null);
          setInitializationError(
            "Your secure session could not be opened. Retry without changing to less secure storage.",
          );
        }
      } finally {
        if (active) setIsInitializing(false);
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
      initializedClient?.auth.stopAutoRefresh();
    };
  }, [initializationAttempt]);

  useEffect(() => {
    if (!client || Platform.OS === "web") return;

    const handleAppState = (state: AppStateStatus) => {
      if (state === "active") client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    };
    handleAppState(AppState.currentState);
    const subscription = AppState.addEventListener("change", handleAppState);
    return () => {
      subscription.remove();
      client.auth.stopAutoRefresh();
    };
  }, [client]);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!client) return { error: "Authentication is still starting. Try again in a moment." };
    return guardAuthResult(async () => {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (!error) setRequiresReauthentication(false);
      return { error: error ? friendlyAuthError(error.message) : null };
    });
  }, [client]);

  const signUp = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!client) return { error: "Authentication is still starting. Try again in a moment." };
    return guardAuthResult(async () => {
      const { data, error } = await client.auth.signUp({ email, password });
      if (!error && data.session) setRequiresReauthentication(false);
      return {
        error: error ? friendlyAuthError(error.message) : null,
        requiresEmailConfirmation: !error && !data.session,
      };
    });
  }, [client]);

  const signOut = useCallback(async (): Promise<AuthResult> => {
    if (!client) return { error: null };
    return guardAuthResult(async () => {
      const { error } = await client.auth.signOut();
      return { error: error ? friendlyAuthError(error.message) : null };
    });
  }, [client]);

  const refreshSession = useCallback(async () => {
    if (!client) return null;
    try {
      const { data, error } = await client.auth.refreshSession();
      if (error) return null;
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  }, [client]);

  const recoverSession = useCallback(async (): Promise<AuthResult> => {
    if (!client) return { error: "Authentication is still starting. Try again in a moment." };
    return guardAuthResult(async () => {
      const { data, error } = await client.auth.refreshSession();
      if (error) return { error: friendlyAuthError(error.message) };
      if (!data.session) return { error: "Your session has ended. Sign in again to continue." };
      setSession(data.session);
      setRequiresReauthentication(false);
      return { error: null };
    });
  }, [client]);

  const markSessionUnauthorized = useCallback(() => {
    setRequiresReauthentication(true);
  }, []);

  const retryInitialization = useCallback(() => {
    setIsInitializing(true);
    setInitializationError(null);
    setInitializationAttempt((current) => current + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isInitializing,
      initializationError,
      isConfigured: mobileEnvironment.isConfigured,
      missingConfiguration: mobileEnvironment.missing,
      requiresReauthentication,
      signIn,
      signUp,
      signOut,
      refreshSession,
      recoverSession,
      markSessionUnauthorized,
      retryInitialization,
    }),
    [
      initializationError,
      isInitializing,
      markSessionUnauthorized,
      recoverSession,
      refreshSession,
      requiresReauthentication,
      retryInitialization,
      session,
      signIn,
      signOut,
      signUp,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
