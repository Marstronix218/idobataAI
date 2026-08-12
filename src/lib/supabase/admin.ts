import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import { supabaseServiceRoleKey, supabaseUrl } from "./env";

export function createAdminClient() {
  return createClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

