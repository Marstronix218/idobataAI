function requireValue(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is required for this request.`);
  return value;
}

// Keep public variable references static so Next.js can inline them in the
// browser bundle. Dynamic `process.env[name]` access is not inlined.
export const supabaseUrl = () =>
  requireValue(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
export const supabaseAnonKey = () =>
  requireValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
export const supabaseServiceRoleKey = () =>
  requireValue(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");

export function hasPublicSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
