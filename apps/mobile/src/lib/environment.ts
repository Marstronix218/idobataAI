const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ?? "";
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const missing = [
  ...(!isHttpUrl(apiBaseUrl) ? ["EXPO_PUBLIC_API_BASE_URL"] : []),
  ...(!isHttpUrl(supabaseUrl) ? ["EXPO_PUBLIC_SUPABASE_URL"] : []),
  ...(!supabasePublishableKey ? ["EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] : []),
];

export const mobileEnvironment = {
  apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
  supabaseUrl,
  supabasePublishableKey,
  missing,
  isConfigured: missing.length === 0,
} as const;
