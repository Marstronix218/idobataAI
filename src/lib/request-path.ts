/** Set by src/proxy.ts on every request it forwards: the request's pathname. */
export const PATHNAME_HEADER = "x-idobata-pathname";

/**
 * Settings holds sign-out and account deletion, so it stays reachable even
 * while onboarding is incomplete.
 */
export const isSettingsPath = (pathname: string) => pathname === "/settings" || pathname.startsWith("/settings/");
