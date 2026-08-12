"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types";
import { supabaseAnonKey, supabaseUrl } from "./env";

export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey());
}

