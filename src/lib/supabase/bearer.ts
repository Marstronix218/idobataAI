import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/types";
import { supabaseAnonKey, supabaseUrl } from "./env";

export class AuthenticationError extends Error {}

export async function authenticateBearer(request: Request): Promise<{
  user: User;
  supabase: ReturnType<typeof createClient<Database>>;
}> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new AuthenticationError("Missing bearer token.");
  const token = authorization.slice(7).trim();
  if (!token) throw new AuthenticationError("Missing bearer token.");
  const supabase = createClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new AuthenticationError("Invalid or expired bearer token.");
  return { user: data.user, supabase };
}

