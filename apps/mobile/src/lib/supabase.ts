import "react-native-url-polyfill/auto";

import { createClient, processLock } from "@supabase/supabase-js";

import { AUTH_STORAGE_KEY, secureSessionStorage } from "@/lib/auth/secure-storage";
import { mobileEnvironment } from "@/lib/environment";

export function createMobileSupabaseClient() {
  if (!mobileEnvironment.isConfigured) return null;
  return createClient(
    mobileEnvironment.supabaseUrl,
    mobileEnvironment.supabasePublishableKey,
    {
      auth: {
        storage: secureSessionStorage,
        storageKey: AUTH_STORAGE_KEY,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        lock: processLock,
      },
    },
  );
}

export type MobileSupabaseClient = NonNullable<ReturnType<typeof createMobileSupabaseClient>>;
