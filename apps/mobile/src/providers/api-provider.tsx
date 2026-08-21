import { createApiClient, type ApiClient } from "@idobata/api-client";
import { createContext, type PropsWithChildren, useContext, useMemo } from "react";

import { mobileEnvironment } from "@/lib/environment";
import { useAuth } from "@/providers/auth-provider";

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: PropsWithChildren) {
  const {
    markSessionUnauthorized,
    refreshSession,
    requiresReauthentication,
    session,
  } = useAuth();
  const accessToken = session?.access_token ?? null;

  const client = useMemo(() => {
    if (!mobileEnvironment.isConfigured || !accessToken || requiresReauthentication) return null;
    return createApiClient({
      baseUrl: mobileEnvironment.apiBaseUrl,
      getAccessToken: () => accessToken,
      refreshAccessToken: refreshSession,
      onUnauthorized: markSessionUnauthorized,
    });
  }, [accessToken, markSessionUnauthorized, refreshSession, requiresReauthentication]);

  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApiClient() {
  return useContext(ApiContext);
}
